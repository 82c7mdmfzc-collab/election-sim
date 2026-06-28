# Monetization, Virality & Growth Runbook

Current as of 2026-06-28.

## Monetization Posture

Elector v1 is a fair soft launch:

- Campaign Funds are earnable through play.
- Paid candidates are earnable sidegrades, not direct cash purchases.
- Cosmetics are the preferred repeat-spend sink.
- IAP is native iOS only for v1.
- There is no web Stripe rail.
- Rewarded ads are opt-in only and never automatic.

## Campaign Funds Sources

- Game completion rewards: server-calculated by `complete_game_result`, capped at 60 before daily diminishing returns.
- Daily finish streak: 10–100 Funds per UTC day, once per day.
- Achievement claims: 10–100 Funds each.
- Rewarded ads: 20–60 Funds, max 5 claims per rolling 12 hours.
- Referrals: 500 Funds to both accounts when the invited player finishes their first game.
- Native iOS IAP: six consumable funds packs.

## Campaign Funds Sinks

- Premium candidates:
  - Ronald Reagan: 4,500
  - George Washington: 4,500
  - Keir Starmer: 4,500
  - John F. Kennedy: 4,500
  - Nigel Farage: 10,000
- Result card frames:
  - Patriot: 3,000
  - Gold Standard: 3,000
- Victory messages:
  - Landslide: 3,000
  - Humbled: 3,000
  - Fired Up: 3,000

Free candidates are Bobby Tooley, Donald Trump, Kamala Harris, Abraham Lincoln, and Joe Biden.

## Database

The production deploy workflow applies these SQL files in dependency order:

```text
profiles -> lobbies -> rewards -> cosmetics -> iap -> ads -> daily -> referrals -> moderation -> notifications
```

Manual fallback:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/profiles.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/lobbies.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/rewards.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/cosmetics.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/iap.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/ads.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/daily.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/referrals.sql
```

## Native IAP

Client catalog lives in `src/utils/iap.ts`; server grants live in `supabase/iap.sql`; Edge verification lives in `supabase/functions/fulfill-purchase/index.ts`.

| SKU | Funds | USD fallback | GBP fallback |
| --- | ---: | ---: | ---: |
| `funds_600` | 600 | $0.99 | £0.99 |
| `funds_1500` | 1,500 | $2.99 | £1.99 |
| `funds_4000` | 4,000 | $4.99 | £3.99 |
| `funds_9000` | 9,000 | $8.99 | £7.99 |
| `funds_20000` | 20,000 | $14.99 | £14.99 |
| `funds_45000` | 45,000 | $19.99 | £19.99 |

iOS is implemented with StoreKit via `@choochmeque/tauri-plugin-iap-api`. Android verification is intentionally deferred.

Required Supabase secrets for iOS crediting:

```bash
supabase secrets set APPLE_ISSUER_ID=...
supabase secrets set APPLE_KEY_ID=...
supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
```

Deploy:

```bash
supabase functions deploy fulfill-purchase --project-ref rwavsfyjjqfwefabcfvv
```

Test: purchase in TestFlight/sandbox, confirm balance updates, reinstall/sign in, confirm balance persists, then replay the same transaction and confirm no double-credit.

## Rewarded Ads

- SQL: `supabase/ads.sql`
- Client: `src/utils/rewardedAds.ts`, `src/components/Shop.tsx`
- iOS app id: `ca-app-pub-5364561069734393~8538342864`
- iOS rewarded ad unit: `ca-app-pub-5364561069734393/7845987969`
- `app-ads.txt`: `google.com, pub-5364561069734393, DIRECT, f08c47fec0942fa0`

Production UI is hidden unless a native bridge is available or `VITE_ENABLE_INLINE_REWARDED_ADS=true` is intentionally set.

Test: sign in → Shop → Watch ad → provider completion → balance increases by 20–60 Funds → repeat 5 times → 6th attempt is blocked until the oldest claim is 12 hours old.

## Referrals

- SQL: `supabase/referrals.sql`
- Client capture: `?ref=CODE` in `useProfile.init`
- Reward: 500 Funds each after the invited account finishes its first game.
- One payout per invited account ever.
- Self-referral and reused-code abuse should be rejected server-side.

## July Washington Grant

`claim_free_character('washington')` is server-validated and available in July UTC. Washington otherwise costs 4,500 Funds and remains a net-neutral sidegrade.

## Compliance Notes

- Do not add external payment links to the iOS app.
- Do not tie referrals or rewards to App Store reviews.
- If personalized ads/IDFA are enabled later, update App Store privacy answers and add ATT messaging.
