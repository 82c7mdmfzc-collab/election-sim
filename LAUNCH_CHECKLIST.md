# Elector — Launch Checklist (PlayElector.com)

Handoff reference for the Web + iOS + Android launch. Check items off as you go.
Last updated by the launch-prep work session.

## Key facts / IDs
- **Domain:** PlayElector.com (Namecheap)
- **Bundle ID / app name:** `com.playelector.app` / "Elector"
- **Supabase project ref:** `rwavsfyjjqfwefabcfvv` (org `rypixathprcujzuwpbkf`)
- **Supabase URL:** https://rwavsfyjjqfwefabcfvv.supabase.co
- **Vercel project:** `election-sim` (org `sitterworldcup`) → alias https://election-sim-ten.vercel.app
- **GitHub repo:** 82c7mdmfzc-collab/election-sim — PR #1 (`launch-prep` → `main`)

---

## ✅ DONE (this session)
- [x] Security: server-side reward calc + dedup (`claim_game_reward`, `game_rewards`), all MP phase
      transitions moved into the `resolve-turn` Edge Function, `push_game_state` disabled+revoked,
      server-owned deadlines, guest stale-state rejection, Edge CORS allowlist, sanitizer hardening,
      room-code validation, GRANTs.
- [x] Bugs: ErrorBoundary, global toast + retry on network failures, session-restore retry/catch.
- [x] Mobile/QoL: `100dvh` Safari overflow fix, `viewport-fit=cover` + safe-area insets,
      phone-portrait bottom-sheet state card, ≥44px tap targets, focus-visible, lazy images.
- [x] Rebrand: `com.playelector.app` + "Elector", OG/Twitter tags, web manifest.
- [x] 3 SQL files applied to production (`profiles.sql`, `lobbies.sql`, `rewards.sql`).
- [x] Edge Function `resolve-turn` deployed to production.
- [x] New client deployed to Vercel production (env vars confirmed set).
- [x] Code committed to `launch-prep`, PR #1 opened.

---

## 1. Immediate verification (do first)
- [ ] Open https://election-sim-ten.vercel.app on desktop — plays, no console CSP errors.
- [ ] Open it on your **phone** — confirm the screen no longer overscrolls (the Safari fix).
- [ ] **2-device online multiplayer test** (critical — the phase-authority refactor is unit-tested
      but not yet exercised against a real lobby): host on one device, join on another, play a full
      game through an **election → game-over**. Confirm turns advance, no stalls, winner is correct.
- [ ] Confirm Campaign Funds update after a game and that replaying the same finished game does NOT
      grant funds twice (reward dedup).
- [ ] Merge PR #1 into `main` so the repo's default branch matches production (housekeeping; Vercel
      is already serving the built artifact).

## 2. Rotate the two leaked credentials (security)
Both were pasted/visible in the assistant chat and should be considered compromised:
- [ ] **Supabase secret key** (`sb_secret_…`): Supabase → Project Settings → API Keys → roll the
      secret key. Update it anywhere it's stored server-side (Edge Function secrets / server env).
      It must NEVER be in client code or a `VITE_`-prefixed var.
- [ ] **GitHub token** (`ghp_…`) embedded in the git remote URL: GitHub → Settings → Developer
      settings → Personal access tokens → regenerate. Then update the remote:
      `git remote set-url origin https://<NEW_TOKEN>@github.com/82c7mdmfzc-collab/election-sim.git`

## 3. Supabase auth configuration (before public launch)
Accounts are **required for online play** and the economy is account-only. Dashboard → Authentication:
- [ ] **Anonymous = OFF** (no guest economy; durable accounts fix the online submit/identity drift).
- [ ] **Google** provider ON (OAuth client id/secret).
- [ ] **Apple** provider ON (Service ID, Team ID, Key ID, private key).
- [ ] **Email** ON; set sender/branding. Set **OTP Length = 8** and **OTP Expiry = 900s** (15 min),
      and add `{{ .Token }}` to the Magic Link email template so the 8-digit code shows (keep the link too).
- [ ] **URL Configuration:** Site URL = `https://playelector.com`. Add Redirect URLs:
      `https://playelector.com`, `https://www.playelector.com`, the Vercel preview domain,
      `http://localhost:5174`, and the mobile deep link `com.playelector.app://auth-callback`.
- [ ] **Rate Limits / Attestation:** enable rate limiting + CAPTCHA (hCaptcha/Turnstile) on
      sign-ups to stop account farming.

## 4. Namecheap — domain
- [x] Finish purchasing **PlayElector.com** (paid 2026-06-15). Verify free **Domain Privacy
      (WhoisGuard)** is toggled ON in Namecheap → Domain List → Manage.
- [ ] Point DNS at Vercel (either set Vercel's nameservers, or add the A record `@ → 76.76.21.21`
      and CNAME `www → cname.vercel-dns.com` that Vercel shows you).
- [ ] Create **support@playelector.com** (email forwarding to your inbox is fine) — a support email
      is required by both app stores.

## 5. Vercel — domain + required pages
- [ ] Vercel → project → Settings → **Domains**: add `playelector.com` and `www.playelector.com`;
      follow DNS prompts; choose primary redirect (www→apex or apex→www). SSL is automatic.
