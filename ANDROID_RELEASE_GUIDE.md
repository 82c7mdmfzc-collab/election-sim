# Elector — Android / Google Play Release Guide

Current as of 2026-07-02. Mirror of `IOS_RELEASE_GUIDE.md` for the Google Play rail.
Package id `com.playelector.app`, version `1.0.0`, versionCode managed in
`src-tauri/tauri.conf.json` → `bundle.android.versionCode`.

## One-time machine setup (already done on this Mac)

1. Android Studio (Homebrew cask) + SDK packages: Platform 36, Build-Tools 36,
   Platform-Tools, NDK 28.2.13676358, Emulator, `system-images;android-36;google_apis_playstore;arm64-v8a`.
2. `~/.zshrc` exports: `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME` (Android Studio's JBR),
   platform-tools/emulator on PATH.
3. `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
4. Upload keystore at `~/.android-keys/elector-upload.jks` with its
   `~/.android-keys/elector-upload.properties` (password/keyAlias/storeFile, chmod 600).
   **Back both up off-machine** (password manager + cloud). This is only the *upload*
   key — Play App Signing (default) holds the real release key, so a lost upload key
   is recoverable via Play Console support.

## Project generation (after a fresh clone or `gen/` wipe)

```bash
npm run tauri:android:init        # generates src-tauri/gen/android (gitignored)
scripts/android-prepare-gen.sh    # icons, sensorLandscape, targetSdk assert, signing wiring
```

The prepare script is idempotent and re-run automatically by the build scripts.

## Development

```bash
npm run tauri:android:dev         # wraps scripts/android-dev.sh
```

The wrapper exports `VITE_NATIVE_PLATFORM=android` (+ `VITE_ENABLE_NATIVE_REWARDED_ADS`
unless `ELECTOR_NO_NATIVE_ADS=1`). Never run `tauri android dev` bare — platform
detection is build-time and billing/ads silently disable without the env var.

Emulator: AVD `elector-play` (Pixel 7, API 36, **Google Play** image — required for
Billing and AdMob testing). Start with `emulator -avd elector-play`.

## Release build

```bash
scripts/android-upload.sh         # bump versionCode → commit/push → signed .aab
ELECTOR_NO_SYNC=1 scripts/android-upload.sh   # skip the ff-sync while iterating
```

Refuses to build while `tauri.conf.json` still carries Google's TEST AdMob ids.
Output: `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`
→ upload manually in Play Console (Testing → Internal testing first).

## Manual console setup (one-time, before the first release)

### Google Play Console (account already registered)
1. Create app **Elector** — package `com.playelector.app`, Game, Free.
2. **Monetize → Products → In-app products**: create the 6 consumable-style products
   (ids must match `supabase/iap.sql` and `src/utils/iap.ts`):
   `funds_600` $0.99/£0.99 · `funds_1500` $2.99/£1.99 · `funds_4000` $4.99/£3.99 ·
   `funds_9000` $8.99/£7.99 · `funds_20000` $14.99/£14.99 · `funds_45000` $19.99/£19.99
3. **Settings → License testing**: add tester Gmail accounts (test purchases, no charge).
4. **Store listing**: reuse `APP_STORE_LISTING.md` copy; icon `public/icon-512.png`;
   feature graphic 1024×500 (generate via `scripts/gen-brand-assets.py`); screenshots
   (landscape phone + 7"/10" tablet if available).
5. **Data safety form**: PostHog EU (analytics — app interactions, pseudonymous ids),
   Supabase (account — email, user ids, gameplay records), AdMob (Advertising ID,
   collected by SDK, advertising purpose). Account deletion URL:
   `https://playelector.com/delete-account`. Privacy policy:
   `https://www.playelector.com/privacy`.
6. **Content rating** questionnaire + **Ads declaration: yes**.
7. Enroll in **Play App Signing** (default on app creation).

### Google Cloud (server-side purchase verification)
1. Create a service account in any GCP project; download its JSON key.
2. Play Console → **Users and permissions → Invite** the service-account email with
   *View financial data* + *Manage orders* (grants the androidpublisher scope).
3. Set the Supabase secrets (the fulfill-purchase edge function is fail-closed until
   these exist):
   ```bash
   supabase secrets set --project-ref rwavsfyjjqfwefabcfvv \
     GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
     ANDROID_PACKAGE_NAME=com.playelector.app
   ```

### AdMob
1. AdMob console → Apps → Add app → Android, package `com.playelector.app`
   → copy the **App ID** (`ca-app-pub-…~…`).
2. Create a **Rewarded** ad unit → copy the **unit ID** (`ca-app-pub-…/…`).
3. Put both real ids in `src-tauri/tauri.conf.json` under `plugins.elector-admob`
   (`androidAppId`, `androidRewardedAdUnitId`), commit, and re-run the iOS build
   check (the config shape is shared across platforms).
4. `public/app-ads.txt` is already live at playelector.com — confirm AdMob's
   app-ads.txt status once the store listing is public.

## Release gates (run before every Play submission)

- `npm run test && npm run lint && npm run build && npm run test:mobile-native`
  and `node test_vsbot_smoke.mjs` (dev server on :5174).
- Emulator smoke: boot via `npm run tauri:android:dev` — landscape lock, OAuth
  deep-link round-trip, hardware back matrix (modal → screen → minimize game →
  background at Home).
- Internal-testing track on a physical device: all 6 packs show localized Play
  prices; buy → funds credit; immediate re-buy works (consume ok); kill the app
  between purchase and credit → Shop reopen recovers it; rewarded ad grants funds.
- Two-device multiplayer (Android vs iOS/web) through Election Night; airplane-mode
  blip shows the "Reconnecting…" banner and recovers.
- Review Google's **pre-launch report** after each upload.
