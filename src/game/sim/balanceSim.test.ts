/**
 * Balance simulation — measures whether any strategy or candidate is significantly
 * stronger than others. The heavy Monte-Carlo runs ONLY when RUN_SIM=1 (so normal
 * `npm test` stays fast); by default this file runs a quick smoke + sanity checks.
 *
 *   npm test                                            # smoke only
 *   RUN_SIM=1 npx vitest run src/game/sim/balanceSim.test.ts   # full sim + report
 *   RUN_SIM=1 SIM_N=600 npx vitest run …                # override sample size
 *
 * Output (gitignored): sim-output/economy-sim-findings.md + sim-output/results.json
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGame, hashSeed, type Seat, type GameResult } from './runGame';
import { botStrategy, SCRIPTED } from './strategies';
import { CANDIDATES, CANDIDATE_MAP, type CandidateDef } from '../candidates';
import { STATE_GROUPS, MEGASTATE_IDS } from '../config';
import { ALL_STATES } from '../statesData';

const NEUTRAL = CANDIDATE_MAP['tooley']; // zero affinities — isolates strategy/state effects
const MEGA = [...MEGASTATE_IDS];

// ── small stats helpers ─────────────────────────────────────────────────────────
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? (100 * n) / d : 0);
const f1 = (x: number) => x.toFixed(1);
const seedFor = (tag: string, i: number) => hashSeed(`${tag}:${i}`);

function seat(label: string, candidate: CandidateDef, strategy: Seat['strategy']): Seat {
  return { label, candidate, strategy };
}

/** Run n games for a fixed seat pair, alternating seat order to cancel index bias. */
function runPair(a: Seat, b: Seat, n: number, tag: string): GameResult[] {
  const out: GameResult[] = [];
  for (let i = 0; i < n; i++) {
    const seats = i % 2 === 0 ? [a, b] : [b, a];
    out.push(runGame(seats, seedFor(tag, i)));
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════
// Smoke + sanity (always runs — keeps the engine wiring honest and npm test fast)
// ════════════════════════════════════════════════════════════════════════════════

describe('balance sim — smoke & sanity', () => {
  it('plays valid, terminating games and is deterministic', () => {
    const a = seat('seatA', NEUTRAL, botStrategy('medium'));
    const b = seat('seatB', NEUTRAL, botStrategy('medium'));

    for (let i = 0; i < 6; i++) {
      const r = runGame([a, b], seedFor('smoke', i));
      const totalEV = r.players.reduce((s, p) => s + p.finalEV, 0);
      expect(totalEV).toBeLessThanOrEqual(538);
      expect(r.winnerId).not.toBeNull();
      for (const p of r.players) {
        expect(p.finalEV).toBeGreaterThanOrEqual(0);
        expect(p.spentTotal).toBeGreaterThanOrEqual(0); // no overspend (engine guarantees it)
        expect(p.big4Led).toBeLessThanOrEqual(4);
      }
      const winner = r.players.find((p) => p.id === r.winnerId)!;
      if (!r.timedOut) expect(winner.finalEV).toBeGreaterThanOrEqual(270);
    }

    // Determinism: identical seed → identical outcome.
    const x = runGame([a, b], 4242);
    const y = runGame([a, b], 4242);
    expect(y.winnerId).toBe(x.winnerId);
    expect(y.players.map((p) => p.finalEV)).toEqual(x.players.map((p) => p.finalEV));

    // Scripted archetypes must also produce legal, terminating games.
    const big4 = seat('big4Rush', NEUTRAL, SCRIPTED.big4Rush);
    const val = seat('valueSmall', NEUTRAL, SCRIPTED.valueSmall);
    const r2 = runGame([big4, val], 7);
    expect(r2.winnerId).not.toBeNull();
    // valueSmall must never lead a megastate (proves the archetype constraint holds).
    const vs = r2.players.find((p) => p.label === 'valueSmall')!;
    expect(vs.evFromMega).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Full Monte Carlo (RUN_SIM=1) — writes the findings report
// ════════════════════════════════════════════════════════════════════════════════

const RUN = !!process.env.RUN_SIM;
const SIM = RUN ? it : it.skip;

SIM(
  'runs experiments E1–E4 and writes the findings report',
  () => {
    const N = Number(process.env.SIM_N || '0');
    const n1 = N || 250; // E1 games per difficulty
    const n2 = N || 200; // E2 games per strategy pair
    const n3 = N || 80; // E3 games per candidate (vs neutral baseline)
    const lines: string[] = [];
    const raw: Record<string, unknown> = {};
    const P = (s = '') => lines.push(s);

    P(`# Economy Simulation — Findings`);
    P(`_Generated ${new Date().toISOString().slice(0, 10)} · seeds reproducible · engine = production resolveTurn_`);
    P('');

    // ── E1: symmetric baseline — does winning route through the megastates? ───────
    P(`## E1 — Symmetric baseline (mirror match, neutral candidate)`);
    P(`Both seats run the identical bot brain and neutral candidate, so any state-level`);
    P(`pattern in the *winner* is structural, not strategy/candidate bias.`);
    P('');
    const e1raw: Record<string, unknown> = {};
    for (const diff of ['medium', 'hard'] as const) {
      const a = seat('seat0', NEUTRAL, botStrategy(diff));
      const b = seat('seat1', NEUTRAL, botStrategy(diff));
      const games = runPair(a, b, n1, `e1-${diff}`);
      const winnerBig4: number[] = [];
      const loserBig4: number[] = [];
      const winnerMegaEV: number[] = [];
      const loserMegaEV: number[] = [];
      const winnerTotEV: number[] = [];
      let win3plus = 0;
      const megaWinControl: Record<string, number> = Object.fromEntries(MEGA.map((m) => [m, 0]));
      let seat0wins = 0;
      let timeouts = 0;
      const turns: number[] = [];
      for (const g of games) {
        if (g.timedOut) timeouts++;
        turns.push(g.endTurn);
        if (g.winnerLabel === 'seat0') seat0wins++;
        const w = g.players.find((p) => p.won)!;
        const l = g.players.find((p) => !p.won)!;
        winnerBig4.push(w.big4Led); loserBig4.push(l.big4Led);
        winnerMegaEV.push(w.evFromMega); loserMegaEV.push(l.evFromMega);
        winnerTotEV.push(w.finalEV);
        if (w.big4Led >= 3) win3plus++;
        for (const m of MEGA) if (w.megaStatesLed.includes(m)) megaWinControl[m]++;
      }
      P(`### difficulty = ${diff} (${games.length} games)`);
      P(`- Mirror-match win split (sanity, expect ~50/50): **${f1(pct(seat0wins, games.length))}% / ${f1(pct(games.length - seat0wins, games.length))}%**`);
      P(`- Avg Big-4 megastates led — **winner ${winnerBig4.length ? mean(winnerBig4).toFixed(2) : '–'}** vs loser ${mean(loserBig4).toFixed(2)} (of 4)`);
      P(`- Games where the winner led **≥3 of the Big 4: ${f1(pct(win3plus, games.length))}%**`);
      P(`- Avg EV from megastates — winner **${f1(mean(winnerMegaEV))}** vs loser ${f1(mean(loserMegaEV))} (winner avg total EV ${f1(mean(winnerTotEV))})`);
      P(`- Winner megastate control rate: ${MEGA.map((m) => `${m} ${f1(pct(megaWinControl[m], games.length))}%`).join(' · ')}`);
      P(`- Avg game length ${f1(mean(turns))} turns · timeouts ${f1(pct(timeouts, games.length))}%`);
      P('');
      e1raw[diff] = {
        winnerBig4Avg: mean(winnerBig4), loserBig4Avg: mean(loserBig4),
        win3plusPct: pct(win3plus, games.length),
        megaWinControl, timeoutPct: pct(timeouts, games.length), avgTurns: mean(turns),
      };
    }
    raw.E1 = e1raw;

    // ── E2: archetype duels — which strategy actually wins? ──────────────────────
    P(`## E2 — Strategy archetype duels (head-to-head win rates)`);
    P(`Neutral candidate both sides; seat order alternated. Win rate = games won / played.`);
    P('');
    const labels = ['big4Rush', 'valueSmall', 'coalitionFarmer', 'swingFocus', 'bot-hard'];
    const stratFor = (label: string) =>
      label === 'bot-hard' ? botStrategy('hard') : SCRIPTED[label];
    const wins: Record<string, number> = Object.fromEntries(labels.map((l) => [l, 0]));
    const played: Record<string, number> = Object.fromEntries(labels.map((l) => [l, 0]));
    const matrix: Record<string, Record<string, number>> = {};
    for (const A of labels) matrix[A] = {};
    const e2pool: GameResult[] = []; // retained for E4 (no re-running)
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const A = labels[i], B = labels[j];
        const games = runPair(seat(A, NEUTRAL, stratFor(A)), seat(B, NEUTRAL, stratFor(B)), n2, `e2-${A}-${B}`);
        e2pool.push(...games);
        let aw = 0;
        for (const g of games) {
          played[A]++; played[B]++;
          if (g.winnerLabel === A) { wins[A]++; aw++; } else if (g.winnerLabel === B) wins[B]++;
        }
        matrix[A][B] = pct(aw, games.length);
        matrix[B][A] = pct(games.length - aw, games.length);
      }
    }
    // Win-rate matrix table
    P(`Row beats Column, % (row's win rate in that matchup):`);
    P('');
    P(`| | ${labels.join(' | ')} |`);
    P(`|---|${labels.map(() => '---').join('|')}|`);
    for (const A of labels) {
      P(`| **${A}** | ${labels.map((B) => (A === B ? '–' : f1(matrix[A][B]))).join(' | ')} |`);
    }
    P('');
    const overall = labels
      .map((l) => ({ l, wr: pct(wins[l], played[l]) }))
      .sort((a, b) => b.wr - a.wr);
    P(`Overall win rate (all matchups pooled):`);
    P('');
    P(`| strategy | win rate |`);
    P(`|---|---|`);
    for (const o of overall) P(`| ${o.l} | **${f1(o.wr)}%** |`);
    P('');
    raw.E2 = { matrix, overall };

    // ── E3: candidate strength vs the neutral baseline ───────────────────────────
    P(`## E3 — Candidate strength vs the neutral baseline`);
    P(`Each candidate (bot-hard) plays the zero-modifier baseline Bobby Tooley (bot-hard),`);
    P(`seat order alternated. Win rate >50% ⇒ stronger than a blank slate. Baseline ≡ 50%.`);
    P('');
    const crank = CANDIDATES.filter((c) => c.id !== 'tooley')
      .map((c) => {
        const games = runPair(
          seat(c.id, c, botStrategy('hard')),
          seat('tooley', NEUTRAL, botStrategy('hard')),
          n3,
          `e3-${c.id}`,
        );
        const w = games.filter((g) => g.winnerLabel === c.id).length;
        return { id: c.id, name: c.name, wr: pct(w, games.length) };
      })
      .sort((a, b) => b.wr - a.wr);
    P(`| candidate | win rate vs neutral |`);
    P(`|---|---|`);
    for (const c of crank) P(`| ${c.name} | **${f1(c.wr)}%** |`);
    P('');
    P(`_Balanced roster ⇒ all near 50%. Outliers >~58% or <~42% indicate candidate imbalance._`);
    P('');
    raw.E3 = crank;

    // ── E4: coalition usage by winners ───────────────────────────────────────────
    P(`## E4 — Coalition ROI (how often the *winner* holds each coalition)`);
    P(`Pooled over all ${e2pool.length} E2 games. "Winner-held %" = share of games the winner`);
    P(`dominated it at the deciding tally; compare against payout to spot over/under-valued coalitions.`);
    P('');
    const held: Record<string, number> = Object.fromEntries(STATE_GROUPS.map((g) => [g.id, 0]));
    for (const g of e2pool) {
      const w = g.players.find((p) => p.won);
      for (const c of w?.coalitionsDominated ?? []) held[c] = (held[c] ?? 0) + 1;
    }
    const groupRows = STATE_GROUPS.map((g) => ({
      id: g.id, payout: g.bonusPayout, totalEV: g.totalEV,
      megaMembers: g.members.filter((m) => MEGASTATE_IDS.has(m)).length,
      heldPct: pct(held[g.id], e2pool.length),
    })).sort((a, b) => b.heldPct - a.heldPct);
    P(`| coalition | payout/turn | total EV | mega members | winner-held % |`);
    P(`|---|---|---|---|---|`);
    for (const r of groupRows)
      P(`| ${r.id} | ${r.payout} | ${r.totalEV} | ${r.megaMembers} | ${f1(r.heldPct)}% |`);
    P('');
    raw.E4 = groupRows;

    // ── static EV/$ reference ────────────────────────────────────────────────────
    P(`## Reference — EV per $1k by state (current prices)`);
    const effRows = [...ALL_STATES]
      .map((s) => ({ id: s.id, ev: s.electoralVotes, cost: s.baseCampaignCost, eff: s.electoralVotes / s.baseCampaignCost, mega: MEGASTATE_IDS.has(s.id) }))
      .sort((a, b) => b.eff - a.eff);
    P('');
    P(`Most efficient: ${effRows.slice(0, 6).map((r) => `${r.id} ${r.eff.toFixed(2)}`).join(', ')}`);
    P(`Megastates: ${effRows.filter((r) => r.mega).map((r) => `${r.id} ${r.eff.toFixed(2)}`).join(', ')}`);
    P(`Least efficient: ${effRows.slice(-6).map((r) => `${r.id} ${r.eff.toFixed(2)}`).join(', ')}`);
    P('');

    // ── write outputs ────────────────────────────────────────────────────────────
    const outDir = join(process.cwd(), 'sim-output');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'economy-sim-findings.md'), lines.join('\n'));
    writeFileSync(join(outDir, 'results.json'), JSON.stringify(raw, null, 2));
    // eslint-disable-next-line no-console
    console.log(`\n${lines.join('\n')}\n\n✓ wrote sim-output/economy-sim-findings.md`);

    expect(overall[0].wr).toBeGreaterThan(0);
  },
  1_800_000, // one-shot manual run; generous so a big N never times out
);
