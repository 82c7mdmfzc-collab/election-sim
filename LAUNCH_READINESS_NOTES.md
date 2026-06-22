# Launch-Readiness + Retention Pass — Notes

Date: 2026-06-22 · Branch: `mobile-native-feel-and-notifications`

A high-leverage, **safe** pass: no engine rewrite, no online/server-authoritative changes, no DB
migrations, and nothing removed (modes, candidates, ads, IAP, referrals, achievements all intact).
New native-feel UI is additive and gated so the website and online play don't regress.

---

## What changed

### 1. App Store IAP metadata (correctness/compliance)
The build ships native StoreKit IAP, but the listing/reviewer docs still said "NO IN-APP PURCHASES."
Fixed so metadata matches reality:
- `APP_STORE_LISTING.md` — replaced the "no IAP" reviewer bullet with an accurate native-StoreKit
  description (consumable Campaign Funds bundles `funds_1500/4000/9000/20000`, optional, no external
  purchase links); added a **Purchases / Purchase History (linked)** row to App Privacy; price is now
  "Free (with In-App Purchases)".
- `IOS_RELEASE_GUIDE.md` — updated the gating note, the App Privacy line, the reviewer note, and the
  TestFlight checklist to reflect that StoreKit IAP is present (no Stripe/web purchase in the native app).

### 2. Onboarding (teach the core loop faster)
- **First-spend cue:** the existing `CampaignCoach` turn-1 message now explains the mechanic in plain
  language — "tap a state, then a rung; cost rises as you climb; reach the top alone to SECURE it."
- **Post-turn recap:** new pure helper `src/game/turnSummary.ts` (+ test) turns the authoritative
  `TurnReport` + dominance diff into plain-English lines (🔒 secured, 🏛 coalition gained, 📉 wallet
  evaporated, ⚠ clash — cash forfeited). Rendered at the top of `RoundResolution`. Personalizes the
  owner seat as "You" (solo/online); names everyone in multi-human hot-seat.

### 3. Daily Challenge v1 (retention hook)
- `src/game/dailyChallenge.ts` (+ test): deterministic, dependency-free. A UTC-date seed fixes the
  **opposition** (1–3 opponents, difficulty, turn timer, and the specific opponents); the player brings
  their **own** candidate. Opponents are seed-shuffled and exclude the player's pick (no seat-id collision).
- `src/components/DailyChallenge.tsx`: scenario preview (opponent portraits, difficulty, timer) + a
  candidate picker (reuses the BotSetup rail) + today's status/streak + Start.
- `store.ts`: `isDailyChallenge` flag + `startDailyChallenge()` (reuses `startGame`, so solo/online logic
  is untouched). `App.tsx`: a "Daily" home tile + route.
- Tracking/reward: completion + a consecutive-day streak are stored **device-locally** (`localPrefs`,
  guest-compatible). The Funds reward **rides the existing `complete_game_result` path** for signed-in
  players — **no new economy wiring, no migration.**

### 4. Cosmetics (repeat-spend hook, not pay-to-win)
- `src/game/cosmetics.ts`: a catalog modeled on `borders.ts`/`victoryMessages.ts`. **3 live share-card
  frames** (`midnight` free default — identical to the old card; `patriot`, `gold` at 600 Funds) plus
  typed `map_theme` / `profile_banner` placeholders flagged `comingSoon`.
- Shop gets a **Cosmetics** tab: free frames equip locally (persisted in `localPrefs.selectedShareFrame`);
  priced/placeholder cosmetics are honest teasers with a server-wiring `TODO`. Selected frame themes the
  share card. Purely visual — no gameplay effect.

### 5. Result sharing (more viral)
- `ShareCard.tsx`: added a **portrait 9:16 variant** (1080×1920, for TikTok/Reels/Stories) alongside the
  existing 1200×630 card, plus optional candidate subtitle, a dramatic-event highlight, and theme colors.
  Default landscape output is unchanged (existing test stays green).
