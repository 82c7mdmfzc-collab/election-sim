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
 * Invoke the `resolve-turn` Edge Function with a bounded retry. The function is
 * idempotent (it guards against double-resolution), so retrying a transient
 * network/cold-start failure is safe. Returns the final invoke result.
 */
async function invokeResolveTurn(
  body: Record<string, unknown>,
  attempts = 2,
): Promise<Awaited<ReturnType<typeof supabase.functions.invoke>>> {
  let last!: Awaited<ReturnType<typeof supabase.functions.invoke>>;
  for (let i = 0; i < attempts; i++) {
    last = await supabase.functions.invoke('resolve-turn', { body });
    if (!last.error) return last;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1200));
  }
  return last;
}

/**
 * Atomically merge a player's pending purchases into the lobby row via the
 * `submit_turn_pending` Postgres function. This prevents race conditions when
 * two players submit simultaneously.
 *
 * Returns true on success, false on failure so the caller can roll back its
 * optimistic "submitted" state and let the player retry.
 */
export async function pushMySubmission(
  lobbyId: string,
  playerId: string,
  pending: LobbyGameState['pendingSubmissions'][string],
  submittedList: string[],
): Promise<boolean> {
  const { error } = await supabase.rpc('submit_turn_pending', {
    p_lobby_id: lobbyId,
    p_player_id: playerId,
    p_pending: pending,
    p_submitted_list: submittedList,
  });
  if (error) {
    console.error('[multiplayer] submit_turn_pending failed:', error);
    notifyError('Could not submit your turn. Check your connection and try again.');
    return false;
  }
  return true;
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
): Promise<boolean> {
  const { data, error } = await invokeResolveTurn({ lobbyId, force });

  if (error) {
    console.error('[multiplayer] resolve-turn failed:', error);
    notifyError('Turn resolution failed. Check your connection — it will retry automatically.');
    return false;
  }

  const resolved = (data as { resolved?: LobbyGameState } | null)?.resolved;
  if (resolved) onResolved(resolved);
  return true;
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
): Promise<boolean> {
  const { data, error } = await invokeResolveTurn({ lobbyId, action });

  if (error) {
    console.error(`[multiplayer] advance-phase (${action}) failed:`, error);
    notifyError('Could not advance the game. Check your connection and try again.');
    return false;
  }

  const resolved = (data as { resolved?: LobbyGameState } | null)?.resolved;
  if (resolved) onResolved(resolved);
  return true;
}
