# Elector Update Log

## Version 1.2.0 — Mobile, Ads & Performance

Date: 2026-07-17

### Player-facing changes

- Improved phone and tablet support across compact, wide, and landscape layouts.
- Reduced startup download size by loading major game screens only when needed.
- Improved Shop feedback while rewarded-ad credit is being verified.
- Preserved the full solo-game smoke path and existing progression features.

### Monetization and privacy

- Added server-side verification for rewarded ads with single-use claim tokens and idempotent transaction handling.
- Added Google UMP consent refresh and required-message presentation on iOS and Android before requesting ads.
- Kept rewarded ads opt-in and non-personalized by default.
- Added an authenticated client polling flow so rewards are only displayed after server credit.

### Verification

- Unit tests, lint, TypeScript and Vite production build.
- Eight-device mobile viewport matrix from compact landscape phones through tablets.
- Solo bot browser smoke test.
- Rust host check and Android native rewarded-ad assembly.

### Deployment notes

- Apply `supabase/ads.sql` and deploy `supabase/functions/admob-ssv` before releasing.
- Configure the AdMob SSV callback and Privacy & messaging forms for both apps.
- Replace the Android Google test app/ad-unit IDs with the production IDs before building.
- Release to 100% only after the production rewarded-ad test credits exactly once on both platforms.

## iOS Build 58 — Retention & Mastery Pass

Date: 2026-07-02

### Player-facing changes

- Added the Opening Campaign for first-time players: a guided Tooley vs Trump solo match with live objectives.
- Added five candidate mastery levels.
- Candidate starting levels now follow unlock tier:
  - Free and 1,500 Funds candidates start at Level 1.
  - 4,500 Funds candidates start at Level 2.
  - 10,000 Funds candidates start at Level 3.
- Candidate mastery now improves gameplay stats by level: stronger positive modifiers, softened penalties, slightly better starting cash, and slightly better War Chest income.
- Candidate cards and stat modals now show the candidate’s current level and leveled stats.
- Victory rewards now show candidate mastery XP and level-ups.
- Progress panels now surface the nearest candidate mastery target.
- Daily Race now has a lightweight “Today” ranking with score previews and leaderboard support.

### Systems and analytics

- Added account-backed `candidate_mastery` progression.
- Added `daily_scores`, `record_daily_score`, and `get_daily_leaderboard` for Daily Race rankings.
- Added analytics events for Opening Campaign, mastery XP/level-ups, and Daily Race rankings.
- Added unit coverage for candidate mastery and daily score ordering/parsing.

### Verification

- `npm run test`
- `npm run lint`
- `npm run build`

### Deployment notes

- Apply `supabase/rewards.sql` and `supabase/daily.sql` before expecting account-backed mastery and Daily Race rankings to work in production.