- [x] Add reachable **/privacy** and **/support** pages on the domain (store review requires both).
      Built `public/privacy.html` + `public/support.html` (CSP-safe, inline styles) and added
      `/privacy` + `/support` rewrites to `vercel.json`. Live once the next deploy ships.
- [ ] Re-confirm `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set for Production (they are).
- [x] Create an **og-image.png** (1200×630) at `public/assets/brand/og-image.png` (referenced by the
      OG tags) and a real app logo at `public/assets/brand/elector_logo.png`. Both generated on-brand
      via `scripts/gen-brand-assets.py` (orange wordmark, accent "o", "Race to 270" OG card).

## 6. App icons (one master → all sizes)
- [ ] Make a 1024×1024 PNG master icon (no transparency for iOS).
- [ ] Run `npx tauri icon path/to/icon.png` — populates `src-tauri/icons/` + the iOS/Android asset
      catalogs. Add Android adaptive-icon foreground/background and an iOS/Android splash.
- [x] Regenerate PWA PNG icons (192/512 + maskable-512, 180 apple-touch) and add them to
      `public/manifest.webmanifest`; added `apple-touch-icon` link to `index.html`. `favicon.svg`
      left as-is (still on-brand). A 1024 master icon (`public/assets/brand/icon-1024.png`, opaque,
      iOS-safe) is ready for the `tauri icon` step below.

## 7. Apple — App Store (no account yet)
- [ ] Enroll in **Apple Developer Program** ($99/yr) at developer.apple.com (individual enrollment is
      fastest; allow 24–48h).
- [ ] Install latest **Xcode** + Command Line Tools.
- [ ] `npm run tauri:ios:init` (generates `src-tauri/gen/apple`).
- [ ] In Xcode: Bundle Identifier = `com.playelector.app`, Display Name = "Elector"; under
      Signing & Capabilities select your Team (let Xcode manage signing); set deployment target,
      orientations, icons/splash.
- [ ] In **App Store Connect**: create app record; fill App Privacy (you collect account data via
      Supabase — declare it), age rating, category (Games/Strategy), description, keywords,
      support URL (`https://playelector.com/support`), privacy URL (`https://playelector.com/privacy`),
      screenshots (6.7" + 5.5" iPhone + iPad — capture from the simulator).
- [ ] `npm run tauri:ios:build` → upload via Xcode Organizer/Transporter → **TestFlight** first.
- [ ] Submit for App Review (note for reviewers: vs-bot and pass-and-play need no login; online
      play and the shop require a free account — Apple/Google/email sign-in is provided).

## 8. Google — Play Store (no account yet)
- [ ] Create **Google Play Console** account ($25 one-time); identity verification can take 1–2 days.
- [ ] Install **Android Studio** + SDK + NDK + JDK; set `ANDROID_HOME`.
- [ ] `npm run tauri:android:init` (generates `src-tauri/gen/android`).
- [ ] Set `applicationId` = `com.playelector.app` and app label "Elector"; add adaptive icons + splash.
- [ ] Create an **upload keystore** (`keytool -genkey …`); store it safely (losing it blocks future
      updates); enroll in **Play App Signing**.
- [ ] `npm run tauri:android:build` → signed **.aab**.
- [ ] Play Console: complete Data Safety form, content rating, target audience, privacy policy URL,
      store listing (title, descriptions, screenshots, 1024×500 feature graphic, 512×512 icon).
- [ ] Upload `.aab` to **Internal testing** first; note: new personal accounts may require a 14-day
      closed test (~12 testers) before Production — plan that lead time.

## 9. Deep links / magic-link return
- [ ] Register URL scheme `com.playelector.app://` (or a universal/app link on playelector.com) in the
      Tauri iOS/Android configs, and confirm it's in the Supabase redirect allowlist (step 3).

## 10. Final pre-launch verification
- [ ] iOS: `npm run tauri:ios:dev` on simulator + a real device — icons/splash/name = "Elector",
      safe-area correct on a notched device, online MP works vs the web client, magic-link returns.
- [ ] Android: `npm run tauri:android:dev` on emulator + a real device — same checks.
- [ ] Replay the old exploits and confirm they now fail: double reward claim (rejected), forced
      early resolve before server deadline (rejected), any raw `push_game_state` call (errors).
- [ ] Ship a TestFlight + Play Internal build; have 2–3 people complete a full game on each.

---

## Deferred (non-blocking, post-launch)
- WebP image conversion (needs `cwebp`; `loading="lazy"` already added).
- Bundle code-splitting (client JS is ~747 KB / 224 KB gzip, dominated by `us-atlas` map data).
- Pre-existing lint error at `src/components/MultiplayerMenu.tsx:325` (`react-hooks/set-state-in-effect`,
  exists on `main`; build doesn't run lint).
- Turn-1 deadline is still host-set (turns 2+ are server-owned) — minor residual.

## Handy commands
- Redeploy Edge Function: `npm run build:edge && supabase functions deploy resolve-turn --project-ref rwavsfyjjqfwefabcfvv`
- Redeploy web: `vercel --prod` (already logged in as `82c7mdmfzc-collab`)
- Tests / typecheck / build: `npm run test` · `npx tsc -b` · `npm run build`
