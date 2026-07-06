import { createClient } from '@supabase/supabase-js';
import type { LobbyGameState, WaitingPlayer, WaitingLobbyState } from '../game/types';
import { APP_VERSION } from './appVersion';
import { platformKind } from './platform';
import { setUpdateRequiredFromServer } from './updateGate';

export type { WaitingPlayer, WaitingLobbyState };

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

// Defer the "not configured" check to runtime calls rather than module load time
// so that engine tests (which import the store) don't fail without env vars set.
export const isSupabaseConfigured = !!(url && key);

// Forced-update interceptor: every Supabase request carries the app version +
// platform (below), so the server can refuse an out-of-date build. The edge
// functions answer with HTTP 426; guarded RPCs raise an UPDATE_REQUIRED error
// (surfaced by PostgREST as a 4xx whose JSON body carries the message). Either
// way we flip the update gate to 'required' so the UI blocks online/store/account.
async function gatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 426) {
    setUpdateRequiredFromServer();
  } else if (!res.ok) {
    try {
      if ((await res.clone().text()).includes('UPDATE_REQUIRED')) {
        setUpdateRequiredFromServer();
      }
    } catch {
      /* body unreadable — nothing to inspect */
    }
  }
  return res;
}

export const supabase = createClient(
  url || 'http://placeholder.supabase.co',
  key || 'placeholder',
  {
    realtime: { params: { eventsPerSecond: 10 } },
    global: {
      // Reaches REST/RPC (PostgREST exposes them via request.headers) AND edge
      // functions. platformKind() is 'web' off-device, where the server fails open.
      headers: {
        'x-app-version': APP_VERSION,
        'x-platform': platformKind(),
      },
      fetch: gatedFetch,
    },
    // Durable sessions are what make online play reliable: a stable auth.uid()
    // across refreshes/devices keeps the lobby_participants binding valid. We also
    // parse the OAuth callback fragment on load (detectSessionInUrl) and refresh
    // tokens automatically so the uid never drifts mid-game.
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
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

interface EdgeResolvedResponse {
  resolved?: LobbyGameState;
  error?: string;
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

/** Host-only: replace the waiting-room bot seats. Humans remain untouched. */
export async function rpcSetLobbyBots(
  lobbyId: string,
  bots: WaitingPlayer[],
): Promise<LobbyRow> {
  const { data, error } = await supabase
    .rpc('set_lobby_bots', {
      p_lobby_id: lobbyId,
      p_bots: bots,
    })
    .single();
  if (error || !data) throw error ?? new Error('set_lobby_bots returned no row');
  return data as LobbyRow;
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

export async function rpcFindLobbyByCode(roomCode: string): Promise<LobbyRow | null> {
  const { data, error } = await supabase
    .rpc('find_lobby_by_code', { p_room_code: roomCode })
    .maybeSingle();
  if (error) throw error;
  return data ? (data as LobbyRow) : null;
}

export async function rpcListPublicLobbies(): Promise<LobbyRow[]> {
  const { data, error } = await supabase.rpc('list_public_lobbies');
  if (error) throw error;
  return (data ?? []) as LobbyRow[];
}

/** Host-only: ask the Edge Function to build and start the authoritative game state. */
export async function rpcStartGame(
  lobbyId: string,
  turnTimeLimitSec?: number | null,
): Promise<LobbyGameState> {
  const { data, error } = await supabase.functions.invoke('resolve-turn', {
    body: { lobbyId, action: 'startGame', turnTimeLimitSec },
  });
  if (error) throw error;
  const resolved = (data as EdgeResolvedResponse | null)?.resolved;
  if (!resolved) throw new Error((data as EdgeResolvedResponse | null)?.error ?? 'startGame returned no state');
  return resolved;
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

/** Mark caller's seat as forfeited, award wins to remaining players, end the game. */
export async function rpcForfeitAndFinish(lobbyId: string): Promise<void> {
  await retryRpc('forfeit_and_finish', 'forfeit_and_finish', { p_lobby_id: lobbyId });
}
