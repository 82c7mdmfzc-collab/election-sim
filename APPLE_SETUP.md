# Apple Setup — Sign In, IAP, and TestFlight

Current as of 2026-07-02.

## Project Facts

| Thing | Value |
| --- | --- |
| App bundle id | `com.playelector.app` |
| Supabase project | `rwavsfyjjqfwefabcfvv.supabase.co` |
| Supabase OAuth callback | `https://rwavsfyjjqfwefabcfvv.supabase.co/auth/v1/callback` |
| Web domains | `playelector.com`, `www.playelector.com` |
| Native deep link | `com.playelector.app://auth-callback` |
| App Store Connect API key id used locally | `K7JZWQB6L4` |
| Apple team id used locally | `NSUP6D9BX5` |
| Latest uploaded TestFlight build | `25` |

## Sign in with Apple

On iOS the Apple button presents the NATIVE Sign in with Apple sheet
(ASAuthorizationController via the in-repo `elector-siwa` plugin) and finishes with
`supabase.auth.signInWithIdToken` — no browser round-trip. If the native sheet is
unavailable or errors, the app falls back to browser OAuth in external Safari,
returning through `com.playelector.app://auth-callback`. On web it is plain OAuth.

The code flag `APPLE_SIGNIN_ENABLED` is currently `true` in `src/utils/authClient.ts`.
Keep the Apple provider configured in Supabase before shipping any build with that
flag enabled.

Apple Developer portal:

- App ID `com.playelector.app` has **Sign in with Apple** enabled. The
  `com.apple.developer.applesignin` entitlement is injected into the generated
  Xcode project by `scripts/ios-prepare-gen.sh` (and verified post-archive by
  `scripts/ios-upload.sh`).
- Services ID should be `com.playelector.signin`.
- Services ID configuration:
  - Primary App ID: `com.playelector.app`
  - Domains: `playelector.com`, `www.playelector.com`, `rwavsfyjjqfwefabcfvv.supabase.co`
  - Return URL: `https://rwavsfyjjqfwefabcfvv.supabase.co/auth/v1/callback`

Supabase:

- Authentication → Providers → Apple ON.
- **Client IDs MUST include BOTH** `com.playelector.signin` (web/browser OAuth) **and**
  `com.playelector.app` (the bundle id is the `aud` claim of native identity tokens —
  without it `signInWithIdToken` rejects every native sign-in).
- The provider's "Secret Key (for OAuth)" is a JWT capped at ~6 months — regenerate
  with `scripts/generate-apple-client-secret.cjs` before it expires (expiry only
  breaks the browser/web flow; the native sheet doesn't use it).
- URL Configuration redirect allowlist includes:
  - `https://playelector.com`
  - `https://www.playelector.com`
  - Vercel preview URL
  - `http://127.0.0.1:5174`
  - `http://localhost:5174`
  - `com.playelector.app://auth-callback`

Test: open the account panel, choose Apple, confirm the native sheet appears (not
Safari), complete it, and confirm the app is signed in. Test on iPhone AND iPad.

## App Review demo account

Apple requires working demo credentials (Guideline 2.1). The app has a hidden
password path: typing `applereview@playelector.com` on the sign-in screen and
tapping "Send code" reveals a password field instead of emailing an OTP
(`REVIEW_ACCOUNT_EMAIL` in `src/utils/authClient.ts`).

Server side (Supabase): the user is created in Authentication → Users (auto-confirm,
strong password) and its profile is seeded with `display_name = 'AppleReview'` and
`campaign_funds = 100000` so a reviewer can exercise every feature. The account is
excluded from `get_leaderboard` (supabase/leaderboard.sql). Keep the credentials in
App Store Connect → App Review Information up to date; rotate the password after
approval if desired (update ASC too).

## In-App Purchases

Native StoreKit purchases are implemented. The client forwards StoreKit signed transaction JWS values to `supabase/functions/fulfill-purchase`, and the server verifies with the App Store Server API before calling `fulfill_purchase`.

There is no web Stripe purchase rail. Campaign Funds top-ups are native iOS only for v1.

Required App Store Connect products:

| Product ID | Type | USD fallback | GBP fallback |
| --- | --- | ---: | ---: |
| `funds_600` | Consumable | $0.99 | £0.99 |
| `funds_1500` | Consumable | $2.99 | £1.99 |
| `funds_4000` | Consumable | $4.99 | £3.99 |
| `funds_9000` | Consumable | $8.99 | £7.99 |
| `funds_20000` | Consumable | $14.99 | £14.99 |
| `funds_45000` | Consumable | $19.99 | £19.99 |

Required Supabase Edge Function secrets for iOS purchase crediting:

```bash
supabase secrets set APPLE_ISSUER_ID=...
supabase secrets set APPLE_KEY_ID=...
supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
```

These are App Store Server API credentials, separate from Sign in with Apple credentials and separate from the local upload key.

Until these secrets are present and authorized, `fulfill-purchase` fails closed and purchases do not credit funds.

## Uploading to TestFlight

The standard command is:

```bash
ELECTOR_NO_SYNC=1 scripts/ios-upload.sh
```

The script expects:

- App Store Connect upload key at `~/.appstoreconnect/private_keys/AuthKey_K7JZWQB6L4.p8`.
- Full Xcode and CocoaPods installed.
- Generated Xcode project under `src-tauri/gen/apple`.

The latest successful upload was build `25`, delivery UUID `e8aabaf6-9dea-4b02-a7db-e998854d690a`.

## Sandbox Test

- Create or use a Sandbox Apple ID.
- Install the processed TestFlight build.
- Sign in to an Elector account.
- Purchase each funds pack once.
- Confirm balance updates server-side and persists after reinstall/sign-in.
- Replay/restore attempts must not double-credit because `public.purchases.transaction_id` is unique.
