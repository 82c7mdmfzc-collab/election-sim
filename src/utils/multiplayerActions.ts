/**
 * multiplayerActions — async Supabase operations for multiplayer.
 *
 * Intentionally has NO import from store.ts to avoid circular dependencies.
 * Callers pass callbacks to apply results locally via syncFromPayload or set().
 */

import { supabase } from './supabaseClient';
import { resolveTurn } from '../game/engine';
import type { LobbyGameState, RoundPurchase } from '../game/types';

/** Build the JSONB payload for the lobbies.game_state column from current store state. */
export function buildLobbyPayload(
  source: Omit<LobbyGameState, 'hostPlayerId' | 'submittedPlayers' | 'pendingSubmissions'> &
    Partial<Pick<LobbyGameState, 'hostPlayerId' | 'submittedPlayers' | 'pendingSubmissions'>>,
  hostPlayerId: string,
): LobbyGameState {
  return {
    ...source,
    hostPlayerId,
    submittedPlayers: source.submittedPlayers ?? [],
    pendingSubmissions: source.pendingSubmissions ?? {},
  } as LobbyGameState;
}

/**
 * Atomically merge a player's pending purchases into the lobby row via the
 * `submit_turn_pending` Postgres function. This prevents race conditions when
 * two players submit simultaneously.
 */
export async function pushMySubmission(
  lobbyId: string,
  playerId: string,
  pending: LobbyGameState['pendingSubmissions'][string],
  submittedList: string[],
): Promise<void> {
  const { error } = await supabase.rpc('submit_turn_pending', {
    p_lobby_id: lobbyId,
    p_player_id: playerId,
    p_pending: pending,
    p_submitted_list: submittedList,
  });
  if (error) console.error('[multiplayer] submit_turn_pending failed:', error);
}

/**
 * Fetch the latest pending submissions from Supabase, run resolveTurn, push the
 * resolved state, and notify the caller via onResolved so they can apply it locally.
 *
 * Guarded: exits silently if not all players have submitted yet (handles the
 * case where Realtime fires before the final submission is committed).
 */
export async function resolveHostTurn(
  lobbyId: string,
  onResolved: (resolved: LobbyGameState) => void,
  force = false,
): Promise<void> {
  const { data, error } = await supabase
    .from('lobbies')
    .select('game_state')
    .eq('id', lobbyId)
    .single();

  if (error || !data?.game_state) {
    console.error('[multiplayer] resolveHostTurn: failed to fetch lobby:', error);
    return;
  }

  const remote = data.game_state as LobbyGameState;
  const active = remote.players.filter((p) => !p.eliminated);
  if (!force && !active.every((p) => remote.submittedPlayers.includes(p.id))) return;

  const lastRoundPurchases: RoundPurchase[] = active.flatMap((p) =>
    (remote.pendingSubmissions[p.id] ?? []).map((pp) => ({
      playerId: p.id,
      candidateId: p.candidateId,
      kind: pp.kind,
      targetId: pp.targetId,
      rungsBought: pp.rungs,
      cost: pp.cost,
    }))
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

  // Apply locally first (host doesn't wait for its own Realtime event)
  onResolved(resolved);

  void supabase
    .from('lobbies')
    .update({ game_state: resolved })
    .eq('id', lobbyId);
}
