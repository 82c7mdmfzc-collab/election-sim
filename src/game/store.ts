/**
 * Zustand store — the single source of truth and the ONLY controlled entry
 * point for mutating game state.
 *
 * Why a store outside React: the game-loop math lives in `engine.ts` and runs
 * independently of rendering. Components subscribe with narrow selectors, so a
 * spend in one state re-renders only the cells that actually changed — not all
 * 50 states. This is the key efficiency pattern for scaling the UI.
 *
 * Anti-tamper: `cash` and `support` are mutated exclusively here, via the
 * validated pure `spendFunds`. There is no public setter that lets a caller
 * assign an arbitrary balance.
 */

import { create } from 'zustand';
import { spendFunds, tallyElectoralVotes } from './engine';
import { createInitialGameState } from './mockData';
import type {
  CandidateId,
  ElectoralResult,
  GameState,
  InterestGroup,
  StateId,
} from './types';

interface GameStore extends GameState {
  /**
   * Spend funds for a candidate in a state (optionally targeting a group).
   * Returns whether the spend succeeded; commits to the store only on success.
   */
  spend: (
    candidateId: CandidateId,
    stateId: StateId,
    amount: number,
    group?: InterestGroup,
  ) => boolean;
  /** Advance the turn counter. */
  nextTurn: () => void;
  /** Reset to a fresh game. */
  reset: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  ...createInitialGameState(),

  spend: (candidateId, stateId, amount, group) => {
    const state = get();
    const result = spendFunds(state, candidateId, stateId, amount, group);
    if (!result.ok) return false;
    set({ candidates: result.candidates, support: result.support });
    return true;
  },

  nextTurn: () => set((s) => ({ turn: s.turn + 1 })),

  reset: () => set(createInitialGameState()),
}));

/**
 * Derived electoral projection. Computing it inside a custom hook (rather than
 * storing it) keeps a single source of truth; React only recomputes when the
 * inputs it subscribes to actually change.
 *
 * We subscribe to `support` and `states`/`candidates` and recompute the tally.
 * The tally itself is cheap (one pass over states), so re-running it per change
 * is fine and avoids stale-derived-state bugs.
 */
export function useElectoralResult(): ElectoralResult {
  const support = useGameStore((s) => s.support);
  const states = useGameStore((s) => s.states);
  const candidates = useGameStore((s) => s.candidates);
  return tallyElectoralVotes({ turn: 0, support, states, candidates });
}

/** Narrow selector: a single candidate's current cash. */
export function useCandidateCash(candidateId: CandidateId): number {
  return useGameStore(
    (s) => s.candidates.find((c) => c.id === candidateId)?.cash ?? 0,
  );
}

/** Narrow selector: the support split for one state only. */
export function useStateSupport(
  stateId: StateId,
): Record<CandidateId, number> {
  return useGameStore((s) => s.support[stateId]);
}
