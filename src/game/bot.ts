/**
 * bot.ts — the AI opponent's brain (single-player "vs Bot" mode).
 *
 * planBotTurn() is a PURE function over GameState: given a bot seat and a
 * difficulty, it returns the list of moves (target + rung count) the bot wants
 * to buy this turn. The driver (useBotDriver) applies each move through the
 * normal store `allocate` action, so bots ride the exact same rules, costs, and
 * validation as a human — there is no separate resolution path.
 *
 * Because it's pure and rng is injectable, the whole AI is unit-testable in
 * isolation (see bot.test.ts), mirroring the engine.ts pattern.
 *
 * Difficulty tiers:
 *   easy   — random legal moves, spends nearly all cash, ignores tactics.
 *   medium — greedy value (EV per $) with affinity awareness; builds leads.
 *   hard   — adds coalition-dominance pushes, denial of the leader's states,
 *            securing, deeper sprints, and a late-game cash reserve.
 */

import {
  bestAffinityForState,
  calcStateCost,
  calcNationalCost,
  computeWalletSplit,
  maxBuyableThisTurn,
} from './engine';
import { ALL_STATES } from './statesData';
import { STATE_GROUPS, STATE_GROUPS_BY_STATE, NATIONAL_GROUPS } from './config';
import type { BotDifficulty, GameState, PlayerState } from './types';

export interface BotMove {
  kind: 'state' | 'national';
  targetId: string;
  rungs: number;
}

const STATE_BY_ID = Object.fromEntries(ALL_STATES.map((s) => [s.id, s]));

// Difficulty knobs. easy is handled by a dedicated random path.
interface Knobs {
  reserveFrac: number;   // fraction of total funds to keep unspent
  depth: number;         // max rungs to sprint into a single top target
  secureBonus: number;   // value multiplier for reaching a state's max (securing)
  dominanceBonus: number;// value boost for states inside a near-dominated group
  denialBonus: number;   // value boost for contesting the leader's states
  nationalChance: number;// chance to also invest in a national ladder
}

const KNOBS: Record<'medium' | 'hard', Knobs> = {
  medium: { reserveFrac: 0.05, depth: 2, secureBonus: 0.5, dominanceBonus: 0.0, denialBonus: 0.0, nationalChance: 0.3 },
  hard:   { reserveFrac: 0.15, depth: 3, secureBonus: 1.0, dominanceBonus: 1.5, denialBonus: 0.8, nationalChance: 0.25 },
};

/** Running wallet/pending simulation so the plan stays affordable and legal. */
interface Sim {
  player: PlayerState;        // a working clone (wallets mutate)
  pending: Record<string, number>;
}

function makeSim(player: PlayerState): Sim {
  return {
    player: { ...player, groupWallets: { ...player.groupWallets } },
    pending: {},
  };
}

function totalFunds(p: PlayerState): number {
  return p.nationalCash + Object.values(p.groupWallets).reduce((a, b) => a + b, 0);
}

/**
 * Try to commit a state purchase of up to `wantRungs` into the sim. Honors the
 * entry gatekeeper cap and affordability (earmarked wallets then national cash).
 * Returns the committed move (rungs may be reduced) or null if nothing fit.
 */
function commitState(sim: Sim, state: GameState, stateId: string, wantRungs: number): BotMove | null {
  const us = STATE_BY_ID[stateId];
  if (!us) return null;
  if (state.securedBy[stateId]) return null; // locked — pointless

  const startRung = state.rungs[stateId]?.[sim.player.id] ?? 0;
  const pending = sim.pending[stateId] ?? 0;
  const cap = maxBuyableThisTurn(startRung, us.maxRungs);
  const room = Math.min(cap - pending, us.maxRungs - startRung - pending);
  const rungs = Math.min(wantRungs, room);
  if (rungs <= 0) return null;

  const discount = bestAffinityForState(sim.player, stateId);
  const cost = calcStateCost(stateId, us.baseCampaignCost, startRung + pending, rungs, discount);
  const split = computeWalletSplit(sim.player, stateId, cost);
  if (!split) return null; // unaffordable

  for (const d of split.walletDraw) {
    if (d.wallet === 'NATIONAL') sim.player.nationalCash -= d.amount;
    else sim.player.groupWallets[d.wallet] = (sim.player.groupWallets[d.wallet] ?? 0) - d.amount;
  }
  sim.pending[stateId] = pending + rungs;
  return { kind: 'state', targetId: stateId, rungs };
}

function commitNational(sim: Sim, state: GameState, groupId: string, wantRungs: number): BotMove | null {
  const g = NATIONAL_GROUPS.find((x) => x.id === groupId);
  if (!g) return null;
  if (state.natSecuredBy[groupId]) return null;

  const startRung = state.natRungs[groupId]?.[sim.player.id] ?? 0;
  const pending = sim.pending[groupId] ?? 0;
  const cap = maxBuyableThisTurn(startRung, g.maxRungs);
  const room = Math.min(cap - pending, g.maxRungs - startRung - pending);
  const rungs = Math.min(wantRungs, room);
  if (rungs <= 0) return null;

  const cost = calcNationalCost(groupId, startRung + pending, rungs, sim.player);
  if (cost > sim.player.nationalCash) return null;
  sim.player.nationalCash -= cost;
  sim.pending[groupId] = pending + rungs;
  return { kind: 'national', targetId: groupId, rungs };
}

// ── Scoring (medium / hard) ────────────────────────────────────────────────────

function opponentMaxRungs(state: GameState, stateId: string, selfId: string): { max: number; leaderId: string | null } {
  let max = 0;
  let leaderId: string | null = null;
  const board = state.rungs[stateId] ?? {};
  for (const [pid, r] of Object.entries(board)) {
    if (pid === selfId) continue;
    if (r > max) { max = r; leaderId = pid; }
  }
  return { max, leaderId };
}

