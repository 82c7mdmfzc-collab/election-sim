# Differentiation Pass — Elector Naming & Copy

This document records the complete naming/copy differentiation pass applied to Elector to establish independent identity and remove 270-adjacent language from all player-facing surfaces.

---

## Naming Map Applied

| Category | Old term | New term |
|----------|----------|----------|
| Core unit | rung / rungs | Influence Level / Influence Levels |
| Build action | buy rungs | build influence / build Influence Levels |
| First entry | first enter a state | establish a foothold |
| Entry gate | entry gate | foothold limit |
| Top rung | top rung / max rung | full influence |
| State ladder | state ladder | influence track |
| State leader | state leader | influence leader |
| Permanent lock | secured / locked | Called |
| Secure a state | secure a state | call a state |
| Locked state | secured state | Called State |
| Clash / conflict | clash / conflict | Campaign Collision |
| Clashed | clashed | collided |
| Clash risk | clash risk | collision risk |
| Clash warning | clash warning | collision warning |
| Spend burned | cash forfeit | spend burned |
| State Groups | State Groups | Coalitions |
| Group dominance | dominate a group | lead a Coalition |
| Group payout | group payout | coalition backing |
| Group wallet | group wallet / earmarked wallet | Coalition Reserve |
| Wallet evaporation | wallet evaporated / Evaporation Penalty | Reserve Collapse |
| National Groups | National Groups | National Networks |
| National group ladder | national group rungs | network influence levels |
| National group leader | national group leader | network leader |
| National cash | national cash | War Chest (or National War Chest) |
| Campaign money | campaign money / campaign cash | War Chest |
| Meta-currency | Campaign Funds | Campaign Credits |
| Ballot / election timing | hung college | Deadlocked Election |
| Election chance | election chance | Projection Pressure |
| Turn summary | Resolution — Turn N | Campaign Report — Turn N |
| Submit action | Submit Turn | Submit Plan |
| Planning hint | No allocations yet | No operation plan yet |
| Allocation | allocation | operation plan |
| Shop | Campaign Shop / Shop | Campaign Store / Store |
| Buy funds | Buy Campaign Funds | Get Campaign Credits |
| Daily mode | Daily Challenge | Daily Race |
| How to Play | How to Play | Campaign Guide |
| Pass & Play mode | Pass & Play | Local |
| Base income | +250/turn flat | +240/turn flat |

---

## Files Audited and Changed

### Game logic / copy
- `src/game/config.ts` — `NATIONAL_INCOME` 250 → 240; comment updated
- `src/game/tips.ts` — full rewrite of all `TIPS`, `STRATEGY_TIPS`, and `HOW_TO_PLAY` sections
- `src/game/tutorial.ts` — full rewrite of all 8 `TUTORIAL_STEPS` titles and bodies
- `src/game/turnSummary.ts` — 6 player-facing message templates updated
- `src/game/turnSummary.test.ts` — 4 test assertions updated to match new strings
- `src/game/engine.test.ts` — 3 income assertions updated (250 → 240)

### Components
- `src/components/WalletDrawer.tsx` — "State Group Wallets" → "Coalition Reserves"; "National" → "War Chest"; "EVAPORATED" → "RESERVE COLLAPSED"
- `src/components/SecuredToast.tsx` — "secured {target}!" → "called {target}!"
- `src/components/PhaseFooter.tsx` — "CLASH" → "COLLISION"; "cash forfeit" → "spend burned"; "election chance" → "Projection Pressure"; "No allocations yet" → "No operation plan yet"; rung chips → "Influence Level(s)"; "Submit Turn" → "Submit Plan"; resolution title → "Campaign Report"
- `src/components/RungTrack.tsx` — all title/aria-label strings: "Buy/Undo/Rung N" → "Build/Undo/Influence Level N"
- `src/components/CampaignCoach.tsx` — all coaching copy rewritten (rungs → Influence Levels; state groups → Coalitions; national cash → War Chest; dominate → lead/control; secure → call)
- `src/components/Landing.tsx` — "clash costs you both" → "collision burns you both"; "Guided Solo • Pass-and-Play • Online" → "Solo Campaign • Local Campaign • Online Campaign"
- `src/components/ElectionMap.tsx` — "{N} rungs" → "{N} Influence Levels"; "Base $k/rung" → "Base $k/level"; "Secured by" → "Called for"
- `src/components/VictoryPodium.tsx` — "states locked" → "states called"; "groups dominant" → "coalitions led"
- `src/components/DailyChallenge.tsx` — "Daily Challenge" → "Daily Race"; description rewritten
- `src/components/Shop.tsx` — "Campaign Shop" → "Campaign Store"; all "Funds" display → "Credits"; "Buy Campaign Funds" → "Get Campaign Credits"; "Earn Campaign Funds" → "Earn Campaign Credits"
- `src/App.tsx` — mode labels: "Daily" → "Daily Race"; "Pass & Play" → "Local"; "Shop" → "Store"; "How to Play" → "Campaign Guide"

