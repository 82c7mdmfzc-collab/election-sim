/**
 * Pure game-engine math — no React, no side effects, no I/O.
 *
 * Investment model:
 *   Each candidate's spend is independent and cumulative (not zero-sum).
 *   Affinity bonuses multiply the effective investment: effective = amount × (1 + bonus)
 *   First candidate to reach (baseCampaignCost × 100) secures the state permanently.
 *
 * Election resolution (called only when election is triggered, not during normal play):
 *   - Secured states  → that candidate's guaranteed EVs
 *   - Contested       → highest investor wins; equal investment → whoever invested first
 *   - Uncontested     → 0 EVs (state not worth fighting over without a rival)
 */

import type {
  CandidateId,
  ElectoralResult,
  GameState,
  InvestmentMap,
  InvestmentResult,
  InterestGroup,
  StateId,
} from './types';

export const TOTAL_ELECTORAL_VOTES = 538;
export const WIN_THRESHOLD = 270;

// ── Clone helpers (exported so store can build WIP state immutably) ───────────

export function cloneInvestment(inv: InvestmentMap): InvestmentMap {
  const next: InvestmentMap = {};
  for (const stateId of Object.keys(inv)) {
    next[stateId] = { ...inv[stateId] };
  }
  return next;
}

export function cloneOrderMap(
  orderMap: Record<StateId, CandidateId[]>,
): Record<StateId, CandidateId[]> {
  const next: Record<StateId, CandidateId[]> = {};
  for (const stateId of Object.keys(orderMap)) {
    next[stateId] = [...orderMap[stateId]];
  }
  return next;
}

// ── Core investment action ────────────────────────────────────────────────────

export function calculateRungCost(
  baseCost: number,
  maxRungs: number,
  startRung: number,
  rungsToBuy: number,
  affinityBonus: number
): number {
  let cost = 0;
  for (let i = 1; i <= rungsToBuy; i++) {
    const rungIndex = startRung + i;
    const multiplier = (maxRungs === 15 && rungIndex === 15) ? 4.0 : 1.0;
    const rungCost = baseCost * multiplier;
    cost += rungCost / (1 + affinityBonus);
  }
  return cost;
}

export interface PlayerTurnSpends {
  candidateId: string;
  spends: Array<{
    stateId: string;
    rungs: number;
    cost: number;
  }>;
}

export function resolveTurn(
  state: import('./types').GameState,
  p1Spends: PlayerTurnSpends,
  p2Spends: PlayerTurnSpends
): import('./types').GameState {
  const nextInv = cloneInvestment(state.investment);
  const nextSecured = { ...state.securedBy };
  const nextOrder = cloneOrderMap(state.investmentOrder);
  const nextCandidates = state.candidates.map(c => ({ ...c }));

  const p1 = nextCandidates.find(c => c.id === p1Spends.candidateId);
  const p2 = nextCandidates.find(c => c.id === p2Spends.candidateId);
  if (!p1 || !p2) return state;

  p1.cash -= p1Spends.spends.reduce((sum, s) => sum + s.cost, 0);
  p2.cash -= p2Spends.spends.reduce((sum, s) => sum + s.cost, 0);

  const statesToProcess = new Set<string>();
  p1Spends.spends.forEach(s => statesToProcess.add(s.stateId));
  p2Spends.spends.forEach(s => statesToProcess.add(s.stateId));

  for (const stateId of statesToProcess) {
    const usState = state.states.find(s => s.id === stateId);
    if (!usState) continue;

    const p1Rungs = p1Spends.spends.filter(s => s.stateId === stateId).reduce((sum, s) => sum + s.rungs, 0);
    const p2Rungs = p2Spends.spends.filter(s => s.stateId === stateId).reduce((sum, s) => sum + s.rungs, 0);

    if (p1Rungs > 0 && !nextOrder[stateId]?.includes(p1.id)) {
      nextOrder[stateId] = [...(nextOrder[stateId] || []), p1.id];
    }
    if (p2Rungs > 0 && !nextOrder[stateId]?.includes(p2.id)) {
      nextOrder[stateId] = [...(nextOrder[stateId] || []), p2.id];
    }

    const p1Start = nextInv[stateId]?.[p1.id] ?? 0;
    const p2Start = nextInv[stateId]?.[p2.id] ?? 0;

    let p1End = p1Start + p1Rungs;
    let p2End = p2Start + p2Rungs;

    if (p1End >= usState.maxRungs && p2End >= usState.maxRungs) {
      p1End = p1Start;
      p2End = p2Start;
      nextSecured[stateId] = null;
    } else {
      if (p1End >= usState.maxRungs) nextSecured[stateId] = p1.id;
      if (p2End >= usState.maxRungs) nextSecured[stateId] = p2.id;
    }

    if (!nextInv[stateId]) nextInv[stateId] = {};
    nextInv[stateId][p1.id] = p1End;
    nextInv[stateId][p2.id] = p2End;
  }

  return {
    ...state,
    investment: nextInv,
    securedBy: nextSecured,
    investmentOrder: nextOrder,
    candidates: nextCandidates,
  };
}

// ── Electoral tally ───────────────────────────────────────────────────────────

/**
 * Evaluate every state under the election model and report EVs per candidate.
 *
 * This function is pure and used for both:
 *   - Live EV projection during normal play (caller ignores `.winner`)
 *   - Final election resolution (caller acts on `.winner`)
 */
export function tallyElectoralVotes(state: GameState): ElectoralResult {
  const { candidates, states, investment, securedBy, investmentOrder } = state;

  const evByCandidate: Record<CandidateId, number> = {};
  const stateLeaders: Record<StateId, CandidateId | null> = {};

  for (const c of candidates) evByCandidate[c.id] = 0;

  for (const usState of states) {
    const sid = usState.id;
    const locked = securedBy[sid];

    if (locked != null) {
      // Secured: candidate guaranteed these EVs
      stateLeaders[sid] = locked;
      evByCandidate[locked] = (evByCandidate[locked] ?? 0) + usState.electoralVotes;
      continue;
    }

    const stateInv = investment[sid] ?? {};
    const investors = candidates.filter((c) => (stateInv[c.id] ?? 0) > 0);

    if (investors.length < 2) {
      // Uncontested (0 or 1 investors) → 0 EVs
      stateLeaders[sid] = null;
      continue;
    }

    // Find the highest investor(s)
    let maxInv = 0;
    for (const c of investors) maxInv = Math.max(maxInv, stateInv[c.id] ?? 0);

    const tied = investors.filter((c) => (stateInv[c.id] ?? 0) === maxInv);

    let leaderId: CandidateId;
    if (tied.length === 1) {
      leaderId = tied[0].id;
    } else {
      // Tie-break: whoever invested in this state first
      const order = investmentOrder[sid] ?? [];
      const first = order.find((id) => tied.some((c) => c.id === id));
      leaderId = first ?? tied[0].id;
    }

    stateLeaders[sid] = leaderId;
    evByCandidate[leaderId] = (evByCandidate[leaderId] ?? 0) + usState.electoralVotes;
  }

  let winner: CandidateId | null = null;
  for (const c of candidates) {
    if ((evByCandidate[c.id] ?? 0) >= WIN_THRESHOLD) {
      winner = c.id;
      break;
    }
  }

  return { evByCandidate, stateLeaders, winner };
}
