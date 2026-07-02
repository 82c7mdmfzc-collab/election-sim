/**
 * connectionStatus — tiny global store for the online game's Realtime channel
 * health. Written by useMultiplayerSync (which owns reconnection), read by
 * GameShell to show a "Reconnecting…" banner so a connection blip mid-game is
 * visible instead of silently freezing the turn flow. Lives outside the game
 * store so a reconnect never touches persisted game state.
 */

import { create } from 'zustand';

export type ConnectionState = 'connected' | 'reconnecting';

interface ConnectionStatusStore {
  state: ConnectionState;
  setState: (state: ConnectionState) => void;
}

export const useConnectionStatus = create<ConnectionStatusStore>((set) => ({
  state: 'connected',
  setState: (state) => set({ state }),
}));

export const setConnectionState = (state: ConnectionState) =>
  useConnectionStatus.getState().setState(state);