### Utilities
- `src/utils/shareImage.ts` — "secured" → "called"; "clash" → "collision"; "hung Electoral College" → "Deadlocked Election"
- `src/utils/notifications.ts` — "race to 270" comeback copy → Election Night framing

### Documentation
- `ELECTOR_GAME_BRIEF.md` — major sections updated: Influence Levels, Coalitions, National Networks, Called states, Campaign Collisions, Reserve Collapse, 240/turn base income, Campaign Credits

---

## Base Income: Changed to 240

`NATIONAL_INCOME` changed from `250` to `240` in `src/game/config.ts`.

**Reasoning:** The value 250 closely mirrors another game's base income figure. Changing to 240 is a flat rescale for all players (no asymmetric impact), required only 3 test assertion updates in `engine.test.ts`, and reduces surface-level similarity. The `startingCash: 250` on candidate definitions is a separate constant (initial hand cash, not per-turn income) and was left unchanged.

---

## Remaining Similarity Risks

1. **Simultaneous hidden allocation mechanic** — this is the core structural similarity. No copy change addresses it because it is fundamental gameplay. It is presented under Elector's own framing (operation plan, Campaign Collision) rather than explaining the mechanic in terms another game uses.
2. **10-rung national network tracks** — the internal variable name `maxRungs = 10` for national groups is unchanged. Player-visible copy says "10 Influence Levels" now.
3. **State cost table and EV weights** — identical to real US electoral geography; cannot be differentiated.
4. **Coalition dominance structure** — "over 50% of group EV" threshold is a clean design choice that exists in other political strategy games. The branding (Coalition Reserve, Reserve Collapse) is now distinct.
5. **Bot difficulty naming** — "Easy / Medium / Hard" labels in `BotSetup.tsx` are generic and unchanged.

---

## What Was Intentionally Not Changed

| Item | Reason |
|------|--------|
| Internal variable names (`nationalCash`, `groupWallets`, `securedBy`, `clashedStates`, etc.) | Would require touching Supabase schema, RPC calls, save data, and 500+ internal references. Risk far outweighs benefit. |
| CSS class names (`rung-track`, `rung-pip`, `clash-chip`, etc.) | Purely internal; never visible to players. |
| `WIN_THRESHOLD = 270` | US electoral law — cannot change. |
| `startingCash: 250` in candidates | Separate from base income; Tooley already has 300 as a standout. No player-facing confusion. |
| IAP SKUs, prices, reward amounts | No change permitted per constraints. |
| Supabase schema / RPC names | No change permitted per constraints. |
| Analytics event names | Breaking change risk; internal only. |
| Bot logic | No change permitted per constraints. |
| Candidate stats, state costs, group payouts | No change permitted per constraints. |
| Victory messages | Already well-differentiated and branded. |
| `ELECTION_START_TURN = 11` | Core game timing; also appears in 270 but this is inherent to US election modeling. |

---

## Recommended Future Deeper Differentiation

1. **Rename the national network tracks** — current names (Gun Lobby, Women's Vote, Youth Vote, etc.) are generically political. A future pass could give them Elector-branded faction names.
2. **Unique victory condition framing** — consider adding an "Electoral College Projection" metaphor through the UI to lean into the Election Night theme throughout the board, not just at resolution.
3. **Distinctive state card design** — the influence track pip display is similar visually to other rung-based games. A unique visual treatment (e.g. "influence meter" bar instead of pips) would add visual differentiation.
4. **Elector-specific tutorial mascot or narrator** — the Campaign Coach is functional but generic. A named Elector character (pundit, campaign manager) would give the tutorial voice a distinct brand identity.
5. **Narrative turn reports** — the Campaign Report (formerly Resolution) could include election-night style "desk" commentary language to deepen the Election Night fiction.
6. **State group artwork** — replacing stock imagery with original Elector-commissioned coalition artwork would be the single highest-impact visual differentiation step.
