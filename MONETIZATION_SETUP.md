# Monetization, Virality & Growth — Setup Runbook

Covers the monetization and growth systems: real-money **IAP**, **rewarded ads**,
the **share-card**, **referrals**, and the **July Washington grant**. Code is in the repo; the steps below
are the manual deploy/config that must happen for them to work in production.

> Deploy order matters: **apply SQL first → deploy Edge Functions → configure
> store/Stripe secrets → deploy web/native builds.** Clients must never call a
> function/RPC that isn't live yet. (CI auto-apply of SQL is still blocked by the
> workflow-scope PAT, so apply SQL by hand in the Supabase SQL editor.)

## 1. Database (Supabase SQL editor, in order)

1. `supabase/profiles.sql` — adds `'washington'` to the `unlock_character` catalog and
   the **July-2026 free grant** in `handle_new_user()` (window `2026-07-01`..`2026-08-01` UTC).
2. `supabase/rewards.sql` — unchanged, but referrals depend on its `game_rewards` ledger.
3. `supabase/referrals.sql` — referral codes, `set_referrer`, and the `game_rewards`
   AFTER-INSERT trigger that pays both parties on the invitee's first finished game.
4. `supabase/iap.sql` — `purchases` ledger + `fulfill_purchase` (service-role only).
5. `supabase/ads.sql` — rewarded-ad ledger, `get_ad_reward_status`, and
   `claim_ad_reward` (server-random 20-60 Funds, max 5 claims per 12 hours).

All are idempotent and safe to re-run.

## 2. Edge Functions

```
supabase functions deploy stripe-checkout
supabase functions deploy stripe-webhook --no-verify-jwt   # Stripe has no Supabase JWT
supabase functions deploy fulfill-purchase
```

## 3. Web IAP (Stripe) — launch rail

- Secrets: `supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_...`
  (use **test** keys first).
- Stripe Dashboard → Developers → Webhooks → add endpoint = the `stripe-webhook` URL,
  event **`checkout.session.completed`**. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
- USD prices live in `stripe-checkout/index.ts` (`WEB_PRICE_CENTS`); the **funds/characters
  granted** live server-side in `iap.sql` (`fulfill_purchase`). Keep SKUs in sync across:
  `src/utils/iap.ts` (FUNDS_BUNDLES) ↔ `stripe-checkout` ↔ `iap.sql`.
- **Test:** Shop → Buy Funds → Stripe test card `4242 4242 4242 4242` → return to app →
  funds appear (webhook credited). Replay the webhook in Stripe → **no double-grant**.

## 4. Native IAP (iOS / Android) — REMAINING HANDS-ON WORK

The server endpoint (`fulfill-purchase`) and client routing (`src/utils/iap.ts`) are done
and **fail closed**. The native app also hides paid Campaign Funds bundles unless a reviewed
StoreKit / Play Billing bridge injects `window.__ELECTOR_IAP__`; Stripe Checkout remains web-only.
Until verification is configured, native purchases cannot credit funds. To finish each native rail:

1. **Tauri IAP plugin (Rust).** Implement (or adopt) a plugin that runs StoreKit 2 (iOS)
   and Play Billing (Android) purchases and **injects `window.__ELECTOR_IAP__`** with:
   ```ts
   interface NativeIap { purchase(sku: string): Promise<{ transactionId: string; receipt: string }>; }
   ```
   `receipt` = the signed StoreKit JWS (iOS) or the Play `purchaseToken` (Android).
2. **Server verification** (`supabase/functions/fulfill-purchase/index.ts`,
   `verifyApple` / `verifyGoogle` — currently throw `VerificationUnavailable`):
   - iOS secrets: `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` → App Store Server API.
   - Android secrets: `GOOGLE_SERVICE_ACCOUNT_JSON`, `ANDROID_PACKAGE_NAME` → Play Developer API.
3. **Store consoles:** create the consumable products (`funds_small/medium/large`) in App
   Store Connect and Play Console with matching product ids.
4. **Test:** Apple **sandbox** account / Play **license tester** → buy in TestFlight /
   internal testing → funds credited → reinstall + sign in → balance persists
   (consumables are account-bound via the server ledger, not StoreKit "restore").

## 5. Rewarded ads

- The database side is `supabase/ads.sql`. The client calls `claim_ad_reward` only
  after an ad completes; the server owns the random payout and the rolling quota.
- Current launch target is iOS only. Android AdMob app/ad-unit setup is intentionally
  deferred until the Android build is ready.
- AdMob iOS:
  - Publisher ID: `pub-5364561069734393`
  - App ID: `ca-app-pub-5364561069734393~8538342864`
  - Rewarded ad unit: `ca-app-pub-5364561069734393/7845987969`
  - app-ads.txt: `google.com, pub-5364561069734393, DIRECT, f08c47fec0942fa0`
- Production UI is hidden unless a real rewarded-ad bridge is present or
  `VITE_ENABLE_INLINE_REWARDED_ADS=true` is set. Keep the inline fallback off in
  production unless you intentionally want a first-party sponsored break with no ad-network revenue.
- Inject this bridge before the shop renders:
  ```ts
  window.__ELECTOR_ADS__ = {
    async showRewardedAd({ placement }) {
      // Call AdMob / Unity Ads / your provider here.
      // Resolve only after the provider confirms the rewarded ad completed.
      return { completed: true, provider: 'admob', adUnit: 'ca-app-pub-...' };
    },
  };
  ```
- **Test:** sign in → Shop → Watch ad → provider completion → balance increases by
  20-60 Funds → repeat 5 times → 6th attempt is blocked until the oldest claim is
  12 hours old. Confirm a second device sees the same server quota after opening Shop.
- **Compliance:** if third-party ads are enabled, update App Store Connect / Play
  Data Safety / privacy policy and remove any "no third-party advertising" claims.
  If the provider tracks across apps, ATT or the platform equivalent may be required.

## 6. Referrals

- No secrets. After `referrals.sql` is applied, the client auto-captures `?ref=CODE` on
  load (`useProfile.init`) and calls `set_referrer` after sign-in. Invite UI is in the Shop.
- Reward = **500 Funds each**, paid when the **invitee finishes their first game** (trigger).
  One payout per invited account ever (unique `referral_rewards.referred_user_id`).
- **Test:** A invites B via the link → B signs up (no reward) → B finishes one game → both
  +500 → B's 2nd game pays nothing → self-referral / reused code rejected.
- **Compliance:** never tie the reward to a store review (Apple 3.1.1 / Google).

## 7. July Washington grant

- After `profiles.sql` is applied, accounts created in the July-2026 window get `washington`
  free; everyone else can buy it for **1500 Funds** in the Shop. Stats are a **net-neutral
  sidegrade** (affinities/payoutModifiers sum to zero) — keep it that way if edited.
- Optional art: `public/assets/portraits/washington.png` + `tokens/washington_token.png`
  (initials fallback renders until then).
