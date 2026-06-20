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

const ALLOWED_ORIGINS = new Set<string>([
  'tauri://localhost',
  'https://tauri.localhost',
  'http://tauri.localhost',
  'http://localhost:5174',
  'https://playelector.com',
]);
const FALLBACK_ORIGIN = 'https://playelector.com';

// SKUs the native rails may grant (the authoritative grant amounts live in SQL).
const KNOWN_SKUS = new Set<string>([
  'funds_small', 'funds_medium', 'funds_large',
  'unlock_washington', 'unlock_joe_biden', 'unlock_ronald_reagan',
]);

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
 * Verify an Apple StoreKit 2 signed transaction (JWS) against the App Store
 * Server API and return the authoritative { transactionId, productId }.
 *
 * TODO(native): implement using APPLE_ISSUER_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY:
 *   1. mint an ES256 JWT (aud "appstoreconnect-v1", iss=issuer, kid=keyId),
 *   2. GET https://api.storekit.itunes.apple.com/inApps/v1/transactions/{id}
 *      (or .sandbox host in dev), with Authorization: Bearer <jwt>,
 *   3. decode the returned signedTransactionInfo JWS, confirm productId & bundleId.
 * Fail closed until configured.
 */
async function verifyApple(jws: string): Promise<VerifiedPurchase> {
  const issuer = Deno.env.get('APPLE_ISSUER_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const privateKey = Deno.env.get('APPLE_PRIVATE_KEY');
  if (!issuer || !keyId || !privateKey) {
    throw new VerificationUnavailable('Apple verification not configured');
  }
  if (!jws) throw new VerificationUnavailable('Apple verification: empty receipt');
  // TODO(native): mint the ES256 JWT and call the App Store Server API here.
  throw new VerificationUnavailable('Apple verification not yet implemented');
}

/**
 * Verify a Google Play purchase token against the Play Developer API and return
 * the authoritative { transactionId (orderId/token), productId }.
 *
 * TODO(native): implement using GOOGLE_SERVICE_ACCOUNT_JSON + ANDROID_PACKAGE_NAME:
 *   1. service-account JWT → OAuth2 access token (androidpublisher scope),
 *   2. GET .../androidpublisher/v3/applications/{pkg}/purchases/products/{sku}/tokens/{token},
 *   3. confirm purchaseState === 0 (purchased); use the token as the txn id.
 * Fail closed until configured.
 */
async function verifyGoogle(purchaseToken: string, sku: string): Promise<VerifiedPurchase> {
  const svcAccount = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  const pkg = Deno.env.get('ANDROID_PACKAGE_NAME');
  if (!svcAccount || !pkg) {
    throw new VerificationUnavailable('Google verification not configured');
  }
  if (!purchaseToken || !sku) throw new VerificationUnavailable('Google verification: missing token/sku');
  // TODO(native): service-account OAuth → Play Developer API purchases.products.get.
  throw new VerificationUnavailable('Google verification not yet implemented');
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
        return json({ error: 'purchase verification unavailable' }, 503, cors);
      }
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
