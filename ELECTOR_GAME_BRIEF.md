# Elector — Complete Game & Business Brief

> A self-contained reference for an AI working in research mode. It is intended to support
> discussion of marketing, monetization, game balance, and dominant-strategy analysis.
> Every number here is pulled directly from the live game's source and server logic.
> Currency note: all in-game costs are in **$1k units** ("$250k income" is stored as `250`).
> Meta-currency ("Campaign Funds") is a separate soft currency and is always written as "Funds".

---

## 1. What Elector is

**Elector** is a turn-based strategy game about winning the **US Electoral College** — first to
**270 electoral votes (EV)** wins the presidency. It is a budgeting / area-control game dressed
as a political campaign: you spend a campaign budget to build Influence Levels across the 50 states + DC and across national
network tracks, call states permanently, and outmaneuver rivals to 270.

- **Genre / positioning:** Strategy → Board (turn-based). Marketed subtitle: *"Race to 270."*
- **Tone:** Political **satire/parody** using real (and historical) figures; an in-app disclaimer
  states it is unaffiliated/unendorsed. Age-rated 12+ (mild political/suggestive themes; no gambling, no violence).
- **Platforms:**
  - **Website** — playelector.com (the "secondary website" rail; full game runs in browser).
  - **iOS native app** — wrapped with **Tauri** (Rust + WebView), bundle `com.playelector.app`.
  - **Android** — fast-follow after web + iOS.
- **Modes:**
  - **Solo vs bots** — 1 human + **1–3 AI opponents**, three difficulty tiers; **no account required**.
  - **Pass-and-play** — hot-seat on one device.
  - **Online** — real-time matches against other players (Supabase-backed; account required).
- **Player count:** 2–4 seats in every mode.
- **Tech stack:** React 19 + TypeScript + Vite + Zustand front end; **Supabase** (Postgres + Auth +
  Edge Functions) for accounts, economy, and online play; **PostHog** analytics; **Google AdMob**
  for optional rewarded ads; **Apple StoreKit** (via a Tauri IAP plugin)
  for real-money purchases on iOS.

The game engine is a **pure, deterministic, server-authoritative** module (no randomness except an
injectable RNG for election timing). Online turns are resolved by an authoritative Supabase Edge
Function; solo/bot outcomes are reported by the client.

---

## 2. The board & objective

