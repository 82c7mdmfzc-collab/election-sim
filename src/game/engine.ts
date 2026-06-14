/**
 * Pure game engine — no React, no side effects, no I/O.
 *
 * All functions are deterministic except resolveTurn / rollElection which
 * accept an injectable rng: () => number (defaults to Math.random).
 * This makes the engine fully testable and server-authoritative.
 *
 * Turn resolution order:
 *   1. Snapshot start-of-turn rung counts (for clash revert).
 *   2. Apply all players' purchases (rung increments + reachSeq stamps).
 *   3. Clash Revert: ≥2 players hit max rung in the same turn → cash forfeit,
 *      rungs reverted, securedBy stays null. Third players unaffected.
 *   4. Single max-rung reacher → securedBy[target] = playerId.
 *   5. recomputeDominance (3-rung gate + evaporation).
 *   6. payTurnIncome (national flat + group wallets + national-group bonuses).
 */

import {
  STATE_GROUPS,
  STATE_GROUPS_BY_STATE,
  NATIONAL_GROUPS,
  NATIONAL_GROUP_MAP,
  NATIONAL_INCOME,
  WIN_THRESHOLD,
  electionProbability,
  maxRungsFor,
  minRungsForDominance,
  rungCostFor,
} from './config';
import { ALL_STATES } from './statesData';
import type {
  ElectoralResult,
  GameState,
  NatRungMap,
  NatReachSeq,
  PendingPurchase,
  PlayerState,
  RungMap,
  ReachSeq,
  StateGroup,
  TurnReport,
  WalletDraw,
} from './types';

// ── Deep-clone helpers ────────────────────────────────────────────────────────

function cloneRungMap(m: RungMap): RungMap {
  const out: RungMap = {};
  for (const k of Object.keys(m)) out[k] = { ...m[k] };
  return out;
}
function cloneNatRungMap(m: NatRungMap): NatRungMap {
  const out: NatRungMap = {};
  for (const k of Object.keys(m)) out[k] = { ...m[k] };
  return out;
}
function cloneSeq(m: ReachSeq): ReachSeq {
  const out: ReachSeq = {};
  for (const k of Object.keys(m)) out[k] = { ...m[k] };
  return out;
}
function cloneNatSeq(m: NatReachSeq): NatReachSeq {
  const out: NatReachSeq = {};
  for (const k of Object.keys(m)) out[k] = { ...m[k] };
  return out;
}
function clonePlayers(ps: PlayerState[]): PlayerState[] {
  return ps.map((p) => ({ ...p, groupWallets: { ...p.groupWallets } }));
}

// ── Cost calculation ──────────────────────────────────────────────────────────

/**
 * Compute the best affinity discount a player has for a geographic state,
 * looking across all State Groups the state belongs to.
 */
export function bestAffinityForState(
  player: PlayerState,
  stateId: string,
): number {
  const groups = STATE_GROUPS_BY_STATE[stateId] ?? [];
  if (groups.length === 0) return 0;
  // Most-favorable modifier across the state's groups. Member-groups the player
  // has no entry for count as 0 (neutral), so a cost penalty only bites when
  // EVERY group the state belongs to is penalised for this player.
  let best = -Infinity;
  for (const gid of groups) {
    const a = player.affinities[gid] ?? 0;
    if (a > best) best = a;
  }
  return best === -Infinity ? 0 : best;
}

/**
 * Total cost to buy `rungs` consecutive rungs in a geographic state,
 * starting at `startRung` (0-based; first rung to buy is startRung+1).
 */
export function calcStateCost(
  stateId: string,
  baseCampaignCost: number,
  startRung: number,
  rungsToBuy: number,
  affinityDiscount: number,
): number {
  let total = 0;
  for (let i = 1; i <= rungsToBuy; i++) {
    const rungIndex = startRung + i; // 1-based
    total += rungCostFor(stateId, baseCampaignCost, rungIndex, affinityDiscount);
  }
  return total;
}

/**
 * Total cost to buy `rungs` consecutive rungs in a national group,
 * starting at `startRung`. Cost per rung = group.rungCost (flat).
 * Best affinity across national group ids is applied.
 */
