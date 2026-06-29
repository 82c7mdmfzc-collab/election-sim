# Economy balance simulation — harness + findings

A headless Monte-Carlo harness that plays full games through the **production**
engine (`resolveTurn` / `rollElection` / `resolveElection`, intents validated by
`buildPendingSubmission`) to measure whether any strategy or candidate is
significantly stronger than others. No game rules are reimplemented; only the
turn driver is new.

## Run it

```bash
npm test                                                    # fast smoke + sanity only
RUN_SIM=1 npx vitest run src/game/sim/balanceSim.test.ts    # full sim (~6 min) → report
RUN_SIM=1 SIM_N=400 npx vitest run src/game/sim/balanceSim.test.ts   # bigger sample
```

Output (gitignored): `sim-output/economy-sim-findings.md` + `sim-output/results.json`.
Runs are deterministic per seed, so numbers reproduce exactly.

Files: `runGame.ts` (game loop + metrics), `strategies.ts` (bot wrapper + scripted
archetypes), `balanceSim.test.ts` (experiments E1–E4 + report writer).

---

## TL;DR verdict on "FL/NY/CA/TX are too strong"

**Half right — and the half that's wrong matters more.**

- **Yes**, among equal-skill players the Big-4 *decide* games: at hard difficulty
  the winner led **3.48 of 4** megastates in **99.6%** of games; the loser averaged
  **0.10**. Games visibly revolve around them.
- **But** the megastates are a **trap, not the best play**. A strategy that **never
  buys a megastate** and floods cheap states (`valueSmall`) wins **85%** of all
  matchups and beats a megastate-rush **~100–0**. The Big-4 are over-priced, not
  under-priced.
- Therefore the proposed fix — **another −20% on other states — is the wrong
  direction**. The −20% already exists (`statesData.ts`), and cheap states are
  *why* the flood strategy dominates. Cutting them further widens the imbalance.

The dominant lever is the **EV tally + entry cap**, not megastate price.

---

## The data (full run: E1 250/diff, E2 200/pair, E3 80/candidate)

### E1 — mirror match (identical bot + neutral candidate both seats)
Any pattern in the *winner* here is structural, since both seats are identical.

| difficulty | winner Big-4 led | loser Big-4 led | games winner led ≥3 of 4 | winner mega-EV |
|---|---|---|---|---|
| medium | 2.63 / 4 | 1.26 | 56.8% | 101.9 |
| hard | **3.48 / 4** | 0.10 | **99.6%** | 137.3 |

Mirror split was 47/53 and 51/49 → harness is unbiased. Winning routes through the
Big-4 **when both players contest them** (which the AI does).

### E2 — strategy duels (overall win rate, pooled)
| strategy | win rate |
|---|---|
| **valueSmall** (cheap states, never mega) | **85.4%** |
| swingFocus | 58.5% |
| big4Rush | 49.8% |
| **bot-hard** (the shipped AI) | 36.5% |
| coalitionFarmer | 19.9% |

`valueSmall` beats `big4Rush` **100–0** and the shipped AI **58.5%**. The megastate
rush isn't weak in a vacuum (it beats the AI 99% and coalitionFarmer 100%) — it just
gets crushed by breadth. **The shipped hard AI (36.5%) is itself beaten by simple
flooding**, so a min-maxing human will feel the game is "solved" by breadth.

### E3 — candidate strength vs the neutral baseline (Bobby Tooley)
Every candidate with affinities **crushes** the zero-modifier default:

Starmer 100% · JFK 98.8% · Harris 97.5% · Trump 96.3% · Biden 90% · Lincoln 86.3% ·
Reagan 78.8% · Farage 71.3% · Washington 58.8%

Cost-affinities are nearly pure upside (you steer spend to discounted groups, dodge
penalised ones), so the **neutral starter is strictly the worst pick** — a real
problem since it's the default free candidate.

### E4 — coalitions are mostly peripheral
Winner-held % at the deciding tally, vs payout:

