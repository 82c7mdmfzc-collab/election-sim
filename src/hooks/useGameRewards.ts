/**
 * useGameRewards — grants Campaign Funds exactly once when a game ends.
 *
 * Mounted once at the App root (not inside VictoryPodium, which can remount).
 * Idempotency is keyed on the store's gameId via localPrefs, so the award fires
 * once per game even across React StrictMode double-invokes and page reloads on
 * the victory screen.
 *
 * Reward perspective ("owner" seat): online → the local player; otherwise the
 * human in seat 0. See rewards.ts for the rationale.
 */

import { useEffect } from 'react';
import { useGameStore } from '../game/store';
import { useProfile } from './useProfile';
import { getLastAwardedGameId, setLastAwardedGameId } from '../utils/localPrefs';

export function useGameRewards(): void {
  const phase = useGameStore((s) => s.phase);
  const gameId = useGameStore((s) => s.gameId);

  useEffect(() => {
    if (phase !== 'GAME_OVER' || !gameId) return;
    if (getLastAwardedGameId() === gameId) return; // already granted

    // Claim immediately so a re-render / StrictMode remount can't double-grant.
    setLastAwardedGameId(gameId);

    const s = useGameStore.getState();
    const ownerId =
      s.multiplayerMode === 'online' ? s.localPlayerId : s.players[0]?.id ?? null;
    if (!ownerId) return;

    const won = s.electionResult?.winner === ownerId;
    const securedStates = Object.values(s.securedBy).filter((pid) => pid === ownerId).length;
    const coalitionsDominated = Object.values(s.stateGroupDominance).filter((pid) => pid === ownerId).length;

    void useProfile.getState().applyGameResult({ gameId, won, securedStates, coalitionsDominated });
  }, [phase, gameId]);
}
