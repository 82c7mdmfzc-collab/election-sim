# Elector — Public Release Checklist

Current as of 2026-06-28. Public v1 is **web + iOS first**; Android is a fast-follow once the Play Billing and store setup work is active.

## Current State

- **App:** Elector, bundle id `com.playelector.app`, version `1.0.0`.
- **Latest iOS build:** build `25`, uploaded to App Store Connect/TestFlight. Delivery UUID: `e8aabaf6-9dea-4b02-a7db-e998854d690a`.
- **GitHub:** `main` / `origin/main` at `3558c72` (`chore: bump iOS build number to 25`).
- **Supabase project:** `rwavsfyjjqfwefabcfvv`, URL `https://rwavsfyjjqfwefabcfvv.supabase.co`.
- **Vercel project:** `election-sim`; production domain target is `playelector.com`.
- **Required pages:** `/privacy`, `/support`, and `/delete-account` are present in `public/` and routed by `vercel.json`.

## Done

- [x] Public-release readiness pass committed and pushed.
- [x] Bobby Tooley restored as a free neutral baseline; premium candidate roster is now Reagan, Washington, Starmer, Farage, and JFK.
- [x] Server premium-unlock counting fixed in `supabase/rewards.sql`.
- [x] CI DB deploy order includes `profiles`, `lobbies`, `rewards`, `cosmetics`, `iap`, `ads`, `daily`, `referrals`, `moderation`, `notifications`.
- [x] iOS project generated and archive/upload flow works via `scripts/ios-upload.sh`.
- [x] Native OAuth URL scheme `com.playelector.app://auth-callback` registered in Tauri/iOS config.
- [x] App icon, PWA icons, OG image, logo, portraits, tokens, group art, coin art, and victory art are present.
- [x] Automated gates pass: `npm run test`, `npm run lint`, `npm run build`, `npm run test:mobile-native`, and `node test_vsbot_smoke.mjs`.

## Before Public Web Launch

- [ ] Point `playelector.com` and `www.playelector.com` at Vercel; choose the primary redirect.
- [ ] Confirm production env vars in Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST=https://eu.i.posthog.com`, `VITE_APP_VERSION=1.0.0`.
- [ ] Deploy `main` to Vercel production.
- [ ] Open `https://playelector.com`, `/privacy`, `/support`, and `/delete-account` on desktop and phone.
- [ ] Run a fresh guest flow: landing → tutorial skip/complete → solo game starts.
- [ ] Run a signed-in progression flow: finish game → Campaign Funds/stats update → replay same game id does not double-grant.

## Supabase / Security

- [ ] Confirm `SUPABASE_DB_URL` and `SUPABASE_ACCESS_TOKEN` GitHub secrets are set so DB/function deploy workflows work from `main`.
- [ ] Confirm SQL deploy has applied all current files in `.github/workflows/deploy-db.yml`.
- [ ] Confirm Edge Functions deployed: `resolve-turn` and `fulfill-purchase`.
- [ ] Auth settings:
  - Anonymous auth OFF.
  - Email auth ON with 8-digit OTP and 900-second expiry.
  - Magic Link template includes both `{{ .ConfirmationURL }}` and `{{ .Token }}`.
  - Google provider ON.
  - Apple provider ON.
  - Redirect URLs include `https://playelector.com`, `https://www.playelector.com`, Vercel preview URL, `http://127.0.0.1:5174`, `http://localhost:5174`, and `com.playelector.app://auth-callback`.
- [ ] Rotate any credentials that were ever pasted into chat or shell history: Supabase secret/service-role keys and any GitHub PAT.
- [ ] Verify RLS:
  - anon `GET /rest/v1/profiles` does not expose other users.
  - anon direct `POST`/`PATCH` to `lobbies` is rejected.
  - non-participant cannot read an `in_progress` lobby.
- [ ] Replay old exploits: double reward claim, raw lobby write, stale guest state, early phase resolution before server deadline.

## iOS / TestFlight

- [x] Full Xcode, CocoaPods, Cargo, iOS Rust targets, App Store Connect API key, and generated Xcode project are present on this machine.
- [x] Build `25` uploaded to App Store Connect/TestFlight.
- [ ] Wait for App Store Connect processing.
- [ ] Add build `25` to internal TestFlight testing.
- [ ] Confirm app privacy, age rating, support URL, privacy URL, and account deletion URL in App Store Connect.
- [ ] Create/confirm the six consumable IAP products: `funds_600`, `funds_1500`, `funds_4000`, `funds_9000`, `funds_20000`, `funds_45000`.
- [ ] Confirm App Store Server API secrets are set in Supabase for purchase verification: `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`.
- [ ] Sandbox/TestFlight test every funds pack at least once: purchase → server verifies → balance credits once → replay does not double-credit.
- [ ] Test iOS auth: email code, Google OAuth, Apple OAuth, native deep-link return.
- [ ] Test iOS rewarded ad path and quota: 5 claims per rolling 12 hours, 6th blocked.
- [ ] Capture required screenshots: Home, Solo setup, gameplay, account/progression, shop, victory.

## Online Multiplayer Gate

- [ ] Two-device web ↔ web full game through election/game-over.
- [ ] Two-device iOS ↔ web full game through election/game-over.
- [ ] Confirm turn submissions, waiting state, phase transitions, election tally, game-over rewards, and lobby recovery after refresh.

## Android / Google Play (see ANDROID_RELEASE_GUIDE.md for the full runbook)

Code-side done (2026-07-02): toolchain installed, gen project + prepare/dev/upload
scripts, hardware back button, Play Billing client + `verifyGoogle` server rail,
Kotlin AdMob rewarded-ads plugin, upload keystore generated.

Remaining (manual consoles):

- [ ] Play Console: create app `com.playelector.app`, store listing, data safety,
      content rating + ads declaration, Play App Signing, license testers.
- [ ] Play Console: create the 6 in-app products (`funds_600` … `funds_45000`).
- [ ] Google Cloud: service account + Play permissions; set Supabase secrets
      `GOOGLE_SERVICE_ACCOUNT_JSON`, `ANDROID_PACKAGE_NAME`.
- [ ] AdMob: Android app + rewarded unit; land real ids in tauri.conf.json
      (replaces the Google TEST ids — android-upload.sh refuses to ship them).
- [ ] `scripts/android-upload.sh` → upload the `.aab` to Internal Testing; run the
      billing/ads/multiplayer smoke gates on a physical device; review the
      pre-launch report.

## Deferred

- Bundle code-splitting: current production build warns on the main JS chunk at about 1.27 MB minified / 389 KB gzip. Prioritize shop/native/progression surfaces after v1 unless real-device startup performance is poor.
- WebP conversion for image assets.

## Handy Commands

```bash
npm run test
npm run lint
npm run build
npm run test:mobile-native
npm run dev -- --host 127.0.0.1 --port 5174
node test_vsbot_smoke.mjs
npm run build:edge
supabase functions deploy resolve-turn --project-ref rwavsfyjjqfwefabcfvv
supabase functions deploy fulfill-purchase --project-ref rwavsfyjjqfwefabcfvv
ELECTOR_NO_SYNC=1 scripts/ios-upload.sh
```