| coalition | payout/turn | winner-held % |
|---|---|---|
| Town and Gown | 100 | **67.5%** |
| Swing States | 80 | 35.1% |
| Manufacturing Base | 75 | 32.2% |
| Agriculture | 50 | 21.9% |
| Old South | 40 | 20.3% |
| Export Driven | 80 | 17.8% |
| Latino | 80 | 17.6% |
| African American | 100 | 17.1% |
| Oil and Gas | 75 | 10.1% |
| High Tech | **110** | **8.6%** |

Only the cheap, small-state **Town and Gown** is reliably held. The **highest-payout
coalition (High Tech, 110) is the least completed (8.6%)** — too expensive/megastate-
heavy, and games end (~20–27 turns) before coalition income compounds. Coalition
reshuffling is low-leverage *unless* coalition income is made more central.

### Reference — EV per $1k (current prices)
Most efficient: OK 0.64, OR 0.62, IN 0.46, MN 0.45, MO 0.45, KY 0.42 …
Megastates: CA 0.36, FL 0.30, NY 0.28, **TX 0.27** … worst: AR 0.21, DC 0.17.
The Big-4 sit mid-to-low; TX/NY are among the worst value in the game.

---

## Why breadth wins (mechanism)

`tallyElectoralVotes` awards a state's **full** EV to whoever leads it by **even one
rung** — there is no minimum. So blanketing the ~47 non-megastates with 1 rung each
(uncontested while the opponent overpays for rung-capped megastates) banks 380+ EV
cheaply, far past the 270 needed. The entry cap (2–3 rungs/turn) limits *depth*, not
*breadth*, so it doesn't stop the land-grab. Megastates concentrate spend into 152 EV
of expensive turf and leave the rest of the map free for the opponent.

---

## Ranked rebalance menu (NOT applied — pick scope, then I'll implement + re-sim)

Each option lists the lever, the data it targets, and the predicted effect. The
harness can A/B any of these (edit `config.ts`/`statesData.ts`, re-run, compare).

1. **[Highest leverage] Require a minimum rung count to bank a state's EV.**
   Today any rung ≥1 leads the tally. Gate it (e.g. ≥2, or scale by size like the
   dominance rule already does in `minRungsForDominance`). Kills 1-rung flooding,
   rewards commitment. *Predicted: collapses `valueSmall`'s 85% toward parity; makes
   depth vs breadth a real choice.* Needs playtesting — it's the biggest change.

2. **Re-price the cost curve (reverse the instinct).** Small/mid states are too cheap
   relative to megastates. Raise low-EV state prices and/or trim megastate prices so
   EV/$ is flatter across the board. *Predicted: narrows `valueSmall` vs `big4Rush`;
   directly opposes "−20% on others".*

3. **Megastates need no nerf.** A pure rush is ~50% and they're poor EV/$. Do **not**
   add cost or extend the boss rung — that pushes play further toward breadth. If
   anything, a *small* megastate discount makes the rush a viable alternative line.

4. **Fix coalition outliers (variety, not balance).** Agriculture (204 EV, 3 mega,
   only $50 — nobody wants it) and High Tech (110 payout but 8.6% completed) are the
   clear ones. Spreading the Big-4 out of Export Driven/Latino and pulling mid/small
   states in (your instinct) makes coalitions more *accessible* like Town and Gown —
   reasonable, but expect small win-rate impact unless payouts/game length change.

5. **Candidate roster.** Buff the neutral default (or steepen affinity penalties) so
   the free starter isn't strictly worst; Starmer/JFK/Harris/Trump are the strong
   cluster. Separate axis from the state/coalition question.

---

## Caveats (so the numbers aren't over-read)

- Scripted archetypes are deliberately one-dimensional *ceilings*; real players are
  messier, so `valueSmall`'s 85% is the exploit's upper bound, not the average game.
- The bot is a skilled-play proxy; its scorer mildly favors multi-coalition (mega)
  states, which is part of why E1 is so megastate-centric — exactly matching the
  human perception that the Big-4 dominate.
- E3 is *vs the neutral baseline*, so it robustly flags "neutral is weak" but isn't a
  full candidate-vs-candidate ranking.
- Games end ~20–27 turns, so long-game coalition compounding is undervalued here.
