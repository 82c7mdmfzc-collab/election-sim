# App Store submission pack — Elector (v1.0)

Copy-paste into App Store Connect. Char limits noted.

## Identity
- **App name** (30): `Elector`
- **Subtitle** (30): `Race to 270`
- **Bundle ID**: `com.playelector.app`
- **Primary category**: Games → **Strategy**  ·  **Secondary**: Games → Board
- **Age rating**: **12+** (infrequent/mild mature/suggestive themes — political satire). No gambling, no violence.
- **Price**: Free (with In-App Purchases)

## URLs
- **Support URL**: `https://playelector.com`
- **Marketing URL**: `https://playelector.com`
- **Privacy Policy URL**: `https://playelector.com/privacy`

## Promotional text (170)
`Campaign across all 50 states, build coalitions, and outspend your rivals in the strategy game of winning the US Electoral College. Solo, pass-and-play, or online.`

## Keywords (100, comma-separated, no spaces)
`election,electoral,president,strategy,politics,270,campaign,board game,turn based,USA,vote,coalition`

## Description (≤4000)
```
Win the White House the hard way — 270 electoral votes at a time.

Elector is a turn-based strategy game about winning the US Electoral College.
Spend your campaign budget to climb influence ladders in the states and across
national coalitions, lock down the map, and race your rivals to 270.

• SOLO vs BOTS — three difficulty levels, no account needed.
• PASS-AND-PLAY — hot-seat with friends on one device.
• ONLINE — real-time matches against other players.
• A ROSTER OF CANDIDATES — each with their own strengths across coalitions.
• EARN & UNLOCK — win games to earn Campaign Funds and unlock new candidates.

Deep but quick to learn: every turn is a fresh budgeting puzzle of where to
push, where to defend, and which coalitions pay off.

Elector is a satirical game and is not affiliated with, authorized, or endorsed
by any person, party, or government depicted; all names and likenesses are used
for parody and commentary.
```

## What's New (v1.0)
`First release. Solo vs bots, pass-and-play, and online matches. Race to 270!`

## App Review notes (paste verbatim — pre-empts the likely rejections)
```
• NO LOGIN REQUIRED TO EVALUATE: Solo (vs bots) and pass-and-play are fully
  playable from launch without an account. You do not need to sign in to review
  the core game.
• Accounts (optional) use a passwordless EMAIL CODE: enter an email, we send an
  8-digit code, you type it in. Use any inbox you control. Accounts are only
  needed for online play and to sync unlocks.
• IN-APP PURCHASES (native StoreKit): The Shop offers optional consumable
  "Campaign Funds" bundles (funds_600, funds_1500, funds_4000, funds_9000, funds_20000, funds_45000) via
  Apple StoreKit. Purchases are OPTIONAL — Campaign Funds are also earned by
  playing — and there is NO external or web purchase link inside the iOS app.
  Funds unlock additional candidates and cosmetic items. There is no subscription
  and no real-money gambling.
• OPTIONAL REWARDED ADS: The Shop includes an opt-in rewarded ad button. Ads are
  never shown automatically; completing one grants a small random amount of
  Campaign Funds, capped server-side.
• PARODY/SATIRE: Names and likenesses of public figures are used for satire,
  parody, and political commentary. The app is not affiliated with or endorsed
  by anyone depicted; an in-app disclaimer states this.
• The game is landscape-orientation.
```

## Privacy ("App Privacy" questionnaire)
Data collected:
- **Identifiers / Usage Data** → product analytics (PostHog), **not** linked for tracking across other apps. Purpose: Analytics, App Functionality.
- **Identifiers / Usage Data** → optional rewarded advertising (Google AdMob). Purpose: Third-Party Advertising, Analytics, App Functionality.
- **Contact Info (email)** + **User Content (username, game stats)** → account (Supabase). Purpose: App Functionality. Linked to the user's account.
- **Purchases (Purchase History)** → in-app purchase records (Supabase `purchases` ledger keyed to the StoreKit transaction id). Purpose: App Functionality. Linked to the user's account.
- If personalized ads/IDFA are enabled, include the ATT prompt and `NSUserTrackingUsageDescription`.
- Account deletion is available in-app (Your Account → Delete account) and satisfies 5.1.1(v).

## Assets you still need to produce
- **Screenshots** (landscape): 6.7" iPhone set required; capture menu, the board mid-game, a coalition/shop screen, the VS matchup, a victory screen. (Take from `tauri:ios:dev` on a simulator.)
- **App icon**: 1024×1024 from `public/assets/brand/icon-1024.png` (Xcode/Tauri generates the rest).
