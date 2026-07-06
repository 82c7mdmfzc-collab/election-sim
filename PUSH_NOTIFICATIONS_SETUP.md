# Push Notifications — setup guide

Custom admin-authored push (delivered even when the app is closed) via **APNs**
(iOS) and **FCM** (Android). The code ships **fail-soft**: everything below can
land before the keys exist — the senders no-op and the client registration simply
stores nothing useful — so nothing breaks until you complete these manual steps.

## Moving parts (already in the repo)

| Piece | Where |
| --- | --- |
| Device-token table | `supabase/notifications.sql` → `public.device_tokens` (already deployed) |
| APNs sender | `supabase/functions/_shared/apns.ts` (`sendApnsPush`) |
| FCM sender | `supabase/functions/_shared/fcm.ts` (`sendFcmPush`) |
| Broadcast endpoint | `supabase/functions/admin-broadcast/index.ts` (admin-gated, deployed by CI) |
| Client token registration | `src/utils/pushRegistration.ts` + `elector-push` Tauri plugin |
| iOS push entitlement | `scripts/ios-prepare-gen.sh` (`aps-environment`) |
| Android FCM Gradle wiring | `scripts/android-prepare-gen.sh` (google-services) |
| Admin UI | `admin/index.html` → "Send push notification" card |

## 1. Apple (APNs)

1. Apple Developer → **Identifiers** → App ID `com.playelector.app` → enable
   **Push Notifications**.
2. **Keys** → create an **APNs Auth Key** (`.p8`). Note the **Key ID**; the Team ID
   is your Apple Team ID.
3. Set the Supabase **Edge Function secrets** (Project settings → Edge Functions):
   - `APNS_KEY_ID` — the .p8 Key ID
   - `APPLE_TEAM_ID` — Apple Team ID
   - `APNS_PRIVATE_KEY` — the full `.p8` contents (PKCS#8 PEM; `\n` escaping tolerated)
4. In the Apple Developer portal, regenerate the **Elector App Store Distribution**
   provisioning profile so it includes the new Push capability.
5. Rebuild + upload with the push entitlement enabled:
   `ELECTOR_PUSH_ENTITLEMENT=1 scripts/ios-upload.sh`. The entitlement is **opt-in**
   (`ELECTOR_PUSH_ENTITLEMENT=1`) — off by default, because signing an archive that
   carries `aps-environment` against a profile WITHOUT the Push capability fails.
   `ios-upload.sh` sets `APS_ENVIRONMENT=production` for the App Store archive;
   local dev builds default to `development`.

## 2. Firebase (FCM, Android)

1. Create a Firebase project; add an **Android app** with package
   `com.playelector.app`. Download **`google-services.json`** and drop it at
   `~/.android-keys/google-services.json` (preferred) or `src-tauri/google-services.json`.
   `scripts/android-prepare-gen.sh` stages it and wires the google-services Gradle
   plugin **only when present** (so builds without it are unaffected).
2. Firebase → Project settings → **Service accounts** → generate a private key
   (JSON). Set the Supabase secret:
   - `FCM_SERVICE_ACCOUNT` — the whole service-account JSON (the `project_id` is
     read from the JSON, so no separate project-id secret is needed).
3. Rebuild + upload the Android app.

## 3. Admin — sending

The push composer lives in the standalone `admin/index.html` (same page as the
update-config gate). Open it locally, Connect + sign in with the admin email
(must be in `public.app_admins`), then use the **Send push notification** card:
title, message, target (all / iOS / Android). The response reports how many were
delivered and whether APNs/FCM are configured yet.

## Verify end-to-end

1. Sign in on a device build → confirm a row appears in `public.device_tokens`
   (correct `platform`, and `environment` = `sandbox` for a debug build / `prod` for
   TestFlight+App Store).
2. From `admin/index.html`, send a test push → it should arrive on the lock screen
   with the app **backgrounded** (APNs for iOS, FCM for Android).
3. A non-admin JWT calling `admin-broadcast` must get **403**.

## Notes

- APNs `environment` per token must match the build channel or delivery silently
  fails — the `elector-push` Swift picks it via `#if DEBUG` (debug→sandbox,
  release→prod), matching the `aps-environment` entitlement.
- Only **alert** pushes are sent (title/body shown by the OS), so no
  `UIBackgroundModes`/`remote-notification` capability is needed.
- `admin-broadcast` fans out synchronously; fine for the current install base. If
  `device_tokens` grows large, batch/queue the sends.
