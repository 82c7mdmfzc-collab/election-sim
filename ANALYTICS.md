# Elector Analytics

Elector uses PostHog for product analytics. Analytics is fail-closed: if `VITE_POSTHOG_KEY` is missing, no analytics client is initialized and every `track()` call is a no-op.

## Setup

Production env vars:

- `VITE_POSTHOG_KEY`
- `VITE_POSTHOG_HOST=https://eu.i.posthog.com`
- `VITE_APP_VERSION=1.0.0`

PostHog defaults in `src/utils/analytics.ts`:

- Manual events only.
- Autocapture off.
- Session recording off.
- Pageview/pageleave off.
- Memory-only persistence.
- Person profiles only after account identification.

Do not send email, username, room code, lobby id, invite link, referral code, raw URL, raw error text, or detailed board click streams.

## Super Properties

Every event includes:

- `platform`: `web`, `ios`, `android`, `tauri_desktop`, or `unknown`
- `app_version`
- `is_account`
- `native_runtime`
- `environment`
- `route_surface`

## Event Taxonomy

Onboarding:

- `app_opened`
- `first_mission_started`
- `first_mission_objective_completed`
- `first_mission_completed`
- `tutorial_started`
- `tutorial_completed`
- `tutorial_skipped`
- `coach_dismissed`

Game loop:

- `game_started`
- `game_finished`
- `game_abandoned`

Account:

- `account_prompt_opened`
- `auth_started`
- `auth_completed`
- `auth_failed`

Economy and store:

- `shop_opened`
- `checkout_started`
- `checkout_result`
- `item_unlocked`
- `funds_earned`
- `achievement_claimed`
- `candidate_mastery_xp_awarded`
- `candidate_mastery_level_up`

Daily:

- `daily_challenge_opened`
- `daily_challenge_started`
- `daily_challenge_completed`
- `daily_challenge_won`
- `daily_score_submitted`
- `daily_rank_viewed`

Cosmetics:

- `cosmetic_shop_opened`
- `cosmetic_previewed`
- `cosmetic_unlocked`

Rewarded ads:

- `rewarded_ad_started`
- `rewarded_ad_claimed`
- `rewarded_ad_limited`
- `rewarded_ad_cancelled`
- `rewarded_ad_claim_failed`

Sharing:

- `share_started`
- `share_completed`
- `share_failed`
- `result_shared`

Multiplayer:

- `lobby_created`
- `lobby_joined`
- `online_match_failed`

Reliability:

- `runtime_error`

## Launch Dashboards

Activation:

- Funnel: `app_opened` → `game_started` → `game_finished`
- Breakdown: `platform`, `game_mode`, `is_account`

Onboarding:

- Funnel: `tutorial_started` → `tutorial_completed` → `game_started`
- Watch `tutorial_skipped` by `step_index`.

Retention:

- D1, D7, D30 retention on `game_started`.
- Break down by `game_mode`, `platform`, first `candidate_id`, and launch cohort.

Economy:

- `funds_earned` by `source`
- `achievement_claimed` by `achievement_tree`
- `item_unlocked` by `item_type`
- `cosmetic_unlocked` by `category`

Store:

- Funnel: `shop_opened` → `checkout_started` → `checkout_result`
- Filter `checkout_result.status = completed` for conversion.
- Watch failed `reason_category` by platform.

Ads:

- `rewarded_ad_started` → `rewarded_ad_claimed`
- Watch `rewarded_ad_limited` by platform and account cohort.

Sharing:

- Funnel: `game_finished` → `share_started` / `result_shared`
- Break down by method and share type.

Multiplayer:

- Counts for `lobby_created`, `lobby_joined`, `online_match_failed`
- Break down failures by `reason`.

## Five Numbers

1. D7 retention on `game_started`
2. Activation: `app_opened` → `game_finished`
3. Guest-to-account: `account_prompt_opened` → `auth_completed`
4. Store conversion: `shop_opened` → completed `checkout_result`
5. Share rate: `game_finished` → `result_shared`
