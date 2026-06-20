# Elector Analytics

Elector uses PostHog for free product analytics. Analytics is fail-closed: if
`VITE_POSTHOG_KEY` is missing, no analytics client is initialized and every
`track()` call is a no-op.

## Setup

1. Create a PostHog project in EU cloud.
2. Add these production env vars:
   - `VITE_POSTHOG_KEY`
   - `VITE_POSTHOG_HOST=https://eu.i.posthog.com`
   - `VITE_APP_VERSION=1.0.0`
3. Open the app and confirm `app_opened` appears in PostHog Live Events.

## Privacy Defaults

- Manual events only.
- Autocapture is off.
- Session replay is off.
- Pageview and pageleave capture are off.
- Persistence is memory-only.
- Person profiles are created only after account identification.
- Do not send email, username, room code, lobby ID, invite link, referral code,
  raw URL, raw error text, or detailed board click streams.

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

- `app_opened`: `entry_surface`, `has_saved_session`
- `tutorial_started`: `source`, `step_count`
- `tutorial_completed`: `source`, `step_count`
- `tutorial_skipped`: `source`, `step_index`, `step_count`
- `coach_dismissed`: `turn_number`, `coach_title`

Core loop:

- `game_started`: `game_id`, `game_mode`, `candidate_id`, `opponent_count`,
  `player_count`, `bot_count`, `difficulty`, `turn_timer_seconds`
- `game_finished`: `game_id`, `game_mode`, `result`, `candidate_id`,
  `final_ev_self`, `final_ev_winner`, `duration_seconds`, `turn_number`,
  `secured_states`, `state_groups_dominated`, `national_groups_led`,
  `national_groups_earning`, `bot_difficulty`, `opponent_count`
- `game_abandoned`: `game_id`, `game_mode`, `phase`, `turn_number`,
  `duration_seconds`, `reason`

Account:

- `account_prompt_opened`: `trigger`
- `auth_started`: `method`, `mode`
- `auth_completed`: `method`, `mode`
- `auth_failed`: `method`, `mode`, `reason_category`

Economy and shop:

- `shop_opened`: `source`, `platform`, `native_billing_available`
- `checkout_started`: `product_id`, `product_type`, `value_usd`, `platform`
- `checkout_result`: `product_id`, `product_type`, `status`,
  `reason_category`, `value_usd`, `platform`
- `item_unlocked`: `item_id`, `item_type`, `price_funds`
- `funds_earned`: `amount`, `source`, `claimed`, `game_mode`
- `achievement_claimed`: `achievement_id`, `achievement_tree`, `reward_amount`

Sharing:

- `share_started`: `surface`, `share_type`, `method`, `result`
- `share_completed`: `surface`, `share_type`, `method`, `result`
- `share_failed`: `surface`, `share_type`, `method`, `reason_category`

Multiplayer health:

- `lobby_created`: `visibility`, `player_count`, `candidate_id`
- `lobby_joined`: `visibility`, `candidate_id`, `occupied_seats`,
  `player_count`
- `online_match_failed`: `reason`, `visibility`

Reliability:

- `runtime_error`: `surface`, `reason_category`, `has_component_stack`

## Launch Dashboards

Activation:

- Funnel: `app_opened` -> `game_started` -> `game_finished`
- Breakdown: `platform`, `game_mode`, `source`

Onboarding:

- Funnel: `tutorial_started` -> `tutorial_completed` -> `game_started`
- Watch `tutorial_skipped` by `step_index`.

Retention:

- D1, D7, D30 retention on `game_started`, not `app_opened`.
- Break down by `game_mode`, `is_account`, first `candidate_id`, and launch
  cohort.

Economy:

- `funds_earned` by `source`
- `achievement_claimed` by `achievement_tree`
- `item_unlocked` by `item_type`

Shop:

- Funnel: `shop_opened` -> `checkout_started` -> `checkout_result`
- Filter `checkout_result.status = completed` for conversion.
- Watch failed `reason_category` by platform.

Sharing:

- Funnel: `game_finished` -> `share_started` -> `share_completed`
- Break down by `method` to verify native iOS share support.

Multiplayer:

- Counts for `lobby_created`, `lobby_joined`, `online_match_failed`
- Break down failures by `reason`.

## Five Numbers

1. D7 retention on `game_started`
2. Activation: `app_opened` -> `game_finished`
3. Guest to account: `account_prompt_opened` -> `auth_completed`
4. Shop conversion: `shop_opened` -> completed `checkout_result`
5. Share rate: `game_finished` -> `share_completed`