- **51 territories** = 50 states + DC, totaling exactly **538 EV** (real apportionment, 2020 census).
- **Win condition:** hold **≥ 270 EV** when an election fires.
- Each state awards **all** its EV to whoever holds the **most Influence Levels** there at election time
  (winner-take-all). Ties broken by **who reached that Influence Level count first** (a monotonic "reach
  sequence" stamp).
- **National interest groups award NO EV** — they are an income/side-battle system (see §6).

### Electoral-vote weights (per state)
```
CA 54  TX 40  FL 30  NY 28  PA 19  IL 19  OH 17  GA 16  NC 16  MI 15
NJ 14  VA 13  WA 12  AZ 11  IN 11  MA 11  TN 11  CO 10  MD 10  MN 10
MO 10  WI 10  AL  9  SC  9  KY  8  LA  8  OR  8  CT  7  OK  7  AR  6
IA  6  KS  6  MS  6  NV  6  UT  6  NE  5  NM  5  HI  4  ID  4  ME  4
MT  4  NH  4  RI  4  WV  4  AK  3  DC  3  DE  3  ND  3  SD  3  VT  3  WY 3
```

---

## 3. Turn structure & the two currencies

Play proceeds in simultaneous-turn **rounds**. In each planning phase every player **secretly**
allocates budget; allocations resolve **at the same time** (this enables the central Campaign Collision
mind-game, §7).

**Two kinds of money:**

| Currency | Symbol in code | Flexibility | How earned |
|---|---|---|---|
| **National War Chest** | `nationalCash` | Spends **anywhere** (any state, any network track) | Flat **+250/turn** to every active player, plus national network backing |
| **Coalition Reserves** | `groupWallets[group]` | **Earmarked** — only spends on states **inside that one Coalition** | Earned only by **leading** that Coalition (paid each turn you hold it) |

Wallet drain order on a state purchase: **matching group wallets first (alphabetical by group id),
then national cash.** A state belonging to several groups can be paid from any of those groups'
wallets. This makes earmarked money "sticky" to its lane and rewards building where your coalitions
already pay you.

**Starting cash:** most candidates start with **250** ($250k); the neutral baseline candidate
(Bobby Tooley) starts with **300** but has zero synergies.

---

## 4. Influence Levels — the core action

On your turn you build **Influence Levels** in a state or a national network. Influence Levels stack; more = a
stronger lead. The flat **base cost per Influence Level** of a state ≈ **EV × 0.85** (floor 3), in $1k units.

### Per-rung base cost & max-rung ladder height per state
- **Max Influence Levels** is tiered by state size:
  - **Megastates (CA, FL, TX, NY): 16 Influence Levels**
  - **Small states (EV ≤ 6): 8 Influence Levels**
  - **Everything else: 12 Influence Levels**
- **Boss level (4× cost):** ONLY in **CA and TX**, the final (16th) Influence Level costs **4× base**.

```
State  EV  base/level  maxLevels       State  EV  base/level  maxLevels
CA     54   150       16 (boss 16th)  MO     10   28        12
TX     40   150       16 (boss 16th)  WI     10   36        12
FL     30   100       16              AL      9   42         12
NY     28   100       16              SC      9   42         12
NC     16    80       12              KY      8   24         12
GA     16    72       12              LA      8   40         12
PA     19    78       12              OR      8   16         12
IL     19    70       12              CT      7   30         12
OH     17    66       12              OK      7   14         12
MI     15    78       12              AR      6   36          8
VA     13    66       12              IA      6   28          8
WA     12    48       12              KS      6   12          8
AZ     11    46       12              MS      6   28          8
IN     11    30       12              NV      6   28          8
MA     11    38       12              UT      6   28          8
TN     11    46       12              NE      5   10          8
CO     10    44       12              NM      5   18          8
MD     10    44       12              HI/ID/ME/MT/NH/RI/WV 4  (8/16/8/8/16/8/8) 8
MN     10    28       12              AK/DC/DE/ND/SD/VT/WY 3  (6/22/14/6/6/6/6) 8
NJ     14    60       12
```
*(DC base 22 and NH base 16 are higher than EV×0.85 — minor hand-tuning; small states are otherwise cheap.)*

**Cost to fully call a state** (build all Influence Levels) before any discount:
- CA / TX = 150×15 + (150×4 boss) = **2,850**
- FL / NY = 100×16 = **1,600**
- NC = 80×12 = **960**; a typical small (8-level) state ≈ base×8 (e.g. AK = 48).

### Entry gatekeeper (the per-turn ramp)
- The **first turn you establish a foothold** in a state (starting from 0) you may build at most **2 Influence Levels** (**3** in megastates).
- Once you hold **≥1 level**, the cap lifts — you can **sprint** as many Influence Levels as you can afford, up to max.
- Consequence: you cannot zero-to-call a state in one turn; opening many fronts early then sprinting
  the ones that matter is the intended tempo.

### Calling a state (permanent lock)
- If a **single** player reaches a state's **max Influence Level** in a turn **without a Campaign Collision** (§7), the state is
  **CALLED** — locked to them permanently, guaranteed EV, cannot be flipped.

---

## 5. Coalitions (the coalition income engine)

There are **10 Coalitions** (the code comment says 8, but 10 are defined). Each is a set of member
states. You **LEAD** a Coalition when you control **strictly more than 50%** of the Coalition's total member EV
(counting only states where you hold at least the minimum Influence Levels). The coalition leader
collects that Coalition's **Reserve payout every turn** they hold it.

- **Per-turn payout** = the source-defined `bonusPayout`, scaled by the candidate's payout modifier for that group.
- **Minimum Influence Levels to count a state toward coalition control:** megastates **5**, small (EV≤6) **3**, mid **4**.
  *(Note: this 3/4/5 gate applies to coalition control only — the raw EV tally at election time uses
  whoever simply has the most Influence Levels, any count.)*

| Coalition | Member states | Total EV | Reserve / turn |
|---|---|---:|---:|
| **Latino** | AZ, CA, CO, FL, IL, NV, NJ, NM, NY, TX | 217 | **80** |
| **African American** | AL, AZ, DE, DC, FL, GA, IL, LA, MD, MI, MS, NY, NC, SC, TN, VA | 207 | **100** |
| **Agriculture** | CA, FL, HI, ID, IL, IA, KS, MN, NE, NC, TX, WI | 204 | **50** |
| **High Tech** | CA, CT, DE, MD, MA, MI, NH, NY, PA, UT, VA, WA | 182 | **110** |
| **Export Driven** | LA, CA, TX, FL, NY, WA | 172 | **80** |
| **Manufacturing Base** | IL, IN, KY, MI, NC, OH, PA, TX, WI | 155 | **75** |
| **Swing States** | AZ, CO, FL, IA, NH, NM, NC, OH, PA, VA, WI | 141 | **80** |
| **Oil and Gas** | AK, CA, CO, LA, NM, ND, OK, SD, TX, WV, WY | 140 | **75** |
| **Town and Gown** | AZ, DC, IA, ME, MA, MN, MO, NE, NH, NY, ND, RI, UT, VT | 108 | **100** |
| **Old South** | AL, AR, GA, LA, MD, MS, NC, SC, VA | 93 | **40** |

For reference, the flat War Chest income is **250/turn**, so coalition leads add meaningful lane-specific
money without automatically doubling a player's flexible budget.

### "Hub" states (belong to the most groups)
- **5-group hubs:** **CA, FL, NY, TX, NC** — winning one feeds up to five income engines at once.
- **4-group:** AZ, IL, VA. **3-group:** PA, LA, MI, MD.
- A candidate's cost discount uses the **most-favorable** affinity across all of a state's groups, so
  a cost *penalty* only bites a hub state if **every** group it belongs to is penalized — hubs are
  penalty-resistant.

---

## 6. National Networks (flexible-cash ladders)

Five **National Networks**, each a **10-level** track. They award **no EV**. The **leader with ≥4 Influence Levels**
(highest count; ties to who reached first) earns the network's **turnBonus into War Chest every turn**,
scaled by payout modifier. **Per-level cost is the source-defined `rungCost`**, drawn from War Chest only.

| National Network | Backing / turn | Cost / level | Cost to reach leader (4 levels) | Payback |
|---|---:|---:|---:|---:|
| **Gun Lobby** | 30 | 55 | 220 | ~7.3 turns |
| **Youth Vote** | 30 | 55 | 220 | ~7.3 turns |
| **Big Conservative** | 50 | 90 | 360 | ~7.2 turns |
| **Environmental** | 50 | 90 | 360 | ~7.2 turns |
| **Women's Vote** | 40 | 80 | 320 | ~8 turns |

Networks are slower, flexible-income investments; they pay off only if you can defend the lead and avoid
Campaign Collisions.

---

## 7. Campaign Collisions & Reserve Collapse (the risk layer)

These two rules are what make Elector a mind-game rather than a spreadsheet.

### Campaign Collision
- Operation plans are **simultaneous and hidden**.
- If **two or more** players who built Influence Levels this turn **end on the exact same Influence Level count** in the
  same state (or national network), **all of them are reverted** to their start-of-turn count **AND
  their spend burns** (no refund).
- Players who end on **different** counts keep their progress; **non-buyers are unaffected**.
- Colliding by accident is described in-game as **"the costliest mistake in the game."** It can also be
  done **deliberately** to deny a rival a state they need (you pay too) — e.g. matching someone one level
  from calling a state forces a reset.

### Reserve Collapse
- The moment you **lose coalition control**, **that Coalition's Reserve instantly drops to $0.**
- So earmarked money is "use it or lose it" — banked Coalition Reserves vanish if the coalition flips.
  Strong pressure to defend leads and/or spend Reserves promptly.

### Power Vacuum (multiplayer eliminations)
- In a 3–4 player game, an election with no 270-winner **eliminates the last-place player** (lowest EV;
  tie → lowest total cash). Their Influence Levels are **wiped everywhere** (the "Power Vacuum"), reopening the map.

---

## 8. Election timing & endgame

Elections are **probabilistic** and escalate. `hungColleges` = number of prior elections that produced
no 270-winner.

| Condition | Election chance at end of turn |
|---|---|
| Turn < 11 | 0% (no election possible) |
| 0 hung colleges, turns 11–15 | **12.5%** each turn |
| 0 hung colleges, turn ≥ 16 | **100%** (forced) |
| 1 hung college | 25% |
| 2 hung colleges | 50% |
| 3+ hung colleges | 100% (certain) |

- First to **270** wins immediately.
- No winner with only 2 players left → **hung college**, escalate, continue.
- No winner with 3–4 players → eliminate last place (Power Vacuum), escalate.
- **Tally:** Called states → locked owner; uncalled states → current Influence Level leader (any count, tie→reached
  first). The Projection Pressure curve means you must have a credible path to 270 lined up **before Turn 11**.

---

## 9. The candidate roster

`affinities` = **cost** modifiers (`cost × (1 − affinity)`; **positive = cheaper**, negative = penalty).
`payoutModifiers` = **profit** modifiers (`payout × (1 + modifier)`). Keys are Coalition **or**
National Network ids. The best (max) affinity across a state's Coalitions is the one applied.

### Founding roster — free (always available)
| Candidate | Party | Start cash | Identity | Cost discounts (affinity) | Cost penalties | Profit boosts (payout) | Profit penalties |
|---|---|---:|---|---|---|---|---|
| **Bobby Tooley** | Independent | **300** | "The Baseline" — fully neutral | — | — | — | — |
| **Donald Trump** | Republican | 250 | "Industrial Populist" | Gun Lobby .15, Manufacturing .15, Oil & Gas .15, Agriculture .10, Swing .05 | Town&Gown −.20, High Tech −.15 | Big Conservative .25, Gun Lobby .15, Oil&Gas .15, Old South .10 | Environmental −.20 |
| **Kamala Harris** | Democrat | 250 | "Metro Coalition" | Environmental .20, High Tech .15 | Big Conservative −.25, Old South −.15, Oil&Gas −.15 | Women's Vote .25, Environmental .15, Town&Gown .10 | Oil&Gas −.15, Gun Lobby −.20 |
| **Abraham Lincoln** | Republican | 250 | "Centrist Unifier" | African American .15, Manufacturing .10, Agriculture .10 | Youth Vote −.20, Big Conservative −.10, Environmental −.10 | Swing .20, Export Driven .15, Agriculture .10 | High Tech −.15 |

| **Joe Biden** | Democrat | 250 | "Union Hall Veteran" | Manufacturing .15, African American .15, Town&Gown .10, Agriculture .10 | Gun Lobby −.20, Old South −.10 | Women's Vote .15, Environmental .10, Youth Vote .10 | Big Conservative −.20 |

### Premium roster — unlock with Campaign Funds
| Candidate | Price | Party | Identity | Cost discounts | Cost penalties | Profit boosts | Profit penalties |
|---|---:|---|---|---|---|---|---|
| **Ronald Reagan** | 4,500 | Republican | "Sun Belt Optimist" | Swing .20, Old South .20, Big Conservative .15, Oil&Gas .15 | High Tech −.10, Town&Gown −.15 | Big Conservative .30, Old South .20, Swing .15, Oil&Gas .15 | Environmental −.20 |
| **George Washington** | 4,500 | Independent | "Nonpartisan Founder" — **net-neutral sidegrade** (perks sum to zero) | Agriculture .05, Swing .05 | High Tech −.05, Big Conservative −.05 | Swing .10, Export Driven .05 | Old South −.05, Environmental −.10 |
| **Keir Starmer** | 4,500 | Democrat | "Technocratic Centre" | High Tech .20, Town&Gown .20, Manufacturing .15 | Big Conservative −.20, Oil&Gas −.15, Old South −.10 | Women's Vote .20, High Tech .20, Export Driven .15 | Gun Lobby −.20 |
| **John F. Kennedy** | 4,500 | Democrat | "New Frontier" | High Tech .20, Youth Vote .20, African American .15 | Big Conservative −.20, Oil&Gas −.15, Old South −.10 | Youth Vote .25, High Tech .20, Women's Vote .15 | Gun Lobby −.20 |
| **Nigel Farage** | 10,000 | Republican | "Insurgent Populist" | Gun Lobby .20, Old South .20, Big Conservative .15, Oil&Gas .15 | High Tech −.20, Town&Gown −.15 | Big Conservative .45, Gun Lobby .20, Old South .15 | Environmental −.20 |

Party is **cosmetic only** (sets color/badge; never affects gameplay). **George Washington** was a
limited-time **free grant for July signups**; everyone else buys him for 4,500 Funds, and his
stats are deliberately net-neutral so a free campaign style grants no economic edge.

---

## 10. The bot AI (relevant to "dominant strategy")

Bots use the **exact same rules, costs, and validation** as humans (no separate resolution path).
`planBotTurn` is a pure function; difficulty is a set of tunable "knobs":

- **Easy:** random legal moves, spends ~72–88% of cash, ignores EV density, occasionally pokes a national ladder. Leaves money on the table.
- **Medium:** greedy **value-per-dollar** (EV per $ with affinity awareness), depth-1 buys, light dominance/swing/denial weighting, 4% cash reserve, 35% chance to invest a national ladder. Mild clash-avoidance.
- **Hard:** deeper sprints (depth 3), strong **coalition-dominance pushes**, aggressive **denial of the leader's states**, securing, swing-EV urgency when an opponent nears 270, a **late-game cash reserve** (7%, relaxed as the election clock advances), and very low randomness. Hard actively avoids visible clashes far less than Medium (it will accept trades).

Hard's scoring is the closest the game ships to a "reference strong strategy": prioritize EV-dense and
multi-coalition (hub) states, take/hold leads past opponents, secure to lock EV, push coalitions you can
plausibly dominate, deny the current leader, and bank a war chest for late boss-rung sprints.

---

## 11. Meta-economy — "Campaign Funds" (the soft currency)

Campaign Funds are an **account-only** progression currency (Supabase `profiles` table, mutated only by
server `SECURITY DEFINER` RPCs). **There is no guest/local economy** — signed-out players have no Funds,
unlocks, or stats. The server owns every amount (anti-cheat); the client only reports range-checked
outcomes.

### Ways to EARN Funds

**A) Per-game reward** (server formula, mirrors client):
```
base finish        = 5
win bonus          = 20 (if you won the presidency)
per secured state  = 1
per coalition held = 3
win-streak bonus   = 5 × min(consecutiveWins, 5)   (only if you won)
per-game cap       = 60, reduced by 10 for each prior rewarded game in the last 24h
rolling 24h cap    = 20,000
```
*Typical wins are deliberately modest and combine with daily streaks, achievements, ads, referrals, and
optional IAP rather than acting as the only progression source.*