- `shareImage.ts`: `dramaticEvent()` formatter (+ tests), `shareCardDims()`. `VictoryPodium` now offers
  **Share Story (9:16)** and **Share Card (16:9)**, applies the equipped frame, and shows the candidate +
  dramatic line.

### 6. Analytics (new events via existing `track()`)
Added: `daily_challenge_opened`, `daily_challenge_started`, `daily_challenge_completed`,
`daily_challenge_won`, `result_shared`, `cosmetic_shop_opened`, `cosmetic_previewed`.
Verified already present: `tutorial_started/completed/skipped`, `share_started/completed/failed`.
`cosmetic_unlocked` is reserved for when priced cosmetic purchasing lands (see TODO).

---

## What remains (scaffolded + TODO'd; out of scope for a safe pass)

- **Priced cosmetic purchasing** — only free frames equip today. A server `unlock_cosmetic` RPC mirroring
  `unlock_character` (granting a `cosmetic:<id>` token consumed by `isCosmeticAvailable`) is the next step;
  fire `cosmetic_unlocked` there. (TODO marked in `Shop.tsx`.)
- **Cross-device Daily Challenge tracking** — completion/streak is device-local. Optional: an RPC/column to
  persist it server-side and gate per-day rewards.
- **Full move-level daily determinism** — v1 fixes the scenario, not bot moves / election timing (would
  need a seeded RNG through the store + bot driver). Deferred intentionally.
- **Map themes & profile banners** — typed + placeholder UI only.
- **Internal docs still stale** (non-blocking, not reviewer-facing): `MONETIZATION_SETUP.md` and a line in
  `LAUNCH_CHECKLIST.md` still describe the removed Stripe rail and the old `window.__ELECTOR_IAP__` bridge.
  Update when convenient.

---

## Migrations / env vars / manual App Store actions

- **DB migrations:** none required for this pass.
- **Manual before iOS submit:**
  - Ensure the four consumable products (`funds_1500/4000/9000/20000`) exist in **App Store Connect** with
    matching IDs, and that the listing's IAP disclosure matches the updated `APP_STORE_LISTING.md`.
  - Set the Apple App Store Server API secrets in Supabase — `APPLE_ISSUER_ID`, `APPLE_KEY_ID`,
    `APPLE_PRIVATE_KEY` — **or purchases will not credit** (the `fulfill-purchase` verifier fails closed,
    returning 503; see `MONETIZATION_SETUP.md` / `APPLE_SETUP.md`).
- **No new env vars** introduced by this pass.

---

## App Store / monetization warnings

- **IAP is now disclosed** in metadata — keep it consistent in App Store Connect (don't re-introduce a
  "no IAP" claim).
- Premium **candidates carry asymmetric gameplay modifiers** and are buyable with Funds (which are also
  buyable with money). They remain fully **earnable for free**, and are asymmetric side-grades rather than
  strict upgrades — but this is a "pay-for-content-that-affects-play" model, not cosmetic-only. Cosmetics
  added here are deliberately **non-gameplay** to give a clean cosmetic spend lane.
- Satire/parody framing and the in-app disclaimer are unchanged; no party affiliation/endorsement claims.

---

## Recommended IAP / catalog restructure (proposal — not implemented)

The economy sink is shallow: 6 premium candidates at 1,500 Funds = 9,000 max, and the **$8.99 pack grants
exactly 9,000** (buys the whole roster), capping monetization. Suggestions, in priority order:

1. **Add a cosmetic spend lane (started here).** Ship priced share-frame unlocks, then map themes and
   profile banners — recurring, non-pay-to-win sinks that don't bloat the roster or unbalance play.
2. **Re-tier the IAP ladder** so the top pack has a purpose beyond the roster: e.g. a cheap **starter
   bundle** (one-time, ~$1.99 → Funds + a cosmetic) and a **higher-value top tier** ($19.99+) aimed at
   cosmetic collectors / supporters, rather than $14.99 = "more Funds than anything to spend on."
