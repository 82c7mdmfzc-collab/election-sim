import { createClient } from '@supabase/supabase-js';
import type { LobbyGameState, WaitingPlayer, WaitingLobbyState } from '../game/types';

export type { WaitingPlayer, WaitingLobbyState };

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

// Defer the "not configured" check to runtime calls rather than module load time
// so that engine tests (which import the store) don't fail without env vars set.
export const isSupabaseConfigured = !!(url && key);

export const supabase = createClient(
  url || 'http://placeholder.supabase.co',
  key || 'placeholder',
  { realtime: { params: { eventsPerSecond: 10 } } },
);

export interface LobbyRow {
  id: string;
  room_code: string;
  is_public: boolean;
  status: 'waiting' | 'in_progress' | 'finished';
  player_count: number;
  game_state: LobbyGameState | WaitingLobbyState | null;
  created_at: string;
  updated_at: string;
}

export async function rpcJoinLobbyPlayer(
  lobbyId: string,
  player: WaitingPlayer,
): Promise<void> {
  const { error } = await supabase.rpc('join_lobby_player', {
    p_lobby_id: lobbyId,
    p_player: player,
  });
  if (error) throw error;
}

/** Create a lobby as the host (server records host_uid = auth.uid()). */
export async function rpcCreateLobby(args: {
  roomCode: string;
  isPublic: boolean;
  playerCount: number;
  gameState: WaitingLobbyState;
}): Promise<LobbyRow> {
  const { data, error } = await supabase
    .rpc('create_lobby', {
      p_room_code: args.roomCode,
      p_is_public: args.isPublic,
      p_player_count: args.playerCount,
      p_game_state: args.gameState,
    })
    .single();
  if (error || !data) throw error ?? new Error('create_lobby returned no row');
  return data as LobbyRow;
}

/** Host-only: transition a waiting lobby to in_progress with the initial game state. */
export async function rpcStartGame(lobbyId: string, gameState: LobbyGameState): Promise<void> {
  const { error } = await supabase.rpc('start_game', {
    p_lobby_id: lobbyId,
    p_game_state: gameState,
  });
  if (error) throw error;
}

/** Retry an RPC call with exponential backoff. Returns true on success. */
async function retryRpc(
  label: string,
  fn: string,
  args: Record<string, unknown>,
  attempts = 3,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const { error } = await supabase.rpc(fn, args);
    if (!error) return true;
    console.error(`[multiplayer] ${label} failed (attempt ${i + 1}/${attempts}):`, error);
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  return false;
}

/** Host-only: update lobby lifecycle status (e.g. mark 'finished'). Retries on failure. */
export async function rpcSetLobbyStatus(
  lobbyId: string,
  status: LobbyRow['status'],
): Promise<void> {
  await retryRpc('set_lobby_status', 'set_lobby_status', {
    p_lobby_id: lobbyId,
    p_status: status,
  });
}
