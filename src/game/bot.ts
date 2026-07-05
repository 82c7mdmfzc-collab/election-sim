/**
 * bot.ts — computer opponent planning (Solo mode).
 *
 * planBotTurn() is a PURE function over GameState: given a bot seat and a
 * difficulty, it returns the list of moves (target + rung count) the bot wants
 * to buy this turn. The driver (useBotDriver) applies each move through the
 * normal store `allocate` action, so computer opponents use the exact same rules, costs, and
 * validation as a human — there is no separate resolution path.
 *
 * Because it's pure and rng is injectable, the whole AI is unit-testable in
 * isolation (see bot.test.ts), mirroring the engine.ts pattern.
 *
 * Difficulty tiers:
 *   easy       — loose legal moves, spends most cash, light perk awareness.
 *   medium     — greedy value (EV per $) with perk and coalition awareness.
 *   hard       — adds aggressive leader denial, coalition breaks, securing,
 *                and pre-election EV pressure.
 *   impossible — legal-only expert pressure: lowest noise, strongest denial,
 *                best EV math, and ruthless pre-election attacks.
 */

import {
  bestAffinityForState,
  calcStateCost,
  calcNationalCost,
  computeWalletSplit,
  groupDominanceProgress,
  maxBuyableThisTurn,
  tallyElectoralVotes,
} from './engine';
import { ALL_STATES } from './statesData';
import {
  STATE_GROUPS,
  STATE_GROUPS_BY_STATE,
  NATIONAL_GROUPS,
  NATIONAL_BONUS_MIN_RUNGS,
  minRungsForDominance,
  WIN_THRESHOLD,
} from './config';
import type { BotDifficulty, GameState, PendingPurchase, PlayerState } from './types';

export interface BotMove {
  kind: 'state' | 'national';
  targetId: string;
  rungs: number;
}

const STATE_BY_ID = Object.fromEntries(ALL_STATES.map((s) => [s.id, s]));

// Difficulty knobs. easy is handled by a dedicated random path.
interface Knobs {
  reserveFrac: number;      // fraction of total funds to keep unspent; stays tiny because bots play to win
  depth: number;            // max rungs to sprint into a single top target
  secureBonus: number;      // value multiplier for reaching a state's max (securing)
  dominanceBonus: number;   // value boost for states that create/preserve dominance
  denialBonus: number;      // value boost for contesting the leader's states
  swingBonus: number;       // value boost for EVs that swing from another player
  perkBonus: number;        // value boost for groups matching candidate perks
  attackBonus: number;      // value boost for breaking opponent EV/income engines
  preElectionEVBonus: number;// extra EV urgency the round before elections open
  clashPenalty: number;     // score multiplier when a visible pending clash is likely
  nationalChance: number;   // chance to also invest in a national ladder
  jitter: number;           // random noise; higher = less reliable play
}

const KNOBS: Record<'medium' | 'hard' | 'impossible', Knobs> = {
  medium: {
    reserveFrac: 0.01,
    depth: 1,
    secureBonus: 0.7,
    dominanceBonus: 0.35,
    denialBonus: 0.15,
    swingBonus: 0.35,
    perkBonus: 0.45,
    attackBonus: 0.2,
    preElectionEVBonus: 0.55,
    clashPenalty: 0.75,
    nationalChance: 0.3,
    jitter: 0.08,
  },
  hard: {
    reserveFrac: 0.005,
    depth: 3,
    secureBonus: 1.25,
    dominanceBonus: 1.2,
    denialBonus: 1.25,
    swingBonus: 1.25,
    perkBonus: 0.9,
    attackBonus: 1.1,
    preElectionEVBonus: 1.65,
    clashPenalty: 0.08,
    nationalChance: 0.34,
    jitter: 0.025,
  },
  impossible: {
    reserveFrac: 0,
    depth: 4,
    secureBonus: 1.75,
    dominanceBonus: 1.65,
    denialBonus: 1.85,
    swingBonus: 1.8,
    perkBonus: 1.25,
    attackBonus: 1.65,
    preElectionEVBonus: 2.35,
    clashPenalty: 0.02,
    nationalChance: 0.42,
    jitter: 0.005,
  },
};

const ELECTION_START_TURN = 10;

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

function perkFit(player: PlayerState, groupId: string): number {
  const affinity = player.affinities[groupId] ?? 0;
  const payout = player.payoutModifiers[groupId] ?? 0;
  return affinity + payout * 0.85;
}

function perkDrag(player: PlayerState, groupId: string): number {
  return Math.max(0, -perkFit(player, groupId));
}