export function calcNationalCost(
  groupId: string,
  _startRung: number,
  rungsToBuy: number,
  player: PlayerState,
): number {
  const g = NATIONAL_GROUP_MAP[groupId];
  if (!g) return Infinity;
  const discount = player.affinities[groupId] ?? 0;
  return g.rungCost * rungsToBuy * (1 - discount);
}

// ── Entry gatekeeper ──────────────────────────────────────────────────────────

/** Max rungs purchasable in a target this turn given start-of-turn count. */
export function maxBuyableThisTurn(startRung: number, maxRungs: number): number {
  if (startRung >= 1) return maxRungs - startRung; // uncapped sprint
  return maxRungs === 16 ? 3 : 2;                  // entry cap
}

// ── Wallet split ──────────────────────────────────────────────────────────────

/**
 * Compute how to split a cost across a player's wallets for a state purchase.
 * Drains matching group wallets in alphabetical order, then nationalCash.
 * Returns null if total funds are insufficient.
 *
 * Does NOT mutate the player — returns draw instructions and remaining balances.
 */
export function computeWalletSplit(
  player: PlayerState,
  stateId: string,
  cost: number,
): { walletDraw: WalletDraw[]; nationalDrain: number } | null {
  const groupIds = STATE_GROUPS_BY_STATE[stateId] ?? []; // already alphabetical
  const walletDraw: WalletDraw[] = [];
  let remaining = cost;

  const tempWallets = { ...player.groupWallets };

  for (const gid of groupIds) {
    if (remaining <= 0) break;
    const available = tempWallets[gid] ?? 0;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    walletDraw.push({ wallet: gid, amount: take });
    tempWallets[gid] -= take;
    remaining -= take;
  }

  if (remaining > player.nationalCash) return null; // insufficient funds

  const nationalDrain = remaining;
  if (nationalDrain > 0) walletDraw.push({ wallet: 'NATIONAL', amount: nationalDrain });

  return { walletDraw, nationalDrain };
}

