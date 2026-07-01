// ════════════════════════════════════════════════════════════════════════════
// fulfill-purchase — native (iOS / Android) purchase fulfillment
//
// Deploy:  supabase functions deploy fulfill-purchase
//
// The native client (Tauri IAP plugin) completes a StoreKit / Play Billing
// purchase, then POSTs the signed receipt here. We:
//   1. identify the buyer from their JWT,
//   2. VERIFY the receipt with the platform (Apple App Store Server API /
//      Google Play Developer API) — this is the trust anchor,
//   3. credit via fulfill_purchase (service role; idempotent on transaction id).
//
// ⚠️ FAIL-CLOSED: verification is the only thing standing between this endpoint
// and free funds. Until the platform credentials below are configured, the
// verifiers throw and we return 503 — we NEVER credit on an unverified receipt.
//
// Required secrets to enable each rail:
//   iOS      APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (App Store Server API)
//   Android  GOOGLE_SERVICE_ACCOUNT_JSON, ANDROID_PACKAGE_NAME (Play Developer API)
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SignJWT, importPKCS8, decodeJwt } from 'jsr:@panva/jose@6';

const ALLOWED_ORIGINS = new Set<string>([
  'tauri://localhost',
  'https://tauri.localhost',
  'http://tauri.localhost',
  'http://localhost:5174',
  'https://playelector.com',
]);
const FALLBACK_ORIGIN = 'https://playelector.com';

// SKUs the native IAP rail may grant (the authoritative grant amounts live in SQL).
// Funds packs only — characters are unlocked with in-game funds, not real money.
const KNOWN_SKUS = new Set<string>([
  'funds_600', 'funds_1500', 'funds_4000', 'funds_9000', 'funds_20000', 'funds_45000',
]);

const APPLE_BUNDLE_ID = 'com.playelector.app';

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

interface VerifiedPurchase {
  transactionId: string;
  sku: string;
}

class VerificationUnavailable extends Error {}

/**
 * Verify an Apple StoreKit 2 signed transaction (JWS) and return the authoritative
 * { transactionId, sku }. We re-fetch the transaction from the App Store Server API
 * (the trust anchor) rather than trusting the client JWS: the client JWS is decoded
 * only to learn the transaction id, then Apple's own signed response is the source of
 * truth for productId/bundleId. Fail closed until the API key is configured.
 */