function statePerkProfile(player: PlayerState, stateId: string): {
  positive: number;
  negative: number;
  net: number;
  mostlyBad: boolean;
} {
  const groups = STATE_GROUPS_BY_STATE[stateId] ?? [];
  let positive = 0;
  let negative = 0;
  for (const gid of groups) {
    const fit = perkFit(player, gid);
    if (fit >= 0) positive += fit;
    else negative += -fit;
  }
  return {
    positive,
    negative,
    net: positive - negative,
    mostlyBad: negative > 0 && negative > positive * 1.25,
  };
}

function isPreElectionTurn(state: GameState): boolean {
  return state.turn === ELECTION_START_TURN - 1;
}

function topOpponentEv(state: GameState, selfId: string): { id: string | null; ev: number } {
  const election = tallyElectoralVotes(state);
  let id: string | null = null;
  let ev = 0;
  for (const p of state.players.filter((x) => !x.eliminated && x.id !== selfId)) {
    const cur = election.evByPlayer[p.id] ?? 0;
    if (cur > ev) { id = p.id; ev = cur; }
  }
  return { id, ev };
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
  const cap = maxBuyableThisTurn(startRung, us.maxRungs, state.modifiers);
  const room = Math.min(cap - pending, us.maxRungs - startRung - pending);
  const rungs = Math.min(wantRungs, room);
  if (rungs <= 0) return null;

  const discount = bestAffinityForState(sim.player, stateId);
  const cost = calcStateCost(stateId, us.baseCampaignCost, startRung + pending, rungs, discount, state.modifiers);
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
  const cap = maxBuyableThisTurn(startRung, g.maxRungs, state.modifiers);
  const room = Math.min(cap - pending, g.maxRungs - startRung - pending);
  const rungs = Math.min(wantRungs, room);
  if (rungs <= 0) return null;

  const cost = calcNationalCost(groupId, startRung + pending, rungs, sim.player);
  if (cost > sim.player.nationalCash) return null;
  sim.player.nationalCash -= cost;
  sim.pending[groupId] = pending + rungs;
  return { kind: 'national', targetId: groupId, rungs };
}

function chooseStateRungs(state: GameState, sim: Sim, stateId: string, preferred: number): number {
  const us = STATE_BY_ID[stateId];
  if (!us) return 0;
  const startRung = state.rungs[stateId]?.[sim.player.id] ?? 0;
  const pending = sim.pending[stateId] ?? 0;
  const room = Math.min(
    maxBuyableThisTurn(startRung, us.maxRungs, state.modifiers) - pending,
    us.maxRungs - startRung - pending,
  );
  if (room <= 0) return 0;

  const rungs = Math.min(preferred, room);
  const endRung = startRung + pending + rungs;
  if (!wouldMatchVisiblePending(state, sim.player.id, 'state', stateId, endRung)) return rungs;

  if (rungs < room && !wouldMatchVisiblePending(state, sim.player.id, 'state', stateId, endRung + 1)) {
    return rungs + 1;
  }
  if (rungs > 1 && !wouldMatchVisiblePending(state, sim.player.id, 'state', stateId, endRung - 1)) {
    return rungs - 1;
  }
  return rungs;
}

