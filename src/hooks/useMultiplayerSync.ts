/**
 * useMultiplayerSync — Supabase Realtime subscription for online multiplayer.
 *
 * Subscribes to postgres_changes UPDATE events on the lobbies row for the
 * current lobbyId. On each event:
 *
 *   Host: if remote.phase is still PLANNING and all human players have submitted,
 *         calls resolveHostTurn (guarded by a ref to prevent double-resolution).
 *
 *   All:  for any non-PLANNING phase update, or when a new turn number arrives,
 *         calls syncFromPayload to mirror the host's state locally.
 *
 * Mounted exactly once via <MultiplayerSyncEffect /> inside GameShell when
 * multiplayerMode === 'online'. Unmounts cleanly by removing the channel.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '../utils/supabaseClient';
import { resolveHostTurn } from '../utils/multiplayerActions';
import { setConnectionState } from '../utils/connectionStatus';
import { notifyOnce } from '../utils/toast';
import { useGameStore } from '../game/store';
import type { LobbyGameState } from '../game/types';

export function useMultiplayerSync() {
  const lobbyId     = useGameStore((s) => s.lobbyId);
  const localId     = useGameStore((s) => s.localPlayerId);
  const hostId      = useGameStore((s) => s.hostPlayerId);
  const currentTurn = useGameStore((s) => s.turn);
  const phase       = useGameStore((s) => s.phase);
  const turnDeadline = useGameStore((s) => s.turnDeadline);
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const syncFromPayload = useGameStore((s) => s.syncFromPayload);

  // Tracks which turn the host has already resolved to prevent double-firing
  // if Realtime delivers the same all-submitted event twice (e.g. on reconnect).
  const resolvedForRef = useRef<string | null>(null);
  const forceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lobbyId) return;

    // A dropped Realtime channel used to be logged and then left dead, so a guest
    // could sit forever on "Waiting for others…" after a blip. We now auto-reconnect
    // with backoff until the effect unmounts.
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      channel = supabase
        .channel(`lobby:${lobbyId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'lobbies',
            filter: `id=eq.${lobbyId}`,
          },
          (payload) => {
            const remote = (payload.new as { game_state?: LobbyGameState }).game_state;
            if (!remote) return;

            const isHost = localId === hostId;

            // ── Host path: detect all-submitted → resolve ──────────────────────
            if (isHost && remote.phase === 'PLANNING') {
              const active = remote.players.filter((p) => !p.eliminated && !p.isBot);
              const allIn  = active.every((p) => remote.submittedPlayers.includes(p.id));
              const key    = `${remote.turn}:resolved`;

              if (allIn && resolvedForRef.current !== key) {
                resolvedForRef.current = key;
                void resolveHostTurn(lobbyId, (resolved) => syncFromPayload(resolved));
              } else {
                // Not everyone is in yet — mirror who's ready so the host's waiting
                // list shows each guest flip to "Ready ✓" as their submission lands.
                useGameStore.getState().mergeSubmittedFromRemote(remote.turn, remote.submittedPlayers);
              }
              return;
            }

            // ── All clients: apply phase transitions and new turns ─────────────
            // Ignore stale PLANNING events from an already-seen turn, but still
            // mirror the live "who's submitted" list so opponents flip from
            // "Thinking…" to "Ready ✓" as their submissions land this turn.
            if (remote.phase === 'PLANNING' && remote.turn <= currentTurn) {
              useGameStore.getState().mergeSubmittedFromRemote(remote.turn, remote.submittedPlayers);
              return;
            }

            syncFromPayload(remote);
          },
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            // Surface the recovery only after an actual drop (retry > 0), not
            // on the initial subscribe.
            if (retry > 0) notifyOnce('info', 'Back online — game synced.');
            retry = 0;
            setConnectionState('connected');
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (cancelled) return;
            console.error(`[multiplayer] Realtime ${status} for lobby ${lobbyId} — reconnecting`);
            setConnectionState('reconnecting');
            if (channel) { supabase.removeChannel(channel); channel = null; }
            if (reconnectTimer) clearTimeout(reconnectTimer);
            const delay = Math.min(800 * 2 ** retry, 8000);
            retry += 1;
            reconnectTimer = setTimeout(connect, delay);
          }
        });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (channel) supabase.removeChannel(channel);
      setConnectionState('connected'); // never leave a stale banner behind
    };
  // resolvedForRef is stable; omit to avoid unnecessary re-subscriptions.
  }, [lobbyId, localId, hostId, currentTurn, syncFromPayload]);

  // Host-only: force-resolve after turnDeadline + 5s grace if phase is still PLANNING.
  // Handles the case where one or more players disconnect before submitting.
  useEffect(() => {
    if (multiplayerMode !== 'online') return;
    if (localId !== hostId) return;
    if (!turnDeadline || !lobbyId) return;
    if (phase !== 'PLANNING') return;

    const delay = turnDeadline + 5_000 - Date.now();
    if (delay <= 0) return;

    const t = window.setTimeout(() => {
      const key = `${currentTurn}:force`;
      if (forceKeyRef.current === key) return;
      forceKeyRef.current = key;
      void resolveHostTurn(lobbyId, syncFromPayload, true);
    }, delay);
    return () => clearTimeout(t);
  }, [turnDeadline, phase, currentTurn, multiplayerMode, localId, hostId, lobbyId, syncFromPayload]);
}
