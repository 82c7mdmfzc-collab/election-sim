#!/usr/bin/env node
/**
 * generate-apple-client-secret.cjs — build the "Sign in with Apple" client secret.
 *
 * Apple's OAuth client secret is NOT the .p8 file — it's a short-lived ES256 JWT
 * signed WITH the .p8. Supabase (Auth → Providers → Apple → "Secret Key (for OAuth)")
 * wants that JWT. Apple caps its lifetime at ~6 months, so re-run this to regenerate
 * before it expires (otherwise Apple sign-in starts failing with invalid_client).
 *
 * Usage:
 *   node scripts/generate-apple-client-secret.cjs <TEAM_ID> <KEY_ID> <SERVICES_ID> <path-to-.p8>
 *
 * Example:
 *   node scripts/generate-apple-client-secret.cjs A1B2C3D4E5 F6G7H8I9J0 \
 *     com.playelector.signin ~/Downloads/AuthKey_F6G7H8I9J0.p8
 *
 * SECURITY: the .p8 is a private key — never commit it. The printed JWT is also a
 * secret; paste it straight into Supabase and don't check it in.
 */
const crypto = require('crypto');
const fs = require('fs');

const [, , TEAM_ID, KEY_ID, SERVICES_ID, P8_PATH] = process.argv;
if (!TEAM_ID || !KEY_ID || !SERVICES_ID || !P8_PATH) {
  console.error(
    'Usage: node scripts/generate-apple-client-secret.cjs <TEAM_ID> <KEY_ID> <SERVICES_ID> <path-to-.p8>',
  );
  process.exit(1);
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const SIX_MONTHS = 60 * 60 * 24 * 180; // Apple's max client-secret lifetime is ~6 months
const now = Math.floor(Date.now() / 1000);

const header = { alg: 'ES256', kid: KEY_ID };
const payload = {
  iss: TEAM_ID, // your Team ID (App ID Prefix)
  iat: now,
  exp: now + SIX_MONTHS,
  aud: 'https://appleid.apple.com',
  sub: SERVICES_ID, // the Services ID, e.g. com.playelector.signin (NOT the bundle id)
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

let privateKey;
try {
  privateKey = fs.readFileSync(P8_PATH.replace(/^~/, process.env.HOME || '~'), 'utf8');
} catch (err) {
  console.error(`Could not read the .p8 at ${P8_PATH}: ${err.message}`);
  process.exit(1);
}

// ES256 = ECDSA/P-256 + SHA-256. The signature MUST be raw R||S (ieee-p1363), which
// is the JOSE/JWT encoding — NOT the DER form Node emits by default.
const signature = crypto.sign('SHA256', Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363',
});

const jwt = `${signingInput}.${b64url(signature)}`;

console.log('\nApple client secret — paste into Supabase → Auth → Providers → Apple → "Secret Key (for OAuth)":\n');
console.log(jwt);
console.log(`\nExpires ${new Date((now + SIX_MONTHS) * 1000).toISOString()} — re-run this before then.\n`);