/** Apply a walletDraw to a player (mutates in place — call on a clone). */
export function applyWalletDraw(player: PlayerState, draw: WalletDraw[]): void {
  for (const d of draw) {
    if (d.wallet === 'NATIONAL') {
      player.nationalCash -= d.amount;
    } else {
      player.groupWallets[d.wallet] = (player.groupWallets[d.wallet] ?? 0) - d.amount;
    }
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationError { reason: string }

/**
 * Validate a proposed purchase against the current game state.
 * Does NOT mutate state. Returns null if valid, error object otherwise.
 *
 * startRungs is the rung count at the *start of the turn* (used for gatekeeper).
 * pendingRungs is additional rungs already queued for this target this turn.
 */
export function validatePurchase(
  player: PlayerState,
  pendingCostTotal: number, // total cost already committed this turn
  params: {
    kind: 'state' | 'national';
    targetId: string;
    rungsToBuy: number;
    startRung: number;      // snapshot from start of turn
    pendingRungs: number;   // rungs already allocated to this target this turn
  },
): ValidationError | null {
  const { kind, targetId, rungsToBuy, startRung, pendingRungs } = params;

  if (rungsToBuy < 1) return { reason: 'Must buy at least 1 rung.' };

  if (kind === 'state') {
    const usState = ALL_STATES.find((s) => s.id === targetId);
    if (!usState) return { reason: `Unknown state: ${targetId}` };
    const maxRungs = usState.maxRungs;
    const cap = maxBuyableThisTurn(startRung, maxRungs);
    const totalAfterBuy = pendingRungs + rungsToBuy;
    if (totalAfterBuy > cap) {
      return { reason: `Entry gatekeeper: can only buy ${cap} rung(s) this turn (already queued ${pendingRungs}).` };
    }
    if (startRung + totalAfterBuy > maxRungs) {
      return { reason: `Exceeds max rungs (${maxRungs}).` };
    }
    const discount = bestAffinityForState(player, targetId);
    const cost = calcStateCost(targetId, usState.baseCampaignCost, startRung + pendingRungs, rungsToBuy, discount);
    const totalCash = player.nationalCash + Object.values(player.groupWallets).reduce((a, b) => a + b, 0);
    if (pendingCostTotal + cost > totalCash) {
      return { reason: 'Insufficient funds.' };
    }
  } else {
    const g = NATIONAL_GROUP_MAP[targetId];
    if (!g) return { reason: `Unknown national group: ${targetId}` };
    const maxRungs = g.maxRungs;
    const cap = maxBuyableThisTurn(startRung, maxRungs);
    const totalAfterBuy = pendingRungs + rungsToBuy;
    if (totalAfterBuy > cap) {
      return { reason: `Entry gatekeeper: can only buy ${cap} rung(s) this turn.` };
    }
    if (startRung + totalAfterBuy > maxRungs) {
      return { reason: `Exceeds max rungs (${maxRungs}).` };
    }
    const cost = calcNationalCost(targetId, startRung + pendingRungs, rungsToBuy, player);
    if (pendingCostTotal + cost > player.nationalCash) {
      return { reason: 'Insufficient national cash (national groups draw from nationalCash only).' };
    }
  }

  return null;
}

// ── Dominance ─────────────────────────────────────────────────────────────────

/**
 * Determine which player leads a state for dominance-tally purposes.
 * A player must have ≥ 3 rungs AND have the highest rung count (tie → lowest reachSeq).
 * Returns null if no player qualifies.
 */
function stateLeaderForDominance(
  stateId: string,
  rungs: RungMap,
  reachSeq: ReachSeq,
  activePlayers: PlayerState[],
): string | null {
  const stateEV = ALL_STATES.find((s) => s.id === stateId)?.electoralVotes ?? 0;
  const minRungs = minRungsForDominance(stateId, stateEV);
  let bestPlayer: string | null = null;
  let bestRungs = minRungs - 1; // must strictly exceed minRungs-1
  let bestSeq = Infinity;

  for (const p of activePlayers) {
    const r = rungs[stateId]?.[p.id] ?? 0;
    if (r < minRungs) continue;
    if (r > bestRungs || (r === bestRungs && (reachSeq[stateId]?.[p.id] ?? 0) < bestSeq)) {
      bestRungs = r;
      bestPlayer = p.id;
      bestSeq = reachSeq[stateId]?.[p.id] ?? 0;
    }
  }
  return bestPlayer;
}

/**
 * Recompute State Group dominance for all groups.
 * Applies the Evaporation Penalty: if a player loses dominance, their wallet → $0.
 * Mutates players in place (call on clones).
 */
export function recomputeDominance(
  rungs: RungMap,
  reachSeq: ReachSeq,
  players: PlayerState[],
  prevDominance: Record<string, string | null>,
): Record<string, string | null> {
  const activePlayers = players.filter((p) => !p.eliminated);
  const newDominance: Record<string, string | null> = {};

  for (const g of STATE_GROUPS) {
    // Count EVs per player (only states where they lead with ≥3 rungs)
    const evCount: Record<string, number> = {};
    for (const p of activePlayers) evCount[p.id] = 0;

    for (const sid of g.members) {
      const leader = stateLeaderForDominance(sid, rungs, reachSeq, activePlayers);
      if (leader) {
        const stateEv = ALL_STATES.find((s) => s.id === sid)?.electoralVotes ?? 0;
        evCount[leader] = (evCount[leader] ?? 0) + stateEv;
      }
    }

    // Dominant player: strictly >50% of group totalEV
    let dominant: string | null = null;
    for (const p of activePlayers) {
      if ((evCount[p.id] ?? 0) > g.totalEV * 0.5) {
        dominant = p.id;
        break;
      }
    }
    newDominance[g.id] = dominant;

    // Evaporation: previous holder who just lost dominance → wallet $0
    const prev = prevDominance[g.id];
    if (prev && prev !== dominant) {
      const loser = players.find((p) => p.id === prev);
      if (loser) loser.groupWallets[g.id] = 0;
    }
  }

  return newDominance;
}

/**
 * Per-player progress toward dominating a single State Group, for UI display.
 * `evByPlayer[id]` = total EV of member states that player currently leads for
 * dominance (≥ min rungs, highest count). A player dominates when their count is
 * strictly greater than `threshold` (= half the group's total EV). Uses the same
 * `stateLeaderForDominance` rule as `recomputeDominance`, so bars match the game.
 */
export function groupDominanceProgress(
  group: StateGroup,
  rungs: RungMap,
  reachSeq: ReachSeq,
  players: PlayerState[],
): { evByPlayer: Record<string, number>; totalEV: number; threshold: number } {
  const activePlayers = players.filter((p) => !p.eliminated);
  const evByPlayer: Record<string, number> = {};
  for (const p of activePlayers) evByPlayer[p.id] = 0;

  for (const sid of group.members) {
    const leader = stateLeaderForDominance(sid, rungs, reachSeq, activePlayers);
    if (leader) {
      const ev = ALL_STATES.find((s) => s.id === sid)?.electoralVotes ?? 0;
      evByPlayer[leader] = (evByPlayer[leader] ?? 0) + ev;
    }
  }

  return { evByPlayer, totalEV: group.totalEV, threshold: group.totalEV * 0.5 };
}

// ── Income ────────────────────────────────────────────────────────────────────

export function payTurnIncome(
  players: PlayerState[],
  dominance: Record<string, string | null>,
  natRungs: NatRungMap,
  natReachSeq: NatReachSeq,
): void {
  const activePlayers = players.filter((p) => !p.eliminated);

  for (const p of activePlayers) {
    p.nationalCash += NATIONAL_INCOME;
  }

  // State group wallet bonuses (scaled by the player's profit modifier)
  for (const g of STATE_GROUPS) {
    const dom = dominance[g.id];
    if (!dom) continue;
    const player = players.find((p) => p.id === dom);
    if (player && !player.eliminated) {
      const payout = Math.round(g.bonusPayout * (1 + (player.payoutModifiers[g.id] ?? 0)));
      player.groupWallets[g.id] = (player.groupWallets[g.id] ?? 0) + payout;
    }
  }

  // National group bonuses (leader with ≥3 rungs)
  for (const g of NATIONAL_GROUPS) {
    let leader: string | null = null;
    let leaderRungs = 2; // must exceed 2 (≥3)
    let leaderSeq = Infinity;

    for (const p of activePlayers) {
      const r = natRungs[g.id]?.[p.id] ?? 0;
      if (r < 3) continue;
      const seq = natReachSeq[g.id]?.[p.id] ?? 0;
      if (r > leaderRungs || (r === leaderRungs && seq < leaderSeq)) {
        leader = p.id;
        leaderRungs = r;
        leaderSeq = seq;
      }
    }

    if (leader) {
      const player = players.find((p) => p.id === leader);
      if (player) {
        const payout = Math.round(g.turnBonus * (1 + (player.payoutModifiers[g.id] ?? 0)));
        player.nationalCash += payout;
      }
    }
  }
}

// ── Electoral tally ───────────────────────────────────────────────────────────

/**
 * Compute each player's EV score.
 * - Secured states → guaranteed EVs.
 * - Unlocked states → highest rung holder (tie → lowest reachSeq), any rung count qualifies.
 * - National groups contribute no EVs.
 * Note: the 3-rung rule only gates State Group dominance, NOT the EV tally.
 */
export function tallyElectoralVotes(state: GameState): ElectoralResult {
  const { players, rungs, reachSeq, securedBy } = state;
  const activePlayers = players.filter((p) => !p.eliminated);

  const evByPlayer: Record<string, number> = {};
  for (const p of activePlayers) evByPlayer[p.id] = 0;

  const stateLeaders: Record<string, string | null> = {};

  for (const usState of ALL_STATES) {
    const sid = usState.id;
    const locked = securedBy[sid];

    if (locked != null && !players.find((p) => p.id === locked)?.eliminated) {
      stateLeaders[sid] = locked;
      evByPlayer[locked] = (evByPlayer[locked] ?? 0) + usState.electoralVotes;
      continue;
    }

    // Find the leader among active players
    let leader: string | null = null;
    let leaderRungs = 0;
    let leaderSeq = Infinity;

    for (const p of activePlayers) {
      const r = rungs[sid]?.[p.id] ?? 0;
      const seq = reachSeq[sid]?.[p.id] ?? 0;
      if (r > leaderRungs || (r === leaderRungs && r > 0 && seq < leaderSeq)) {
        leader = p.id;
        leaderRungs = r;
        leaderSeq = seq;
      }
    }

    stateLeaders[sid] = leader;
    if (leader) evByPlayer[leader] = (evByPlayer[leader] ?? 0) + usState.electoralVotes;
  }

  let winner: string | null = null;
  for (const p of activePlayers) {
    if ((evByPlayer[p.id] ?? 0) >= WIN_THRESHOLD) {
      winner = p.id;
      break;
    }
  }

  return { evByPlayer, stateLeaders, winner };
}

// ── Turn resolution ───────────────────────────────────────────────────────────

/**
 * Simultaneous turn resolution.
 *
 * purchasesByPlayer: Record<playerId, PendingPurchase[]>
 * The wallet draws inside each PendingPurchase have already been computed
 * (by the store during the allocation phase) and are now just applied here.
 *
 * Returns the new authoritative GameState.
 */
export function resolveTurn(
  state: GameState,
  purchasesByPlayer: Record<string, PendingPurchase[]>,
): { state: GameState; report: TurnReport } {
  const clashedStates: string[] = [];
  const clashedNational: string[] = [];
  const newlySecured: TurnReport['newlySecured'] = [];

  const nextPlayers = clonePlayers(state.players);
  const nextRungs = cloneRungMap(state.rungs);
  const nextNatRungs = cloneNatRungMap(state.natRungs);
  const nextReachSeq = cloneSeq(state.reachSeq);
  const nextNatReachSeq = cloneNatSeq(state.natReachSeq);
  const nextSecured = { ...state.securedBy };
  const nextNatSecured = { ...state.natSecuredBy };
  let nextSeq = state.seqCounter;

  // Snapshot start-of-turn rungs for clash detection
  const startStateRungs = cloneRungMap(state.rungs);
  const startNatRungs = cloneNatRungMap(state.natRungs);

  // ── Step 1: Apply wallet draws and rung increments ──────────────────────────
  for (const [playerId, purchases] of Object.entries(purchasesByPlayer)) {
    const player = nextPlayers.find((p) => p.id === playerId);
    if (!player) continue;

    for (const purchase of purchases) {
      // Apply the pre-computed wallet draw
      applyWalletDraw(player, purchase.walletDraw);

      if (purchase.kind === 'state') {
        const sid = purchase.targetId;
        const prev = nextRungs[sid]?.[playerId] ?? 0;
        const next = prev + purchase.rungs;
        if (!nextRungs[sid]) nextRungs[sid] = {};
        nextRungs[sid][playerId] = next;
        nextSeq++;
        if (!nextReachSeq[sid]) nextReachSeq[sid] = {};
        nextReachSeq[sid][playerId] = nextSeq;
      } else {
        const gid = purchase.targetId;
        const prev = nextNatRungs[gid]?.[playerId] ?? 0;
        const next = prev + purchase.rungs;
        if (!nextNatRungs[gid]) nextNatRungs[gid] = {};
        nextNatRungs[gid][playerId] = next;
        nextSeq++;
        if (!nextNatReachSeq[gid]) nextNatReachSeq[gid] = {};
        nextNatReachSeq[gid][playerId] = nextSeq;
      }
    }
  }

  // ── Step 2: Clash detection and revert ─────────────────────────────────────
  // A clash fires when ≥2 players who bought rungs this turn land on the SAME
  // end rung count (e.g. both reach 5/12, or both reach 8/8). Players who end
  // on different rung counts keep their progress. Cash is always forfeit for
  // clashers (no refund — wallet draw already applied). Non-buyers are unaffected.
  for (const usState of ALL_STATES) {
    const sid = usState.id;

    // Players who bought at least 1 rung this turn in this state
    const buyers = nextPlayers.filter((p) => {
      return (nextRungs[sid]?.[p.id] ?? 0) > (startStateRungs[sid]?.[p.id] ?? 0);
    });

    // Group buyers by their end rung count
    const byEndRung = new Map<number, typeof buyers>();
    for (const p of buyers) {
      const endRung = nextRungs[sid]?.[p.id] ?? 0;
      if (!byEndRung.has(endRung)) byEndRung.set(endRung, []);
      byEndRung.get(endRung)!.push(p);
    }

    // Revert every group where ≥2 buyers landed on the same rung
    const revertedIds = new Set<string>();
    for (const [, group] of byEndRung) {
      if (group.length >= 2) {
        for (const p of group) {
          nextRungs[sid][p.id] = startStateRungs[sid]?.[p.id] ?? 0;
          nextReachSeq[sid][p.id] = state.reachSeq[sid]?.[p.id] ?? 0;
          revertedIds.add(p.id);
        }
      }
    }
    if (revertedIds.size > 0) clashedStates.push(sid);

    // Any non-reverted solo buyer who reached max rung secures the state
    const securer = buyers.find(
      (p) => !revertedIds.has(p.id) && (nextRungs[sid]?.[p.id] ?? 0) >= usState.maxRungs,
    );
    if (securer) {
      nextSecured[sid] = securer.id;
      newlySecured.push({ kind: 'state', targetId: sid, playerId: securer.id });
    }
  }

  // National groups — identical clash rule
  for (const g of NATIONAL_GROUPS) {
    const gid = g.id;

    const buyers = nextPlayers.filter((p) => {
      return (nextNatRungs[gid]?.[p.id] ?? 0) > (startNatRungs[gid]?.[p.id] ?? 0);
    });

    const byEndRung = new Map<number, typeof buyers>();
    for (const p of buyers) {
      const endRung = nextNatRungs[gid]?.[p.id] ?? 0;
      if (!byEndRung.has(endRung)) byEndRung.set(endRung, []);
      byEndRung.get(endRung)!.push(p);
    }

    const revertedIds = new Set<string>();
    for (const [, group] of byEndRung) {
      if (group.length >= 2) {
        for (const p of group) {
          nextNatRungs[gid][p.id] = startNatRungs[gid]?.[p.id] ?? 0;
          nextNatReachSeq[gid][p.id] = state.natReachSeq[gid]?.[p.id] ?? 0;
          revertedIds.add(p.id);
        }
      }
    }
    if (revertedIds.size > 0) clashedNational.push(gid);

    const securer = buyers.find(
      (p) => !revertedIds.has(p.id) && (nextNatRungs[gid]?.[p.id] ?? 0) >= g.maxRungs,
    );
    if (securer) {
      nextNatSecured[gid] = securer.id;
      newlySecured.push({ kind: 'national', targetId: gid, playerId: securer.id });
    }
  }

  // ── Step 3: Recompute dominance (with evaporation) ────────────────────────
  const nextDominance = recomputeDominance(
    nextRungs,
    nextReachSeq,
    nextPlayers,
    state.stateGroupDominance,
  );

  // Snapshot nationalCash after purchases+evaporation, before income is paid.
  // Computing income as (post-income - post-purchase) gives gross income earned
  // this turn, excluding purchase costs (which were already spent).
  const afterPurchaseCash: Record<string, number> = Object.fromEntries(
    nextPlayers.map((p) => [p.id, p.nationalCash]),
  );

  // ── Step 4: Pay turn income ───────────────────────────────────────────────
  payTurnIncome(nextPlayers, nextDominance, nextNatRungs, nextNatReachSeq);

  const incomeByPlayer: Record<string, number> = {};
  for (const p of nextPlayers) {
    incomeByPlayer[p.id] = p.nationalCash - (afterPurchaseCash[p.id] ?? 0);
  }

  const nextState: GameState = {
    ...state,
    seqCounter: nextSeq,
    players: nextPlayers,
    rungs: nextRungs,
    natRungs: nextNatRungs,
    reachSeq: nextReachSeq,
    natReachSeq: nextNatReachSeq,
    securedBy: nextSecured,
    natSecuredBy: nextNatSecured,
    stateGroupDominance: nextDominance,
  };

  return {
    state: nextState,
    report: { clashedStates, clashedNational, newlySecured, incomeByPlayer },
  };
}

// ── Election ──────────────────────────────────────────────────────────────────

/**
 * Should an election trigger at the end of this turn?
 * Pass rng = Math.random in production; deterministic fn in tests.
 */
export function rollElection(state: GameState, rng: () => number = Math.random): boolean {
  const prob = electionProbability(state.turn, state.hungColleges);
  return prob > 0 && rng() < prob;
}

export interface ElectionOutcome {
  type: 'winner' | 'hung' | 'elimination';
  result: ElectoralResult;
  eliminatedId?: string;
  /** Updated state after elimination (Power Vacuum + recomputeDominance). */
  nextState?: GameState;
}

/**
 * Process an election trigger. Returns the outcome and (for eliminations) the
 * updated game state after the Power Vacuum wipe.
 */
export function resolveElection(state: GameState): ElectionOutcome {
  const result = tallyElectoralVotes(state);

  if (result.winner) {
    return { type: 'winner', result };
  }

  const activePlayers = state.players.filter((p) => !p.eliminated);

  if (activePlayers.length <= 2) {
    // Hung College — escalate and continue
    return { type: 'hung', result };
  }

  // Multiplayer: eliminate last place
  let lowestEV = Infinity;
  let lowestCash = Infinity;
  let eliminatedId: string | null = null;

  for (const p of activePlayers) {
    const ev = result.evByPlayer[p.id] ?? 0;
    const totalCash = p.nationalCash + Object.values(p.groupWallets).reduce((a, b) => a + b, 0);
    if (
      ev < lowestEV ||
      (ev === lowestEV && totalCash < lowestCash)
    ) {
      lowestEV = ev;
      lowestCash = totalCash;
      eliminatedId = p.id;
    }
  }

  if (!eliminatedId) {
    return { type: 'hung', result };
  }

  // Power Vacuum: wipe eliminated player's rungs everywhere
  const nextPlayers = clonePlayers(state.players);
  const elimPlayer = nextPlayers.find((p) => p.id === eliminatedId)!;
  elimPlayer.eliminated = true;

  const nextRungs = cloneRungMap(state.rungs);
  const nextReachSeq = cloneSeq(state.reachSeq);
  const nextNatRungs = cloneNatRungMap(state.natRungs);
  const nextNatReachSeq = cloneNatSeq(state.natReachSeq);
  const nextSecured = { ...state.securedBy };
  const nextNatSecured = { ...state.natSecuredBy };

  for (const sid of Object.keys(nextRungs)) {
    nextRungs[sid][eliminatedId] = 0;
    nextReachSeq[sid][eliminatedId] = 0;
    if (nextSecured[sid] === eliminatedId) nextSecured[sid] = null;
  }
  for (const gid of Object.keys(nextNatRungs)) {
    nextNatRungs[gid][eliminatedId] = 0;
    nextNatReachSeq[gid][eliminatedId] = 0;
    if (nextNatSecured[gid] === eliminatedId) nextNatSecured[gid] = null;
  }

  // Immediate dominance recompute for survivors
  const nextDominance = recomputeDominance(
    nextRungs,
    nextReachSeq,
    nextPlayers,
    state.stateGroupDominance,
  );

  const nextState: GameState = {
    ...state,
    players: nextPlayers,
    rungs: nextRungs,
    natRungs: nextNatRungs,
    reachSeq: nextReachSeq,
    natReachSeq: nextNatReachSeq,
    securedBy: nextSecured,
    natSecuredBy: nextNatSecured,
    stateGroupDominance: nextDominance,
    hungColleges: state.hungColleges + 1,
  };

  return { type: 'elimination', result, eliminatedId, nextState };
}

// ── Re-exports for convenience ────────────────────────────────────────────────
export { maxRungsFor, maxBuyableThisTurn as gatekeeperCap, WIN_THRESHOLD };
export const TOTAL_ELECTORAL_VOTES = 538;
