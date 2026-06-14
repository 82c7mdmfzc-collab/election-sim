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
