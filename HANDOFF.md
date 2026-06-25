# Handover — Mobile-native feel + notifications (for codex)

**Date:** 2026-06-22
**Branch:** `mobile-native-feel-and-notifications` (off `main`, pushed to origin).
**Work in the MAIN checkout** `/Users/dantooley/election-sim` — that's where this branch is
checked out. (Ignore the `.claude/worktrees/jolly-buck-*` worktree; it's on a different, stale branch.)

Full original plan: `/Users/dantooley/.claude/plans/the-game-is-now-golden-sutherland.md`.

---

## Conventions (do not deviate)
- **Quality gates, run all before every commit:** `npm run build` (tsc+vite) · `npm run lint` · `npm test` (vitest, 106 tests). All pass as of Phase 7.
- **Commit AND push after each phase, no confirmation.** End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Native-feel changes are gated to `html.native` / `@media (hover:hover)` / the `src/utils/platform.ts`
  detector so the **secondary website never regresses**. iOS min deployment is **15.0**.
- **`Cargo.lock` is intentionally left unsynced** after adding Rust plugin deps — it syncs on the next
  native `tauri ios build`. (haptics, iap, AND notification deps are all declared in Cargo.toml but not in
  the committed lock; this matches how every prior phase handled it. Do NOT commit a `cargo generate-lockfile`
  result — it mass-bumps unrelated crates that can't be verified without an iOS build.)

---

## DONE — committed & pushed (this session)
- **Phase 5 — full-bleed layouts** (`427bf66`): `src/App.css` — `html.native .shop` and `html.native .setup`
  get `max-width:none` + safe-area padding so their responsive grids fill iPad instead of letterboxing.
  Web stays centered. Modals/menus/heroes intentionally untouched.
- **Phase 6 — native chrome** (`09f5e36`): `src-tauri/Info.ios.plist` adds `UIStatusBarStyleLightContent`
  + `UIViewControllerBasedStatusBarAppearance=false`; `index.html` adds inline `html,body{background:#0b1426}`
  to kill the white launch flash. `theme-color` already == `--bg`. Share sheet (shareImage.ts navigator.share)
  verified already correct.
- **Phase 7 — local notifications / 8a** (`3c68656`): official cross-platform `@tauri-apps/plugin-notification`
  wired (plain Cargo dep + unconditional `init()` in `lib.rs` + `notification:default` in
  `capabilities/default.json` + npm pkg already installed). New `src/utils/notifications.ts` (mirrors
  haptics.ts: dynamic-import, no-op on web). Re-engagement nudges re-armed on every finished game from
  `useProfile.applyGameResult` (daily-streak nudge next-day-6pm signed-in-only; come-back +3d). Permission
  requested from the game-end hook (after first game, never launch), once (`localPrefs.notifPermissionAsked`).

(Also on this branch: `c7b3360` — privacy.html now discloses Sentry crash reporting.)

---

## IN PROGRESS — Phase 8 / 8b remote push (UNCOMMITTED, UNVERIFIED)

Three server-side files are **written but not yet committed or verified** (the verify step was interrupted):

1. **NEW `supabase/notifications.sql`** — `device_tokens(user_id, token, platform, environment, updated_at)`
   table, PK `(user_id, token)`, RLS owner-only (select/insert/update/delete), `device_tokens_user_idx`.
2. **NEW `supabase/functions/_shared/apns.ts`** — APNs helper. Mints ES256 provider JWT with the **same
   `jsr:@panva/jose@6` pattern as `fulfill-purchase`** (`SignJWT`/`importPKCS8`), header `{alg:'ES256', kid:APNS_KEY_ID}`,
   issuer `APPLE_TEAM_ID`; HTTP/2 POST `https://api.push.apple.com/3/device/{token}` (or `api.sandbox.push.apple.com`
   per token `environment`), topic `com.playelector.app`. Prunes 410 tokens. **Fail-soft: no-op until secrets
   APNS_KEY_ID/APPLE_TEAM_ID/APNS_PRIVATE_KEY exist.** Exports `apnsConfigured()`, `sendApnsPush()`, `pushToLobby()`.
3. **MODIFIED `supabase/functions/resolve-turn/index.ts`** — added `import { pushToLobby } from '../_shared/apns.ts'`,
   a `background()` helper (`EdgeRuntime.waitUntil`, swallows errors, never blocks/fails the response), and 3
   fire-and-forget triggers: **startGame** → "match has begun" (exclude host uid); **phase advance →
   new PLANNING** → "Your move" (exclude caller uid); **phase advance → GAME_OVER** → "Final results are in".
   Recipients = `lobby_participants.auth_uid` → `device_tokens.user_id`. **Completely inert in prod until APNs
   secrets are set** (pushToLobby bails on `!apnsConfigured()`), so it cannot affect live turn resolution.

### Immediate next steps for codex
1. **Verify** (this is exactly where the previous session was interrupted):
   - `npm run build && npm run lint && npm test` — these MUST still pass (supabase/ is excluded from the app
     tsc, so the app is unaffected; this just confirms no accidental app-side breakage).
   - If `deno` is installed: `deno check supabase/functions/resolve-turn/index.ts` to type-check apns.ts +
     the resolve-turn edits against their `jsr:` imports. (May need network to fetch jsr deps.)
2. **Commit + push** the three files as "Native feel phase 8 (server side): remote-push scaffolding for
   multiplayer turns (APNs) — inert until secrets configured".

---

## Phase 8 REMAINING — native client + manual (needs a device + Apple account; deferred on purpose)

These could NOT be done in a headless session — they need an on-device iOS build and the user's Apple account:

- **Community push plugin** (registers APNs delegates / device-token callback). Plan prefers **Choochmeque's
  `tauri-plugin-notifications`** (FCM+APNs, same author as the IAP plugin already used) or `tauri-plugin-remote-push`.
  ⚠️ Some swizzle the AppDelegate — **pin a version and VERIFY on a real build**; this can break the iOS build,
  which is why it was deferred. Wire like haptics/iap: Cargo dep, `init()` in `lib.rs`, capability, npm pkg.
- **Client token registration** — new code (e.g. extend `src/utils/notifications.ts` or a new module): on
  launch/login get the device token from the plugin and `upsert` into `device_tokens`; `delete` the row on
  sign-out (hook into `useProfile.signOut`). No-op on web.
- **Apple manual prerequisites:**
  - APNs Auth Key: Apple Developer → Keys → enable *Apple Push Notifications service* → download `.p8`, note
    **Key ID** + **Team ID**. Set Supabase secrets `APNS_KEY_ID`, `APPLE_TEAM_ID`,
    `APNS_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"`. (Different `.p8` from Sign-in and IAP.)
  - `aps-environment` entitlement + **Push Notifications** capability on the App ID and in the iOS target.
    Mirror the version-controlled `Info.ios.plist`/entitlements approach since `gen/apple/` regenerates.
- **Deploy:** apply `supabase/notifications.sql` to prod (linked project `rwavsfyjjqfwefabcfvv`, e.g.
  `supabase db query --linked -f supabase/notifications.sql` — same way ads.sql/moderation.sql were applied);
  then `npm run build:edge && supabase functions deploy resolve-turn`.
- **Verify on device:** token upserts on launch; in a 2-device game, backgrounding one device and resolving a
  turn delivers an APNs "Your move" alert; tapping opens the lobby; 410 tokens pruned; foregrounded device not
  double-notified (iOS suppresses the banner while active).

### Optional polish noted but not done
- "X is waiting on you" push on the last unsubmitted player (Branch 0b `submitTurn`) — skipped to avoid noise.
- WKWebView-level `backgroundColor` in tauri.conf.json (deeper launch-flash fix than the inline CSS) — left
  out because its schema/format couldn't be verified without an iOS build.

---

## App Store privacy questionnaire (separate thread, for reference)
Earlier this session the user filled out Apple's App Privacy questionnaire. Final answers: **8 data types**
collected (Email, User ID, Purchase History, Product Interaction = linked to identity; Crash, Performance,
Other Diagnostic, Advertising Data = not linked); **Device ID and Coarse Location are NOT collected →
deselected**; **Tracking = No for everything** (non-personalized ads, no ATT/IDFA). Age rating **13+**.
Privacy policy URL: **playelector.com/privacy** (now names Supabase, PostHog, AdMob, Sentry).