**B) Daily finish streak** (finish ≥1 game on consecutive **UTC** days — winning not required):
```
Day:    1   2   3   4   5   6   7   8   9  10  11  12  13  14+
Funds: 10  15  20  25  30  35  40  45  50  60  70  80  90  100
```

**C) Achievements** (one-time claims; 23 total across 5 trees — see §12): **10–100 Funds** each.

**D) Rewarded ads** (opt-in): server rolls a **random 20–60 Funds**, **max 5 per rolling 12 hours**.
Requires an account. Ads are never auto-shown.

**E) Referrals:** **500 Funds to BOTH parties**, paid when the **invitee finishes their first game**
(one payout per invited account, ever). See §15.

### Ways to SPEND Funds
- **Unlock premium candidates** — 4 candidates at **4,500 Funds** and Farage at **10,000 Funds**
  (28,000 Funds total).
- **Result card frames** — 2 priced share frames at **3,000 Funds** each.
- **Victory messages** — 3 priced messages at **3,000 Funds** each.

**Implication for analysis:** candidates affect gameplay and are earnable, while cosmetics are the clean
repeat-spend lane. Keep future monetization weighted toward cosmetics rather than dominant gameplay power.

---

## 12. Achievements (full list)

Five trees, one-time Funds reward each, claimed manually. Server-validated.

