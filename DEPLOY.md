# Elector Deployment Runbook

Current as of 2026-06-28.

## Release Shape

- Public v1 target: **web + iOS**.
- Android: fast-follow.
- Current app version: `1.0.0`.
- Latest iOS build uploaded to TestFlight: `25`.
- Production Supabase project ref: `rwavsfyjjqfwefabcfvv`.

## Required Local Gates

```bash
npm run test
npm run lint
npm run build
npm run test:mobile-native
npm run dev -- --host 127.0.0.1 --port 5174
node test_vsbot_smoke.mjs
```

The smoke test targets `http://127.0.0.1:5174`; using `localhost` can hit a different local app on this machine.

## Database Deployment

Production DB deploys are handled by `.github/workflows/deploy-db.yml` on pushes to `main` that touch `supabase/*.sql`.

The workflow applies SQL in this order:

1. `profiles`
2. `lobbies`
3. `rewards`
4. `cosmetics`
5. `iap`
6. `ads`
7. `daily`
8. `referrals`
9. `moderation`
10. `notifications`

All files are intended to be idempotent. `supabase/security-hardening-patch.sql` is a local/manual include runner, not the CI path.

Required GitHub secret:

- `SUPABASE_DB_URL` — session-pooler Postgres URL with permission to apply schema.

## Edge Functions

Production Edge Function deploys are handled by `.github/workflows/deploy-functions.yml` when function code or `src/game/**` changes.

The workflow:

- Runs `node scripts/build-edge-function.mjs`.
- Deploys `resolve-turn`.
- Deploys `fulfill-purchase`.

Required GitHub secret:

- `SUPABASE_ACCESS_TOKEN`

Manual deploy commands:

```bash
npm run build:edge
supabase functions deploy resolve-turn --project-ref rwavsfyjjqfwefabcfvv
supabase functions deploy fulfill-purchase --project-ref rwavsfyjjqfwefabcfvv
```

## Supabase Auth Configuration

Accounts are required for online play, Campaign Funds, unlocks, stats, referrals, rewarded ads, and purchases. Guest play is only for Solo/pass-and-play without persistent economy.

Dashboard checklist:

- Anonymous auth OFF.
- Email auth ON, OTP length 8, expiry 900 seconds.
- Magic Link email template includes both `{{ .ConfirmationURL }}` and `{{ .Token }}`.
- Google provider ON.
- Apple provider ON.
- Redirect allowlist includes:
  - `https://playelector.com`
  - `https://www.playelector.com`
  - Vercel preview URL
  - `http://127.0.0.1:5174`
  - `http://localhost:5174`
  - `com.playelector.app://auth-callback`

## Security Verification

- anon `GET /rest/v1/profiles` does not expose other users.
- anon direct `POST`/`PATCH` to `lobbies` is rejected.
- non-participants cannot read an `in_progress` lobby.
- reward replay returns current balance without double-credit.
- purchase replay does not double-credit because `purchases.transaction_id` is unique.
- online phase transitions go through `resolve-turn`.

## Web Deployment

Vercel env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_POSTHOG_KEY`
- `VITE_POSTHOG_HOST=https://eu.i.posthog.com`
- `VITE_APP_VERSION=1.0.0`

Routes provided by `vercel.json`:

- `/privacy`
- `/support`
- `/delete-account`
- SPA fallback to `index.html`

Deploy:

```bash
vercel --prod
```

## iOS Deployment

Use:

```bash
ELECTOR_NO_SYNC=1 scripts/ios-upload.sh
```

The script patches generated Xcode files, bumps `bundle.iOS.bundleVersion`, commits and pushes the bump, archives, exports an IPA, and uploads to App Store Connect.

Latest successful upload:

- Build `25`
- Delivery UUID `e8aabaf6-9dea-4b02-a7db-e998854d690a`
- IPA path after export: `src-tauri/gen/apple/build/export/Elector.ipa`

## Remaining Manual Release Gates

- Domain DNS and Vercel production domain verification.
- Supabase auth/provider settings.
- App Store Connect product setup for all six funds SKUs.
- Supabase Apple purchase-verification secrets.
- TestFlight processing, internal testing, screenshots, and App Review submission.
- Two-device online multiplayer verification.
