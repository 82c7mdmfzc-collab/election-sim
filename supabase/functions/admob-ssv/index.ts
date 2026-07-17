// AdMob rewarded-ad server-side verification callback.
// Deploy with --no-verify-jwt: Google, not a signed-in player, calls this URL.
// The callback is trusted only after its ECDSA signature validates against
// Google's rotating key set; crediting is delegated to an idempotent SQL RPC.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const KEY_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const KEY_TTL_MS = 6 * 60 * 60 * 1000;

interface VerifierKey { keyId: number; pem: string }
let cachedKeys: { expires: number; keys: VerifierKey[] } | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function pemBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// AdMob sends an ASN.1 DER ECDSA signature. WebCrypto expects the fixed-width
// IEEE-P1363 r||s form for P-256, so normalize both integers to 32 bytes.
function derToP1363(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('invalid signature sequence');
  let offset = 2;
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);
  if (der[offset] !== 0x02) throw new Error('invalid signature r');
  const rLength = der[offset + 1];
  const r = der.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (der[offset] !== 0x02) throw new Error('invalid signature s');
  const sLength = der[offset + 1];
  const s = der.slice(offset + 2, offset + 2 + sLength);
  const out = new Uint8Array(64);
  const normalizedR = r[0] === 0 ? r.slice(1) : r;
  const normalizedS = s[0] === 0 ? s.slice(1) : s;
  if (normalizedR.length > 32 || normalizedS.length > 32) throw new Error('oversized signature');
  out.set(normalizedR, 32 - normalizedR.length);
  out.set(normalizedS, 64 - normalizedS.length);
  return out;
}

async function verifierKeys(): Promise<VerifierKey[]> {
  if (cachedKeys && cachedKeys.expires > Date.now()) return cachedKeys.keys;
  const response = await fetch(KEY_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`key server ${response.status}`);
  const payload = await response.json() as { keys?: Array<{ keyId?: number; pem?: string }> };
  const keys = (payload.keys ?? []).filter((key): key is VerifierKey =>
    Number.isInteger(key.keyId) && typeof key.pem === 'string' && key.pem.includes('PUBLIC KEY'));
  if (!keys.length) throw new Error('no verifier keys');
  cachedKeys = { keys, expires: Date.now() + KEY_TTL_MS };
  return keys;
}

async function validSignature(url: URL): Promise<boolean> {
  const raw = url.search.slice(1);
  const signatureMarker = raw.lastIndexOf('&signature=');
  const keyMarker = raw.lastIndexOf('&key_id=');
  if (signatureMarker <= 0 || keyMarker <= signatureMarker) return false;

  const signedContent = raw.slice(0, signatureMarker);
  const signature = url.searchParams.get('signature');
  const keyId = Number(url.searchParams.get('key_id'));
  if (!signature || !Number.isInteger(keyId)) return false;

  const verifier = (await verifierKeys()).find((key) => key.keyId === keyId);
  if (!verifier) return false;
  const key = await crypto.subtle.importKey(
    'spki',
    arrayBuffer(pemBytes(verifier.pem)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    arrayBuffer(derToP1363(decodeBase64Url(signature))),
    new TextEncoder().encode(signedContent),
  );
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const url = new URL(request.url);
  try {
    if (!(await validSignature(url))) return json({ error: 'invalid signature' }, 401);

    const token = url.searchParams.get('custom_data') ?? '';
    const transactionId = url.searchParams.get('transaction_id') ?? '';
    const adUnit = url.searchParams.get('ad_unit');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
      return json({ error: 'invalid claim token' }, 400);
    }
    if (!/^[A-Za-z0-9._-]{8,160}$/.test(transactionId)) {
      return json({ error: 'invalid transaction id' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data, error } = await supabase.rpc('finalize_ad_reward_ssv', {
      p_token: token,
      p_transaction_id: transactionId,
      p_ad_unit: adUnit,
    });
    if (error) throw error;
    return json({ ok: true, result: data });
  } catch (error) {
    console.error('[admob-ssv]', error);
    return json({ error: 'verification unavailable' }, 503);
  }
});
