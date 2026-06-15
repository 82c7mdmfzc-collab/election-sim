/**
 * multiplayerActions — async Supabase operations for multiplayer.
 *
 * Intentionally has NO import from store.ts to avoid circular dependencies.
 * Callers pass callbacks to apply results locally via syncFromPayload or set().
 */

import { supabase } from './supabaseClient';
import { notifyError } from './toast';
import type { LobbyGameState } from '../game/types';

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
  if (error) {
    console.error('[multiplayer] submit_turn_pending failed:', error);
    // Surface the real Postgres error so it can be diagnosed on devices (e.g.
    // mobile) where the console isn't reachable. TODO: revert to a friendly
    // message once the submit issue is resolved.
    const detail = [error.message, error.code, error.details, error.hint]
      .filter(Boolean)
      .join(' | ');
    notifyError(`Submit failed: ${detail || 'unknown error'}`);
  }
}

/**
 * Trigger server-authoritative turn resolution.
 *
 * Resolution now runs inside the `resolve-turn` Supabase Edge Function (with the
 * service-role key), NOT in the host's browser — so a host can no longer doctor
 * the resolved state. This invokes the function and applies the authoritative
 * result locally via onResolved (other clients receive it over Realtime).
 *
 * The function itself re-checks that the caller is a participant, that all
 * players submitted (or the deadline passed when force=true), and guards against
 * double-resolution, so it is safe to call from the host's all-submitted path.
 */
export async function resolveHostTurn(
  lobbyId: string,
  onResolved: (resolved: LobbyGameState) => void,
  force = false,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('resolve-turn', {
    body: { lobbyId, force },
  });

  if (error) {
    console.error('[multiplayer] resolve-turn failed:', error);
    notifyError('Turn resolution failed. Retrying shortly…');
    return;
  }

  const resolved = (data as { resolved?: LobbyGameState } | null)?.resolved;
  if (resolved) onResolved(resolved);
}

/**
 * Trigger a server-authoritative post-resolution phase transition
 * (confirmResolution / resolveElection / completeTally).
 *
 * Like resolveHostTurn, this runs inside the resolve-turn Edge Function so the
 * host browser can no longer fabricate an election outcome, skip turns, or
 * declare a false winner. The authoritative next state is applied locally via
 * onResolved; other clients receive it over Realtime.
 */
export async function advanceHostPhase(
  lobbyId: string,
  action: 'confirmResolution' | 'resolveElection' | 'completeTally',
  onResolved: (resolved: LobbyGameState) => void,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('resolve-turn', {
    body: { lobbyId, action },
  });

  if (error) {
    console.error(`[multiplayer] advance-phase (${action}) failed:`, error);
    notifyError('Could not advance the game. Check your connection and try again.');
    return;
  }

  const resolved = (data as { resolved?: LobbyGameState } | null)?.resolved;
  if (resolved) onResolved(resolved);
}
