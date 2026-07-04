# Elector Update Log

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
