/**
 * Zustand store — single source of truth for all mutable game state.
 *
 * Turn lifecycle:
 *   P1_TURN → (submitTurn) → P2_TURN → (submitTurn) → RESOLUTION
 *   RESOLUTION → (confirmResolution) → P1_TURN  [or ELECTION if dice hits]
 *   ELECTION → (resolveElection) → P1_TURN [or GAME_OVER]
 *   GAME_OVER — terminal
 *
 * Pending spends are never applied immediately. Each player's allocations are
 * logged to pendingSpends[candidateId] during their turn, then interleaved and
 * resolved simultaneously when P2 submits. Neither player has a sequencing edge.
 *
 * CRITICAL — useElectoralResult must use THREE separate subscriptions:
 *   One each for investment / securedBy / investmentOrder / states / candidates.
 *   A single selector returning tallyElectoralVotes() always returns a NEW object
 *   → Zustand's === check always fails → infinite re-render loop.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { calculateRungCost, resolveTurn, tallyElectoralVotes } from './engine';
import { createInitialGameState } from './statesData';
import type {
  CandidateId,
  ElectoralResult,
  GameState,
  InterestGroup,
  StateId,
} from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

export const BASE_TURN_INCOME = 200;
export const EV_INCOME_RATE = 3;
export const ELECTION_START_TURN = 11;
export const ELECTION_CHANCE = 0.125; // 12.5 % per confirmResolution after turn 11

// ── Phase & pending types ─────────────────────────────────────────────────────

export type GamePhase = 'P1_TURN' | 'P2_TURN' | 'RESOLUTION' | 'ELECTION' | 'GAME_OVER';

export interface PendingSpend {
  readonly stateId: StateId;
  readonly amount: number; // rungs
  readonly cost: number; // cash cost
  readonly group?: InterestGroup;
}

// ── Store shape ───────────────────────────────────────────────────────────────

interface GameStore extends GameState {
  phase: GamePhase;
  activePlayerId: CandidateId;
  pendingSpends: Record<CandidateId, PendingSpend[]>;
  lastIncome: Record<CandidateId, number>;
  /** Frozen election tally; populated when phase transitions to ELECTION. */
  electionResult: ElectoralResult | null;
  /** IDs of candidates knocked out in previous elections (not yet cleared). */
  eliminatedCandidates: CandidateId[];

  allocateSpend(stateId: StateId, amount: number, group?: InterestGroup): boolean;
  cancelAllocation(stateId: StateId): void;
  submitTurn(): void;
  confirmResolution(): void;
  resolveElection(): void;
  reset(): void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyPending(candidates: GameState['candidates']): Record<CandidateId, PendingSpend[]> {
  const m: Record<CandidateId, PendingSpend[]> = {};
  for (const c of candidates) m[c.id] = [];
  return m;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameStore>()(persist((set, get) => {
  const initial = createInitialGameState();

  return {
    ...initial,
    phase: 'P1_TURN',
    activePlayerId: initial.candidates[0].id,
    pendingSpends: emptyPending(initial.candidates),
    lastIncome: Object.fromEntries(initial.candidates.map((c) => [c.id, 0])),
    electionResult: null,
    eliminatedCandidates: [],

    allocateSpend(stateId, amount, group) {
      const { phase, activePlayerId, candidates, states, pendingSpends, investment } = get();
      if (phase !== 'P1_TURN' && phase !== 'P2_TURN') return false;

      const candidate = candidates.find((c) => c.id === activePlayerId);
      const usState = states.find((s) => s.id === stateId);
      if (!candidate || !usState) return false;
      if (!Number.isFinite(amount) || amount <= 0) return false;

      const stateSpends = (pendingSpends[activePlayerId] ?? []).filter((p) => p.stateId === stateId);
      const pendingRungs = stateSpends.reduce((sum, p) => sum + p.amount, 0);
      const startRungs = investment[stateId]?.[activePlayerId] ?? 0;

      // The 2-Rung Entry Gatekeeper
      if (startRungs === 0 && pendingRungs + amount > 2) return false;
      if (startRungs + pendingRungs + amount > usState.maxRungs) return false;

      const groupIsTargetable = group !== undefined && usState.interestGroups.includes(group);
      const affinityBonus = groupIsTargetable ? (candidate.affinities[group] ?? 0) : 0;
      
      const cost = calculateRungCost(usState.baseCampaignCost, usState.maxRungs, startRungs + pendingRungs, amount, affinityBonus);

      const totalCommittedCash = (pendingSpends[activePlayerId] ?? []).reduce(
        (sum, p) => sum + p.cost,
        0,
      );
      if (candidate.cash - totalCommittedCash < cost) return false;

      set((s) => ({
        pendingSpends: {
          ...s.pendingSpends,
          [activePlayerId]: [
            ...(s.pendingSpends[activePlayerId] ?? []),
            { stateId, amount, cost, ...(group !== undefined ? { group } : {}) },
          ],
        },
      }));
      return true;
    },

    cancelAllocation(stateId) {
      const { activePlayerId, phase } = get();
      if (phase !== 'P1_TURN' && phase !== 'P2_TURN') return;
      set((s) => ({
        pendingSpends: {
          ...s.pendingSpends,
          [activePlayerId]: (s.pendingSpends[activePlayerId] ?? []).filter(
            (p) => p.stateId !== stateId,
          ),
        },
      }));
    },

    submitTurn() {
      const snap = get();
      const { phase, candidates, pendingSpends, states, investment, securedBy, investmentOrder, turn } = snap;

      if (phase === 'P1_TURN') {
        set({ phase: 'P2_TURN', activePlayerId: candidates[1].id });
        return;
      }

      if (phase !== 'P2_TURN') return;

      const p1Spends = { candidateId: candidates[0].id, spends: pendingSpends[candidates[0].id] ?? [] };
      const p2Spends = { candidateId: candidates[1].id, spends: pendingSpends[candidates[1].id] ?? [] };

      const wip = resolveTurn(
        { turn, candidates, states, investment, securedBy, investmentOrder },
        p1Spends,
        p2Spends
      );

      // Award income based on projected EVs after resolution
      const tally = tallyElectoralVotes(wip);
      const incomeMap: Record<CandidateId, number> = {};

      const nextCandidates = wip.candidates.map((c) => {
        const evLed = wip.states
          .filter((st) => tally.stateLeaders[st.id] === c.id)
          .reduce((sum, st) => sum + st.electoralVotes, 0);
        const income = BASE_TURN_INCOME + evLed * EV_INCOME_RATE;
        incomeMap[c.id] = income;
        return { ...c, cash: c.cash + income };
      });

      set({
        candidates: nextCandidates,
        investment: wip.investment,
        securedBy: wip.securedBy,
        investmentOrder: wip.investmentOrder,
        phase: 'RESOLUTION',
        activePlayerId: candidates[0].id,
        pendingSpends: emptyPending(candidates),
        lastIncome: incomeMap,
      });
    },

    confirmResolution() {
      const snap = get();
      if (snap.phase !== 'RESOLUTION') return;

      const { turn, candidates, states, investment, securedBy, investmentOrder } = snap;

      if (turn >= ELECTION_START_TURN && Math.random() < ELECTION_CHANCE) {
        // Election triggered — freeze the tally and switch to ELECTION phase
        const electionResult = tallyElectoralVotes({
          turn,
          candidates,
          states,
          investment,
          securedBy,
          investmentOrder,
        });
        set({ electionResult, phase: 'ELECTION' });
      } else {
        set((s) => ({
          phase: 'P1_TURN',
          turn: s.turn + 1,
          activePlayerId: s.candidates[0].id,
        }));
      }
    },

    resolveElection() {
      const { electionResult, candidates, securedBy, eliminatedCandidates } = get();
      if (!electionResult) return;

      if (electionResult.winner) {
        set({ phase: 'GAME_OVER' });
        return;
      }

      // Find the lowest-EV candidate among those still active
      const active = candidates.filter((c) => !eliminatedCandidates.includes(c.id));
      let lowestEV = Infinity;
      let lowestId: CandidateId | null = null;
      for (const c of active) {
        const ev = electionResult.evByCandidate[c.id] ?? 0;
        if (ev < lowestEV) {
          lowestEV = ev;
          lowestId = c.id;
        }
      }

      if (!lowestId) {
        set({ phase: 'GAME_OVER' });
        return;
      }

      // Release all states the eliminated candidate had secured
      const nextSecured = { ...securedBy };
      for (const stateId of Object.keys(nextSecured)) {
        if (nextSecured[stateId] === lowestId) {
          nextSecured[stateId] = null;
        }
      }

      const nextEliminated = [...eliminatedCandidates, lowestId];
      const remaining = candidates.filter((c) => !nextEliminated.includes(c.id));

      if (remaining.length <= 1) {
        // Last candidate standing wins automatically
        const lastWinner = remaining[0]?.id ?? null;
        set({
          eliminatedCandidates: nextEliminated,
          securedBy: nextSecured,
          phase: 'GAME_OVER',
          electionResult: lastWinner
            ? { ...electionResult, winner: lastWinner }
            : electionResult,
        });
        return;
      }

      // More than 2 players: continue with next turn
      const nextActiveId = remaining[0].id;
      set((s) => ({
        eliminatedCandidates: nextEliminated,
        securedBy: nextSecured,
        phase: 'P1_TURN',
        turn: s.turn + 1,
        activePlayerId: nextActiveId,
        electionResult: null,
      }));
    },

    reset() {
      const fresh = createInitialGameState();
      set({
        ...fresh,
        phase: 'P1_TURN',
        activePlayerId: fresh.candidates[0].id,
        pendingSpends: emptyPending(fresh.candidates),
        lastIncome: Object.fromEntries(fresh.candidates.map((c) => [c.id, 0])),
        electionResult: null,
        eliminatedCandidates: [],
      });
    },
  };
}, { name: 'election-sim-storage' }));

// ── Selectors ─────────────────────────────────────────────────────────────────

/**
 * Live EV projection using THREE separate subscriptions.
 * Each returns a stable reference (primitive / same object) when data hasn't
 * changed, so Zustand's === check passes and components don't re-render needlessly.
 * A single selector returning tallyElectoralVotes({}) would return a NEW object
 * every call → infinite re-render loop.
 */
export function useElectoralResult(): ElectoralResult {
  const investment = useGameStore((s) => s.investment);
  const securedBy = useGameStore((s) => s.securedBy);
  const investmentOrder = useGameStore((s) => s.investmentOrder);
  const states = useGameStore((s) => s.states);
  const candidates = useGameStore((s) => s.candidates);
  return tallyElectoralVotes({ turn: 0, candidates, states, investment, securedBy, investmentOrder });
}

/** Active player's remaining unallocated budget for this turn. */
export function useAvailableBudget(): number {
  return useGameStore((s) => {
    const candidate = s.candidates.find((c) => c.id === s.activePlayerId);
    if (!candidate) return 0;
    const committed = (s.pendingSpends[s.activePlayerId] ?? []).reduce(
      (sum, p) => sum + p.cost,
      0,
    );
    return Math.max(0, candidate.cash - committed);
  });
}

/** Active player's pending allocations — never leaks the opponent's plan. */
export function useActivePendingSpends(): PendingSpend[] {
  return useGameStore((s) => s.pendingSpends[s.activePlayerId] ?? []);
}

/** Total pending dollars the active player has allocated to a specific state. */
export function useStatePendingAmount(stateId: StateId): number {
  return useGameStore(
    (s) =>
      (s.pendingSpends[s.activePlayerId] ?? [])
        .filter((p) => p.stateId === stateId)
        .reduce((sum, p) => sum + p.amount, 0),
  );
}

/** Narrow selector: a single candidate's current cash. */
export function useCandidateCash(candidateId: CandidateId): number {
  return useGameStore((s) => s.candidates.find((c) => c.id === candidateId)?.cash ?? 0);
}

/** Narrow selector: the investment amounts for one state only. */
export function useStateInvestment(stateId: StateId): Record<CandidateId, number> {
  return useGameStore((s) => s.investment[stateId] ?? {});
}

/** Total EVs secured (locked) by a specific candidate. */
export function useSecuredEVs(candidateId: CandidateId): number {
  return useGameStore((s) =>
    s.states.reduce(
      (sum, st) => (s.securedBy[st.id] === candidateId ? sum + st.electoralVotes : sum),
      0,
    ),
  );
}