**Campaign Trail:** First Campaign (finish 1 → 10) · First Victory (win 1 → 25) · Campaign Regular
(finish 10 → 40) · Electoral Fixture (win 25 → 75) · Momentum Run (5-win streak → 100).

**Solo Challenges:** Opening Move (win Easy → 15) · Map Operator (win Medium → 35) · Hard Read (win Hard
→ 75) · Three-Seat Sweep (win 1v3 Hard → 100) · Hard Mode Mandate (win Hard with 350+ EV → 100).

**Strategist:** Locked In (secure 1 state → 15) · Coalition Builder (3 coalitions in one game → 40) ·
Map Lock (secure 10 states in one game → 60) · Landslide (win 350+ EV → 80) · Early Projection (win by
turn ≤12 → 100).

**Online:** On the Air (finish 1 online → 20) · Live Win (win 1 online → 50) · Prime-Time Player (win 5
online → 75) · Network Favorite (win 10 online → 100).

**Roster & Community:** Recruiter (unlock 1 premium → 25) · Full Bench (own all premium → 100) · Field
Office (1 referral → 50) · Ground Game (3 referrals → 100).

Total achievement Funds available ≈ **1,390**.

---

## 13. Real-money monetization (IAP)

**Native iOS only** — Apple **StoreKit** consumables via a Tauri IAP plugin. **No web billing** (a prior
Stripe web rail was removed). On the website the paid funds cards are hidden; players top up
only in the iOS app. The server (`fulfill_purchase`) owns grant amounts and is **idempotent on the
transaction id** (replayed receipts never double-credit). App Store Connect sets the **per-territory**
price; the listed USD is a fallback shown until StoreKit's localized price loads.