function affordableStateRungs(state: GameState, sim: Sim, stateId: string, preferred: number): number {
  const us = STATE_BY_ID[stateId];
  if (!us) return 0;
  const startRung = state.rungs[stateId]?.[sim.player.id] ?? 0;
  const pending = sim.pending[stateId] ?? 0;
  const discount = bestAffinityForState(sim.player, stateId);
  for (let r = chooseStateRungs(state, sim, stateId, preferred); r >= 1; r--) {
    const cost = calcStateCost(stateId, us.baseCampaignCost, startRung + pending, r, discount, state.modifiers);
    if (computeWalletSplit(sim.player, stateId, cost)) return r;
  }
  return 0;
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

function stateLeader(state: GameState, stateId: string): string | null {
  let leader: string | null = null;
  let leaderRungs = 0;
  let leaderSeq = Infinity;
  for (const p of state.players.filter((x) => !x.eliminated)) {
    const r = state.rungs[stateId]?.[p.id] ?? 0;
    const seq = state.reachSeq[stateId]?.[p.id] ?? 0;
    if (r > leaderRungs || (r === leaderRungs && r > 0 && seq < leaderSeq)) {
      leader = p.id;
      leaderRungs = r;
      leaderSeq = seq;
    }
  }
  return leader;
}

function pendingByOtherPlayers(
  state: GameState,
  selfId: string,
  kind: 'state' | 'national',
  targetId: string,
): PendingPurchase[] {
  const pendingByPlayer = (state as GameState & { pendingByPlayer?: Record<string, PendingPurchase[]> }).pendingByPlayer;
  if (!pendingByPlayer) return [];
  return Object.entries(pendingByPlayer)
    .filter(([pid]) => pid !== selfId)
    .flatMap(([, purchases]) => purchases.filter((p) => p.kind === kind && p.targetId === targetId));
}

function wouldMatchVisiblePending(
  state: GameState,
  selfId: string,
  kind: 'state' | 'national',
  targetId: string,
  endRung: number,
): boolean {
  const grouped: Record<string, number> = {};
  for (const p of pendingByOtherPlayers(state, selfId, kind, targetId)) {
    grouped[p.targetId] = (grouped[p.targetId] ?? 0) + p.rungs;
  }
  if (!grouped[targetId]) return false;

  const playerIds = Object.keys(
    kind === 'state'
      ? (state.rungs[targetId] ?? {})
      : (state.natRungs[targetId] ?? {}),
  );
  for (const pid of playerIds) {
    if (pid === selfId) continue;
    const base = kind === 'state'
      ? (state.rungs[targetId]?.[pid] ?? 0)
      : (state.natRungs[targetId]?.[pid] ?? 0);
    const pending = pendingByOtherPlayers(state, selfId, kind, targetId)
      .filter((p) => {
        const playerPending = (state as GameState & { pendingByPlayer?: Record<string, PendingPurchase[]> }).pendingByPlayer;
        return playerPending?.[pid]?.includes(p) ?? false;
      })
      .reduce((sum, p) => sum + p.rungs, 0);
    if (pending > 0 && base + pending === endRung) return true;
  }
  return false;
}

/** Groups where this bot can plausibly claim or preserve >50% EV control. */
function dominancePressureByState(state: GameState, player: PlayerState): Record<string, number> {
  const pressure: Record<string, number> = {};
  for (const g of STATE_GROUPS) {
    let myEv = 0;
    let contestedEv = 0;
    for (const sid of g.members) {
      const us = STATE_BY_ID[sid];
      if (!us) continue;
      const myR = state.rungs[sid]?.[player.id] ?? 0;
      const { max } = opponentMaxRungs(state, sid, player.id);
      const threshold = minRungsForDominance(sid, us.electoralVotes);
      if (myR >= threshold && myR >= max) myEv += us.electoralVotes;
      else if (myR + 2 >= threshold) contestedEv += us.electoralVotes;
    }
    const gap = g.totalEV / 2 - myEv;
    if (gap <= contestedEv && myEv + contestedEv > g.totalEV * 0.35) {
      const payoutScale = Math.max(0.35, 1 + (player.payoutModifiers[g.id] ?? 0) + perkFit(player, g.id) * 0.6);
      for (const sid of g.members) {
        const us = STATE_BY_ID[sid];
        if (!us) continue;
        const basePressure = Math.max(0.25, 1 - Math.max(0, gap) / Math.max(1, g.totalEV / 2));
        pressure[sid] = (pressure[sid] ?? 0) + basePressure * payoutScale;
      }
    }
  }
  return pressure;
}

function coalitionBreakPressure(state: GameState, selfId: string, stateId: string): number {
  const groups = STATE_GROUPS_BY_STATE[stateId] ?? [];
  let pressure = 0;
  for (const gid of groups) {
    const group = STATE_GROUPS.find((g) => g.id === gid);
    if (!group) continue;
    const dom = state.stateGroupDominance[gid];
    if (!dom || dom === selfId) continue;

    const progress = groupDominanceProgress(group, state.rungs, state.reachSeq, state.players);
    const opponentEv = progress.evByPlayer[dom] ?? 0;
    const stateEv = STATE_BY_ID[stateId]?.electoralVotes ?? 0;
    const canBreak = opponentEv > progress.threshold && opponentEv - stateEv <= progress.threshold;
    const opponent = state.players.find((p) => p.id === dom);
    const wallet = opponent?.groupWallets[gid] ?? 0;
    const engineValue = group.bonusPayout + wallet * 0.25;
    pressure += canBreak ? engineValue / 75 : engineValue / 220;
  }
  return pressure;
}

function scoreState(
  state: GameState,
  sim: Sim,
  stateId: string,
  k: Knobs,
  dominancePressure: Record<string, number>,
  opponentLeader: { id: string | null; ev: number },
  perkProfiles: Record<string, ReturnType<typeof statePerkProfile>>,
  rng: () => number,
): number {
  const us = STATE_BY_ID[stateId];
  if (!us || state.securedBy[stateId]) return -Infinity;

  const myRungs = (state.rungs[stateId]?.[sim.player.id] ?? 0) + (sim.pending[stateId] ?? 0);
  if (myRungs >= us.maxRungs) return -Infinity;

  const { max: oppMax, leaderId } = opponentMaxRungs(state, stateId, sim.player.id);
  const leader = stateLeader(state, stateId);
  const discount = bestAffinityForState(sim.player, stateId);
  const plannedRungs = affordableStateRungs(state, sim, stateId, k.depth);
  if (plannedRungs <= 0) return -Infinity;
  const endRung = myRungs + plannedRungs;
  const plannedCost = calcStateCost(stateId, us.baseCampaignCost, myRungs, plannedRungs, discount, state.modifiers) || 1;

  const preElection = isPreElectionTurn(state);
  const leaderPressure = opponentLeader.ev >= WIN_THRESHOLD - 80 ? 1.45 : opponentLeader.ev >= WIN_THRESHOLD - 130 ? 1.2 : 1;
  const perks = perkProfiles[stateId] ?? statePerkProfile(sim.player, stateId);
  let value = us.electoralVotes * (leader === sim.player.id ? 0.35 : 1);
  // Taking or holding the lead is the point — buying past the current leader.
  if (leader !== sim.player.id && endRung > oppMax) value += us.electoralVotes * 0.8;
  else if (leader === sim.player.id && endRung > oppMax) value += us.electoralVotes * 0.12;
  // EVs that move from another player to us are worth roughly double in a close race.
  if (leader && leader !== sim.player.id && endRung > oppMax) {
    value += us.electoralVotes * k.swingBonus * leaderPressure;
    if (leader === opponentLeader.id) value += us.electoralVotes * k.attackBonus * leaderPressure;
  }
  if (preElection) value += us.electoralVotes * k.preElectionEVBonus * (leader === sim.player.id ? 0.4 : 1);
  // Securing (reaching the top) locks the EV permanently.
  if (endRung >= us.maxRungs) value += us.electoralVotes * k.secureBonus;
  // Push coalitions we can plausibly dominate or must defend.
  value += us.electoralVotes * (dominancePressure[stateId] ?? 0) * k.dominanceBonus;
  value += us.electoralVotes * coalitionBreakPressure(state, sim.player.id, stateId) * k.attackBonus;
  // Deny the current opponent leader on valuable turf.
  if (k.denialBonus > 0 && leaderId && oppMax > myRungs) {
    value += us.electoralVotes * k.denialBonus * (leaderId === opponentLeader.id ? leaderPressure : 1);
  }
  if (STATE_GROUPS_BY_STATE[stateId]?.length) {
    value += STATE_GROUPS_BY_STATE[stateId].length * 0.2;
    value += us.electoralVotes * perks.positive * k.perkBonus * 1.25;

    const tacticalRelief =
      (preElection ? 0.45 : 0)
      + (leader && leader !== sim.player.id && endRung > oppMax ? 0.35 : 0)
      + (leaderId && oppMax > myRungs ? 0.2 : 0);
    const penaltyScale = Math.max(0.25, 1.05 - tacticalRelief);
    value -= us.electoralVotes * perks.negative * k.perkBonus * penaltyScale;
    if (perks.mostlyBad && tacticalRelief < 0.55) {
      value *= Math.max(0.35, 1 - perks.negative * k.perkBonus * 0.8);
    }
  }

  const visibleClash = wouldMatchVisiblePending(
    state,
    sim.player.id,
    'state',
    stateId,
    endRung,
  );
  if (visibleClash) value *= k.clashPenalty;

  const noise = 1 + (rng() - 0.5) * k.jitter;

  return (value * noise) / plannedCost; // value per $
}

function scoreNational(state: GameState, sim: Sim, groupId: string, k: Knobs): number {
  const g = NATIONAL_GROUPS.find((x) => x.id === groupId);
  if (!g || state.natSecuredBy[groupId]) return -Infinity;

  const startRung = (state.natRungs[groupId]?.[sim.player.id] ?? 0) + (sim.pending[groupId] ?? 0);
  if (startRung >= g.maxRungs) return -Infinity;

  const cost = calcNationalCost(groupId, startRung, 1, sim.player);
  if (cost > sim.player.nationalCash) return -Infinity;

  const fit = perkFit(sim.player, groupId);
  const incomeHorizon = Math.max(2, ELECTION_START_TURN - state.turn + 4);
  const payout = g.turnBonus * Math.max(0.2, 1 + (sim.player.payoutModifiers[groupId] ?? 0));
  const progress =
    startRung >= NATIONAL_BONUS_MIN_RUNGS ? 1.25
      : startRung + 2 >= NATIONAL_BONUS_MIN_RUNGS ? 1.45
        : 0.95;
  const signatureValue = Math.max(0, fit) * 95 * Math.max(0.6, k.perkBonus);
  const drag = perkDrag(sim.player, groupId) * 120 * Math.max(0.6, k.perkBonus);
  const value = payout * progress * (incomeHorizon / 5) + signatureValue + startRung * 6 - drag;

  return value / Math.max(1, cost);
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
  // Loose but no longer idle: it spends most cash, with a small tilt toward
  // candidate perks but little tactical awareness.
  if (rng() < 0.18 && !isPreElectionTurn(state)) {
    const ladders = NATIONAL_GROUPS
      .filter((g) => !state.natSecuredBy[g.id])
      .sort((a, b) => perkFit(sim.player, b.id) - perkFit(sim.player, a.id));
    if (rng() < 0.45) shuffle(ladders, rng);
    const mv = ladders[0] ? commitNational(sim, state, ladders[0].id, 1) : null;
    if (mv) moves.push(mv);
  }

  const spendFloor = totalFunds(sim.player) * (0.12 + rng() * 0.14);
  const pool = ALL_STATES
    .filter((s) => !state.securedBy[s.id])
    .map((s) => ({
      id: s.id,
      weight: s.electoralVotes + (STATE_GROUPS_BY_STATE[s.id] ?? []).reduce((sum, gid) => sum + perkFit(sim.player, gid) * 18, 0),
    }))
    .sort((a, b) => b.weight - a.weight)
    .map((s) => s.id);
  shuffle(pool, rng);
  for (let pass = 0; pass < 3; pass++) {
    let spentThisPass = false;
    for (const sid of pool) {
      if (totalFunds(sim.player) <= spendFloor) return;
      if (rng() < 0.28) continue;
      const mv = commitState(sim, state, sid, 1);
      if (mv) { moves.push(mv); spentThisPass = true; }
    }
    if (!spentThisPass) return;
  }
}

function planSmart(state: GameState, sim: Sim, moves: BotMove[], k: Knobs, rng: () => number): void {
  const electionPressure = state.turn >= ELECTION_START_TURN - 1 ? Math.max(0, state.turn - 9) * 0.01 : 0;
  const reserve = totalFunds(sim.player) * Math.max(0, k.reserveFrac - electionPressure);
  const dominancePressure = dominancePressureByState(state, sim.player);
  const opponentLeader = topOpponentEv(state, sim.player.id);
  const perkProfiles = Object.fromEntries(ALL_STATES.map((s) => [s.id, statePerkProfile(sim.player, s.id)]));
  const preElection = isPreElectionTurn(state);

  // Optional: invest in a national ladder for flexible income, weighted by net
  // payout and candidate perks rather than picking the same ladder every time.
  if (!preElection && rng() < k.nationalChance && state.turn <= ELECTION_START_TURN) {
    const ladders = [...NATIONAL_GROUPS]
      .filter((g) => !state.natSecuredBy[g.id])
      .map((g) => ({ id: g.id, score: scoreNational(state, sim, g.id, k) }))
      .filter((g) => g.score !== -Infinity)
      .sort((a, b) => b.score - a.score);
    for (const ladder of ladders) {
      const mv = commitNational(sim, state, ladder.id, 2);
      if (mv) {
        moves.push(mv);
        break;
      }
    }
  }

  // Greedy: re-score each pass (costs/leads shift as we commit) and buy the best.
  for (let iter = 0; iter < 40; iter++) {
    if (totalFunds(sim.player) <= reserve) break;

    let best: { id: string; score: number } | null = null;
    for (const s of ALL_STATES) {
      const sc = scoreState(state, sim, s.id, k, dominancePressure, opponentLeader, perkProfiles, rng);
      if (sc === -Infinity) continue;
      if (!best || sc > best.score) best = { id: s.id, score: sc };
    }
    if (!best) break;

    const desiredRungs = chooseStateRungs(state, sim, best.id, k.depth);
    const mv = commitState(sim, state, best.id, desiredRungs);
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