/** Groups where this bot is within striking distance of >50% EV control. */
function nearDominanceGroups(state: GameState, selfId: string): Set<string> {
  const near = new Set<string>();
  for (const g of STATE_GROUPS) {
    let myEv = 0;
    for (const sid of g.members) {
      const myR = state.rungs[sid]?.[selfId] ?? 0;
      const { max } = opponentMaxRungs(state, sid, selfId);
      if (myR >= 3 && myR >= max) myEv += STATE_BY_ID[sid]?.electoralVotes ?? 0;
    }
    // "near" = already holding 30%..just-under/over the 50% line — worth pushing.
    if (myEv >= g.totalEV * 0.3) near.add(g.id);
  }
  return near;
}

function scoreState(state: GameState, sim: Sim, stateId: string, k: Knobs, nearGroups: Set<string>): number {
  const us = STATE_BY_ID[stateId];
  if (!us || state.securedBy[stateId]) return -Infinity;

  const myRungs = (state.rungs[stateId]?.[sim.player.id] ?? 0) + (sim.pending[stateId] ?? 0);
  if (myRungs >= us.maxRungs) return -Infinity;

  const { max: oppMax, leaderId } = opponentMaxRungs(state, stateId, sim.player.id);
  const discount = bestAffinityForState(sim.player, stateId);
  const nextCost = calcStateCost(stateId, us.baseCampaignCost, myRungs, 1, discount) || 1;

  let value = us.electoralVotes;
  // Taking or holding the lead is the point — buying past the current leader.
  if (myRungs + 1 > oppMax) value += us.electoralVotes * 0.8;
  // Securing (reaching the top) locks the EV permanently.
  if (myRungs + 1 >= us.maxRungs) value += us.electoralVotes * k.secureBonus;
  // Push coalitions we can plausibly dominate.
  if (k.dominanceBonus > 0) {
    const groups = STATE_GROUPS_BY_STATE[stateId] ?? [];
    if (groups.some((g) => nearGroups.has(g))) value += us.electoralVotes * k.dominanceBonus;
  }
  // Deny the current human/opponent leader on valuable turf.
  if (k.denialBonus > 0 && leaderId && oppMax > myRungs) {
    value += us.electoralVotes * k.denialBonus;
  }

  return value / nextCost; // value per $
}

// ── Public entry ────────────────────────────────────────────────────────────────

/**
 * Plan one bot turn. Returns consolidated moves (one entry per target). Always
 * legal/affordable for the given state — the driver still re-validates via the
 * store, so a stale plan degrades gracefully rather than erroring.
 */
export function planBotTurn(
  state: GameState,
  playerId: string,
  difficulty: BotDifficulty,
  rng: () => number = Math.random,
): BotMove[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return [];

  const sim = makeSim(player);
  const moves: BotMove[] = [];

  if (difficulty === 'easy') {
    planEasy(state, sim, moves, rng);
  } else {
    planSmart(state, sim, moves, KNOBS[difficulty], rng);
  }

  // Consolidate per target (driver applies one allocate per entry).
  const merged = new Map<string, BotMove>();
  for (const m of moves) {
    const key = `${m.kind}:${m.targetId}`;
    const ex = merged.get(key);
    if (ex) ex.rungs += m.rungs;
    else merged.set(key, { ...m });
  }
  return [...merged.values()];
}

function planEasy(state: GameState, sim: Sim, moves: BotMove[], rng: () => number): void {
  // Shuffle all non-secured states and buy a single rung in each until broke.
  const pool = ALL_STATES.filter((s) => !state.securedBy[s.id]).map((s) => s.id);
  shuffle(pool, rng);
  // A couple of passes so it keeps spending while it has cash.
  for (let pass = 0; pass < 3; pass++) {
    let spentThisPass = false;
    for (const sid of pool) {
      if (totalFunds(sim.player) < 5) return;
      const mv = commitState(sim, state, sid, 1);
      if (mv) { moves.push(mv); spentThisPass = true; }
    }
    if (!spentThisPass) return;
  }
}

function planSmart(state: GameState, sim: Sim, moves: BotMove[], k: Knobs, rng: () => number): void {
  const reserve = totalFunds(sim.player) * k.reserveFrac;
  const nearGroups = k.dominanceBonus > 0 ? nearDominanceGroups(state, sim.player.id) : new Set<string>();

  // Optional: invest in a national ladder for flexible income.
  if (rng() < k.nationalChance) {
    const ladder = [...NATIONAL_GROUPS]
      .filter((g) => !state.natSecuredBy[g.id])
      .sort((a, b) => b.turnBonus - a.turnBonus)[0];
    if (ladder) {
      const mv = commitNational(sim, state, ladder.id, 2);
      if (mv) moves.push(mv);
    }
  }

  // Greedy: re-score each pass (costs/leads shift as we commit) and buy the best.
  for (let iter = 0; iter < 40; iter++) {
    if (totalFunds(sim.player) <= reserve) break;

    let best: { id: string; score: number } | null = null;
    for (const s of ALL_STATES) {
      const sc = scoreState(state, sim, s.id, k, nearGroups);
      if (sc === -Infinity) continue;
      if (!best || sc > best.score) best = { id: s.id, score: sc };
    }
    if (!best) break;

    const mv = commitState(sim, state, best.id, k.depth);
    if (!mv) {
      // Couldn't afford the top pick at depth — try a single rung, else stop.
      const one = commitState(sim, state, best.id, 1);
      if (!one) break;
      moves.push(one);
    } else {
      moves.push(mv);
    }
  }
}

/** In-place Fisher–Yates using the injected rng (deterministic in tests). */
function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
