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
import type { BotDifficulty } from '../game/types';

const inflightClaims = new Set<string>();
const DIFFICULTY_RANK: Record<BotDifficulty, number> = { easy: 1, medium: 2, hard: 3 };

export function useGameRewards(): void {
  const phase = useGameStore((s) => s.phase);
  const gameId = useGameStore((s) => s.gameId);

  useEffect(() => {
    if (phase !== 'GAME_OVER' || !gameId) return;
    if (getLastAwardedGameId() === gameId) return; // already granted
    if (inflightClaims.has(gameId)) return;
    inflightClaims.add(gameId);

    const s = useGameStore.getState();
    const ownerId =
      s.multiplayerMode === 'online' ? s.localPlayerId : s.players[0]?.id ?? null;
    if (!ownerId) {
      inflightClaims.delete(gameId);
      return;
    }

    const owner = s.players.find((p) => p.id === ownerId) ?? null;
    const bots = s.players.filter((p) => p.isBot);
    const won = s.electionResult?.winner === ownerId;
    const electoralVotes = s.electionResult?.evByPlayer[ownerId] ?? 0;
    const securedStates = Object.values(s.securedBy).filter((pid) => pid === ownerId).length;
    const coalitionsDominated = Object.values(s.stateGroupDominance).filter((pid) => pid === ownerId).length;
    const mode = s.multiplayerMode === 'online' ? 'online' : bots.length > 0 ? 'bot' : 'single';
    const botDifficulty = strongestDifficulty(bots.map((b) => b.botDifficulty).filter(Boolean) as BotDifficulty[]);

    void useProfile.getState().applyGameResult({
      gameId,
      won,
      securedStates,
      coalitionsDominated,
      mode,
      botDifficulty,
      botCount: bots.length,
      turns: s.turn,
      electoralVotes,
      candidateId: owner?.candidateId ?? null,
      opponentCount: Math.max(0, s.players.length - 1),
    }).then(({ claimed }) => {
      if (claimed) setLastAwardedGameId(gameId);
    }).finally(() => {
      inflightClaims.delete(gameId);
    });
  }, [phase, gameId]);
}

function strongestDifficulty(difficulties: BotDifficulty[]): BotDifficulty | null {
  let best: BotDifficulty | null = null;
  for (const diff of difficulties) {
    if (!best || DIFFICULTY_RANK[diff] > DIFFICULTY_RANK[best]) best = diff;
  }
  return best;
}