| SKU | Funds granted | USD (fallback) | Badge | Funds per $ | Progress equivalent |
|---|---:|---:|---|---:|---:|
| `funds_600` | 600 | $0.99 | **Starter** | ~606 | starter progress |
| `funds_1500` | 1,500 | $2.99 | — | ~502 | 1 |
| `funds_4000` | 4,000 | $4.99 | — | ~802 | 2.6 |
| `funds_9000` | 9,000 | $8.99 | **Most popular** | ~1,001 | 6 |
| `funds_20000` | 20,000 | $14.99 | **Best value** | ~1,334 | 13.3 |
| `funds_45000` | 45,000 | $19.99 | **Most Funds** | ~2,251 | 30 |

Everything is consumable Funds — there are no direct-purchase characters or subscriptions. Paid candidates
are earnable sidegrades; cosmetic items are the preferred long-term sink.

---

## 14. Ads

- **Google AdMob**, **rewarded only**, **opt-in**, **iOS launch target** (Android deferred). Publisher
  `pub-5364561069734393`; rewarded unit `ca-app-pub-5364561069734393/7845987969`.
- **Non-personalized** (no ATT/IDFA prompt; no cross-app tracking) per the privacy configuration.
- Payout 20–60 Funds, server-random, capped 5 / 12 hours (shared with §11D).
- A first-party **inline "sponsored message"** fallback (8-second timer) exists for dev/no-network-revenue
  builds; off in production by default.