async function verifyApple(jws: string): Promise<VerifiedPurchase> {
  const issuer = Deno.env.get('APPLE_ISSUER_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const privateKey = Deno.env.get('APPLE_PRIVATE_KEY');
  if (!issuer || !keyId || !privateKey) {
    throw new VerificationUnavailable('Apple verification not configured');
  }
  if (!jws) throw new VerificationUnavailable('Apple verification: empty receipt');

  // 1. Decode the client JWS payload (UNTRUSTED) just to read the transaction id.
  const claimed = decodeJwt(jws) as { transactionId?: string };
  const transactionId = claimed.transactionId;
  if (!transactionId) throw new Error('Apple: missing transactionId in receipt');

  // 2. Mint the App Store Server API bearer (ES256, aud appstoreconnect-v1, <=60-min life).
  //    APPLE_PRIVATE_KEY is the .p8 (PKCS#8 PEM); normalize escaped newlines if single-line.
  const signingKey = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'ES256');
  const bearer = await new SignJWT({ bid: APPLE_BUNDLE_ID })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('10m')
    .setAudience('appstoreconnect-v1')
    .sign(signingKey);

  // 3. Fetch the authoritative transaction — production first, then sandbox.
  //    Apple returns 404 for a sandbox transaction queried on the prod host, AND
  //    401 when the key isn't authorized for the production environment yet — which
  //    is the case for EVERY TestFlight/sandbox purchase before the app is live.
  //    In both cases the transaction lives in sandbox, so retry there on ANY non-OK
  //    prod response, not only on 404. (A genuine production receipt returns 200 on
  //    the prod host once live, so this never weakens verification: a sandbox host
  //    can't vouch for a real production transaction — it 404s — so it fails closed.)
  const path = `/inApps/v1/transactions/${encodeURIComponent(transactionId)}`;
  const getTxn = (host: string) =>
    fetch(`https://${host}${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
  let resp = await getTxn('api.storekit.itunes.apple.com');
  if (!resp.ok) resp = await getTxn('api.storekit-sandbox.itunes.apple.com');
  if (!resp.ok) throw new Error(`Apple App Store Server API ${resp.status}`);

  // 4. The response carries an Apple-signed transaction JWS; decode + validate it.
  const { signedTransactionInfo } = (await resp.json()) as { signedTransactionInfo: string };
  const txn = decodeJwt(signedTransactionInfo) as { bundleId?: string; productId?: string };
  if (txn.bundleId !== APPLE_BUNDLE_ID) throw new Error('Apple: bundleId mismatch');
  if (!txn.productId || !KNOWN_SKUS.has(txn.productId)) throw new Error('Apple: unknown productId');

  return { transactionId, sku: txn.productId };
}

/** Exchange the Play service account's key for an androidpublisher-scoped OAuth2
 *  access token (RFC 7523 JWT bearer grant). */
async function googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  // Dashboard-pasted secrets often carry literal "\n" in the PEM — normalize.
  const key = await importPKCS8(sa.private_key.replace(/\\n/g, '\n'), 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/androidpublisher' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!resp.ok) throw new Error(`Google OAuth token exchange failed: ${resp.status}`);
  const { access_token } = (await resp.json()) as { access_token?: string };
  if (!access_token) throw new Error('Google OAuth token exchange returned no token');
  return access_token;
}

/**
 * Verify a Google Play purchase token against the Play Developer API and return
 * the authoritative { transactionId, sku }. The request URL binds token↔sku↔package
 * — Google rejects a mismatch — so a 200 with purchaseState 0 IS the trust anchor.
 * Fail closed until GOOGLE_SERVICE_ACCOUNT_JSON / ANDROID_PACKAGE_NAME are set.
 */
async function verifyGoogle(purchaseToken: string, sku: string): Promise<VerifiedPurchase> {
  const svcAccount = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  const pkg = Deno.env.get('ANDROID_PACKAGE_NAME');
  if (!svcAccount || !pkg) {
    throw new VerificationUnavailable('Google verification not configured');
  }
  if (!purchaseToken || !sku) throw new VerificationUnavailable('Google verification: missing token/sku');

  const token = await googleAccessToken(JSON.parse(svcAccount));
  const base = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
    + `${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(sku)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const resp = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Google Play Developer API ${resp.status}`);
  const p = (await resp.json()) as {
    purchaseState?: number; // 0 purchased, 1 canceled, 2 pending
    acknowledgementState?: number; // 0 yet-to-acknowledge, 1 acknowledged
    orderId?: string;
  };
  if (p.purchaseState !== 0) throw new Error(`Google: purchaseState ${p.purchaseState} is not purchased`);

  // Defensive server-side acknowledge: stops Google's 3-day auto-refund even if
  // the client dies before consuming (consume still works on an acknowledged
  // purchase). Best-effort — crediting never depends on it.
  if (p.acknowledgementState === 0) {
    fetch(`${base}:acknowledge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  }

  // orderId (GPA.…) is the human-traceable id, but license-tester purchases can
  // omit it — the purchaseToken (unique per purchase) keeps idempotency intact.
  return { transactionId: p.orderId || purchaseToken, sku };
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing auth' }, 401, cors);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'invalid auth' }, 401, cors);
    const uid = userData.user.id;

    const { platform, sku, receipt } = (await req.json().catch(() => ({}))) as {
      platform?: string;
      sku?: string;
      receipt?: string; // iOS: signed JWS; Android: purchaseToken
    };
    if (platform !== 'ios' && platform !== 'android') return json({ error: 'invalid platform' }, 400, cors);
    if (!sku || !KNOWN_SKUS.has(sku)) return json({ error: 'unknown sku' }, 400, cors);
    if (!receipt) return json({ error: 'missing receipt' }, 400, cors);

    // Trust anchor: verify with the platform before crediting anything.
    let verified: VerifiedPurchase;
    try {
      verified = platform === 'ios' ? await verifyApple(receipt) : await verifyGoogle(receipt, sku);
    } catch (err) {
      if (err instanceof VerificationUnavailable) {
        console.error('[fulfill-purchase] verification unavailable:', (err as Error)?.message);
        return json({ error: 'purchase verification unavailable' }, 503, cors);
      }
      // Surface the real reason in the function logs so verification failures are
      // diagnosable (e.g. "Apple App Store Server API 401") without re-instrumenting.
      console.error('[fulfill-purchase] verification failed:', (err as Error)?.message ?? err);
      return json({ error: 'purchase verification failed' }, 402, cors);
    }

    // The verified product must match the SKU the client claims.
    if (verified.sku !== sku) return json({ error: 'sku mismatch' }, 400, cors);

    const admin = createClient(url, serviceKey);
    const { data: balance, error } = await admin.rpc('fulfill_purchase', {
      p_user: uid,
      p_platform: platform,
      p_transaction_id: verified.transactionId,
      p_sku: sku,
    });
    if (error) return json({ error: error.message }, 500, cors);

    return json({ ok: true, balance }, 200, cors);
  } catch (err) {
    return json({ error: (err as Error).message ?? 'fulfillment failed' }, 500, cors);
  }
});
