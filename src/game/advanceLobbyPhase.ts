/**
 * advanceLobbyPhase — environment-agnostic, server-authoritative phase advances
 * for online multiplayer (the non-resolution transitions).
 *
 * Companion to resolveLobbyTurn.ts. Where that handles PLANNING → RESOLUTION,
 * this handles every transition AFTER resolution:
 *   • confirmResolution: RESOLUTION → (ELECTION | next PLANNING turn)
 *   • resolveElection:   ELECTION   → (ELECTION_TALLY | next PLANNING turn)
 *   • completeTally:     ELECTION_TALLY → GAME_OVER
 *
 * Previously these ran in the *host's browser* and were broadcast via
 * push_game_state, so a malicious host could fabricate an election outcome,
 * skip turns, or declare a false winner. Running them on the server (inside the
 * resolve-turn Edge Function, which vendors this file) makes the host just
 * another client and closes that hole. The function is pure so it is unit-tested
 * in the app suite and reused verbatim by Deno.
 *
 * Turn deadlines are derived from the server clock here (via `nowMs` +
 * turnTimeLimitSec) rather than trusting a client-supplied deadline.
 */

import { rollElection, tallyElectoralVotes, resolveElection as engineResolveElection } from './engine';
import type { LobbyGameState } from './types';

export type PhaseAction = 'confirmResolution' | 'resolveElection' | 'completeTally';

/** The store phase each action is only valid from — also used for the edge CAS guard. */
export const REQUIRED_PHASE: Record<PhaseAction, LobbyGameState['phase']> = {
  confirmResolution: 'RESOLUTION',
  resolveElection: 'ELECTION',
  completeTally: 'ELECTION_TALLY',
};

function nextDeadline(remote: LobbyGameState, nowMs: number): number | null {
  const tl = remote.turnTimeLimitSec;
  return tl != null ? nowMs + tl * 1000 : null;
}

/** Build a fresh PLANNING-phase lobby state for the given turn number. */
function toPlanning(
  base: LobbyGameState,
  turn: number,
  nowMs: number,
  rng: () => number,
): LobbyGameState {
  return {
    ...base,
    phase: 'PLANNING',
    turn,
    electionScheduled: rollElection({ ...base, turn }, rng),
    activePlayerIndex: 0,
    electionResult: null,
    electionTallyProgress: 0,
    submittedPlayers: [],
    pendingSubmissions: {},
    turnDeadlineUtc: nextDeadline(base, nowMs),
  };
}

/**
 * Apply a post-resolution phase transition. Returns the next LobbyGameState, or
 * null if the action isn't valid from the current phase (the caller treats null
 * as a no-op / skip). Mirrors the local logic in store.ts so single-player and
 * online stay behaviourally identical.
 */
export function advanceLobbyPhase(
  remote: LobbyGameState,
  action: PhaseAction,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): LobbyGameState | null {
  if (remote.phase !== REQUIRED_PHASE[action]) return null;

  switch (action) {
    case 'confirmResolution': {
      if (remote.electionScheduled) {
        const result = tallyElectoralVotes(remote);
        return { ...remote, electionResult: result, phase: 'ELECTION', electionScheduled: false };
      }
      return toPlanning(remote, remote.turn + 1, nowMs, rng);
    }

    case 'resolveElection': {
      if (!remote.electionResult) return null;
      const outcome = engineResolveElection(remote);

      if (outcome.type === 'winner') {
        return { ...remote, phase: 'ELECTION_TALLY', electionTallyProgress: 0 };
      }

      if (outcome.type === 'hung') {
        return {
          ...toPlanning(remote, remote.turn + 1, nowMs, rng),
          hungColleges: remote.hungColleges + 1,
        };
      }

      // Elimination — apply the Power Vacuum next-state from the engine.
      const nextState = outcome.nextState!;
      const merged = { ...remote, ...nextState } as LobbyGameState;
      const remaining = nextState.players.filter((p) => !p.eliminated);

      if (remaining.length <= 1) {
        const winnerId = remaining[0]?.id ?? null;
        return {
          ...merged,
          electionResult: winnerId ? { ...outcome.result, winner: winnerId } : outcome.result,
          phase: 'ELECTION_TALLY',
          electionTallyProgress: 0,
        };
      }
      return toPlanning(merged, nextState.turn + 1, nowMs, rng);
    }

    case 'completeTally':
      return { ...remote, phase: 'GAME_OVER' };
  }
}