---

## 15. Referrals & virality

- Every account gets an opaque referral code; invite link is `https://playelector.com/?ref=CODE`.
- A **brand-new** account (no finished games yet) records its referrer; established players cannot
  retro-attribute themselves.
- **Reward = 500 Funds to each side**, paid when the **invitee finishes their first game** (proof-of-play
  gate, not signup), exactly once per invited account (anti-fraud).
- Rewards are **never** tied to leaving a store review (Apple 3.1.1 / Google policy compliance).
- There is also a **share card** feature (renders an SVG→PNG result card for social sharing).

This is the main built-in growth loop: K-factor depends on invites-sent × signup rate × first-game-completion rate.

---

## 16. Marketing & positioning (from the store listing)

- **App name:** Elector · **Subtitle:** "Race to 270" · **Price:** Free.
- **Category:** Games → Strategy (secondary: Board). **Age:** 12+.
- **Promo text:** *"Campaign across all 50 states, build coalitions, and outspend your rivals in the
  strategy game of winning the US Electoral College. Solo, pass-and-play, or online."*
- **Long description hook:** *"Win the White House the hard way — 270 electoral votes at a time."*
  Feature bullets: Solo vs bots (no account) · Pass-and-play · Online · Roster of candidates · Earn & unlock.
- **ASO keywords:** `election, electoral, president, strategy, politics, 270, campaign, board game,
  turn based, USA, vote, coalition`.
- **Legal/positioning spine:** satire/parody disclaimer enabling use of real political figures; "not
  affiliated/endorsed." This is both a legal shield and part of the comedic brand.
- **Domain/brand:** playelector.com; privacy at playelector.com/privacy; support at playelector.com/support.
- **Current iOS release state:** build 48 has been uploaded to App Store Connect/TestFlight and selected for iOS version 1.0.

---

