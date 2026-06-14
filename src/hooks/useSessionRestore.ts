import { useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { loadSession, clearSession } from '../utils/sessionStore';
import { useGameStore } from '../game/store';
import type { LobbyGameState } from '../game/types';

/**
 * Mount-once hook that restores an interrupted online session after a page refresh.
 * Only fires when multiplayerMode is 'online' but localPlayerId is null — the exact
 * condition after a refresh wipes session identity from the excluded Zustand fields.
 */
export function useSessionRestore(): void {
  const setMultiplayerMeta = useGameStore((s) => s.setMultiplayerMeta);
  const syncFromPayload = useGameStore((s) => s.syncFromPayload);
  const clearMultiplayerMeta = useGameStore((s) => s.clearMultiplayerMeta);

  useEffect(() => {
    const snap = useGameStore.getState();
    if (snap.multiplayerMode !== 'online' || snap.localPlayerId !== null) return;

    const session = loadSession();
    if (!session) {
      clearMultiplayerMeta();
      return;
    }

    supabase
      .from('lobbies')
      .select('game_state, status')
      .eq('id', session.lobbyId)
      .single()
      .then(({ data, error }) => {
        if (error || !data || data.status !== 'in_progress') {
          clearSession();
          clearMultiplayerMeta();
          return;
        }
        const gs = data.game_state as LobbyGameState;
        if (!gs.players.find((p) => p.id === session.localPlayerId)) {
          clearSession();
          clearMultiplayerMeta();
          return;
        }
        setMultiplayerMeta({
          lobbyId: session.lobbyId,
          localPlayerId: session.localPlayerId,
          hostPlayerId: gs.hostPlayerId,
        });
        syncFromPayload(gs);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