3. **Widen premium roster cadence** — periodic new candidates/seasonal characters keep the Funds sink
   alive for engaged players; keep every one earnable to stay fair.
4. **Keep candidates earnable** and resist raising their prices to "force" purchases — the generous earn
   rate is good for retention; deepen sinks instead of nerfing income.

---

# Follow-on pass — next-tasks completed + mobile polish (2026-06-22)

## What shipped (code + SQL; inert until the manual deploy steps below)

- **Server-validated cosmetic unlocks.** NEW `supabase/cosmetics.sql` `unlock_cosmetic(p_cosmetic)`
  (mirrors `unlock_character`; price catalog `patriot`/`gold` = 600; grants a `cosmetic:<id>` token in
  `unlocked_characters`). Client: `unlockCosmeticRemote` (profile.ts) + `unlockCosmetic` action
  (useProfile.ts) + a real "Unlock — 600 Funds" button in the Shop Cosmetics tab that equips on success
  and fires `cosmetic_unlocked`. Fail-soft: guests/offline get a clear inline message, no client grant.
- **Cross-device Daily Challenge sync.** NEW `supabase/daily.sql` (adds `profiles.daily_challenge` jsonb;
  `record_daily_result` with the same UTC consecutive-day logic as the login streak; `get_daily_status`).
  Client: `recordDailyResultRemote` (fire-and-forget at game end, signed-in only) + `getDailyStatusRemote`
  (read on the Daily screen). Device-local `localPrefs` streak remains the offline fallback.
- **Re-tiered IAP ladder.** Added `funds_600` ($0.99 "Starter") and `funds_45000` ($19.99 "Most Funds")
  across the three sync points: `src/utils/iap.ts` `FUNDS_BUNDLES`, `supabase/iap.sql` `fulfill_purchase`,
  and the edge `KNOWN_SKUS`. Existing four bundles untouched.
- **Mobile "more inviting / user-friendly" polish (all additive, native-contract-safe):**
  - Home: tap haptic/sound on menu buttons, a live Daily **streak/"New" badge**, a short-landscape
    2-column grid so 5 tiles never scroll, and 48px tap targets.
  - Landing: a rotating game-hook line (`RotatingTip`) + stat chips (50 states · N candidates · Race to 270).
  - Cosmetics/touch: grayscale "Coming soon" teasers, dim unaffordable prices, 56px card tap targets,
    sticky section headers in native panes.
  - Daily screen: cross-device status, a streak chip, and an empty-state hint to unlock more candidates.
- **Tests:** added `parseDailyStatus` + (prior) suites — full vitest run green; lint + build +
  `test:mobile-native` green.

## Manual steps required to make the server features live

1. **Apply SQL** (Supabase SQL editor, idempotent): `supabase/cosmetics.sql`, `supabase/daily.sql`, and
   re-apply `supabase/iap.sql` (new SKU grants).
2. **Deploy the edge function:** `supabase functions deploy fulfill-purchase` (new `KNOWN_SKUS`).
3. **App Store Connect:** create consumables `funds_600` and `funds_45000` (per-territory pricing). Until
   created they simply won't have a localized price / can't be bought; existing bundles are unaffected.
4. **Apple server-verification secrets** (old task 2 — still required for ANY IAP to credit):
   `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` in Supabase. Until set, `fulfill-purchase`
   fails closed (503) and no purchase credits.

## Still remaining

- Coin art for `funds_600` / `funds_45000` (`/assets/coins/*.png`); the Shop hides a missing image
  gracefully and still shows amount + price.
- `map_theme` / `profile_banner` cosmetics remain `comingSoon` (no render surface yet); extend the
  `cosmetics.sql` price catalog when they ship.
- Android Play Billing verification still stubbed.
- On-device verification of real purchases + multi-device daily streak (needs the manual steps above).