## 17. Analytics funnel (events instrumented)

PostHog events exist for the monetization/growth funnel, useful for any growth analysis:
`shop_opened` (with source + platform + native-billing availability) · `item_unlocked` (candidate, price
in Funds) · `checkout_started` / `checkout_result` (SKU, USD value, platform, status, failure reason) ·
`rewarded_ad_started` / `_claimed` / `_limited` / `_cancelled` / `_claim_failed` (placement, amount,
remaining, provider). Privacy posture is manual analytics with no PostHog autocapture or session replay.

---

## 18. Strategic levers & emergent math (raw material for dominant-strategy discussion)

Factual relationships derived from the numbers above — useful seeds for analysis (not prescriptions):

1. **Hub primacy.** CA, FL, NY, TX, NC each sit in 5 coalitions. Leading one contributes EV toward up to
   five dominance checks simultaneously, and (for cost) hubs resist candidate penalties because the best
   affinity across their groups is applied.
2. **Snowball curve.** Coalition payouts (40–110/turn) become powerful once you stack
   2–3 of them; income compounds into more rungs, which defends/extends dominance. Early breadth → mid-game
   depth is the intended arc.
3. **Boss-rung economics.** Only CA & TX have a 4× final rung (600 to top them). They are the most
   expensive secures (2,850) but also the densest hubs — late-game "war chest" plays.
4. **National-ladder ROI.** Networks pay back the 4-level leader investment in roughly 7–8 turns before
   modifiers. They feed **flexible** cash, which is strictly more useful than earmarked wallet money.
5. **Clash as a weapon and a tax.** Deliberate clashing denies a rival a needed state/secure but costs you
   the spend too; it's an EV-trade decision. Reading opponents' likely end-rung counts is the skill ceiling.
6. **Evaporation discipline.** Don't bank earmarked wallets you might lose; spend them inside their lane
   before a coalition can flip.
7. **Election-clock pressure.** With a 12.5%/turn base chance from turn 11 and a forced election at turn 16
   (escalating after each hung college), a credible 270 path must exist by ~round 10–11; tie-breaks fall to
   cash-on-hand, so don't bankrupt yourself the turn before the gavel.
8. **Tie-break stacking.** Equal rung counts resolve to **whoever reached the count first** — tempo and
   sequencing matter independent of spend.
9. **Candidate identity = a spending map.** Trump/Farage/Reagan are "red-coalition" cost+profit engines
   (Gun Lobby, Oil & Gas, Old South, Big Conservative); Harris/Biden/Starmer/JFK are "metro" engines (High
   Tech, Women's Vote, Environmental, Youth, Town & Gown); Lincoln is a centrist swing/agriculture build;
   Tooley/Washington are neutral. Penalties define where each is forced to overpay.

---

## 19. Open questions an analyst might probe

- **Sink depth:** current Funds sinks include 28,000 in premium candidates plus 15,000 in live cosmetics.
  What cadence of new cosmetics/candidates keeps engaged players motivated without creating pay-to-win pressure?
- **IAP ladder fit:** the $19.99 pack now has a collector/supporter role. Does conversion cluster around the
  starter, most-popular, or top pack once TestFlight purchase telemetry exists?
- **Ads vs IAP cannibalization:** 5 free 20–60 Funds ad-claims per 12h (≈ up to 600 Funds/day) plus
  per-game rewards may undercut the impulse to buy Funds. Worth modeling.
- **Virality math:** 500+500 Funds per completed-first-game referral — strong incentive; the gate is
  first-game completion. What's the realistic invite→signup→first-game conversion?
- **Balance asymmetry:** are the red-coalition candidates (overlapping Big Conservative/Gun Lobby/Oil&Gas
  on both cost AND payout) stronger than the metro builds, given coalition geography? Tooley's +50 starting
  cash vs zero synergies is a clean A/B for "tempo vs engine."
- **Discovery/positioning:** political-satire framing is both a hook and a sensitivity; how does that
  interact with App Store features, paid UA, and seasonal (US election-cycle) demand spikes?

---

*Source of truth: the Elector codebase (game engine `src/game/*`, server economy `supabase/*.sql`,
client monetization `src/utils/iap.ts` & `rewardedAds.ts`, store listing `APP_STORE_LISTING.md`).
All figures current as of June 2026.*
