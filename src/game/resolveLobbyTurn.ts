/**
 * resolveLobbyTurn — environment-agnostic, server-authoritative turn resolution.
 *
 * This is the single source of truth for resolving an online multiplayer turn.
 * It consumes the lobby's hidden `pendingSubmissions` and produces the next
 * RESOLUTION-phase `LobbyGameState`. It is pure (no Supabase / DOM / React deps)
 * so it can run BOTH in the app's test suite and inside the `resolve-turn`
 * Supabase Edge Function (which vendors a Deno-valid copy of src/game via
 * `npm run build:edge`).
 *
 * Running this on the server — instead of in the "host" browser — is what stops
 * a malicious host from doctoring a resolved state for their own lobby.
 */

import { resolveTurn } from './engine';
import type { LobbyGameState, RoundPurchase } from './types';

export interface ResolveOutcome {
  resolved: LobbyGameState;
}

/**
 * Resolve one online turn.
 *
 * @param remote  the lobby's current LobbyGameState (phase must be PLANNING).
 * @param force   when true, resolve even if not every active player submitted
 *                (the caller is responsible for only forcing after the turn
 *                deadline has genuinely passed).
 * @returns the resolved RESOLUTION-phase state, or `null` if the turn should
 *          not be resolved yet (not all active players have submitted, no force).
 */
export function resolveLobbyTurn(
  remote: LobbyGameState,
  force = false,
): ResolveOutcome | null {
  const active = remote.players.filter((p) => !p.eliminated);
  const allIn = active.every((p) => remote.submittedPlayers.includes(p.id));
  if (!force && !allIn) return null;

  // Flat purchase log (drives the RESOLUTION ticker overlay on every client).
  const lastRoundPurchases: RoundPurchase[] = active.flatMap((p) =>
    (remote.pendingSubmissions[p.id] ?? []).map((pp) => ({
      playerId: p.id,
      candidateId: p.candidateId,
      kind: pp.kind,
      targetId: pp.targetId,
      rungsBought: pp.rungs,
      cost: pp.cost,
    })),
  );

  const { state: newState, report } = resolveTurn(remote, remote.pendingSubmissions);

  const resolved: LobbyGameState = {
    ...newState,
    phase: 'RESOLUTION',
    activePlayerIndex: 0,
    electionResult: null,
    lastIncome: report.incomeByPlayer,
    lastTurnReport: report,
    lastRoundPurchases,
    prevDominance: remote.stateGroupDominance,
    electionTallyProgress: 0,
    hostPlayerId: remote.hostPlayerId,
    submittedPlayers: [],
    pendingSubmissions: {},
  };

  return { resolved };
}
