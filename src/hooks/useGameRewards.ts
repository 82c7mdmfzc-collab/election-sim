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
import { getLastAwardedGameId, setLastAwardedGameId, recordDailyChallengeResult } from '../utils/localPrefs';
import { clearGameTiming, gameDurationSeconds, track } from '../utils/analytics';
import { NATIONAL_GROUPS } from '../game/config';
import { dailyDateKey } from '../game/dailyChallenge';
import { recordDailyResultRemote } from '../game/profile';
import type { BotDifficulty } from '../game/types';

const inflightClaims = new Set<string>();
const finishedTracked = new Set<string>();
const dailyChallengeRecorded = new Set<string>();
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
    const nationalGroupsLed = NATIONAL_GROUPS.filter((g) => {
      const rungs = s.natRungs[g.id] ?? {};
      const myRungs = rungs[ownerId] ?? 0;
      const topRungs = Math.max(0, ...Object.values(rungs));
      return myRungs > 0 && myRungs === topRungs;
    });
    const nationalGroupsEarning = nationalGroupsLed.filter((g) => (s.natRungs[g.id]?.[ownerId] ?? 0) >= 4);
    const mode = s.multiplayerMode === 'online' ? 'online' : bots.length > 0 ? 'bot' : 'single';
    const botDifficulty = strongestDifficulty(bots.map((b) => b.botDifficulty).filter(Boolean) as BotDifficulty[]);

    if (!finishedTracked.has(gameId)) {
      finishedTracked.add(gameId);
      track('game_finished', {
        game_id: gameId,
        game_mode: mode,
        result: s.electionResult?.winner ? (won ? 'win' : 'loss') : 'hung',
        candidate_id: owner?.candidateId ?? 'unknown',
        final_ev_self: electoralVotes,
        final_ev_winner: s.electionResult?.winner ? (s.electionResult.evByPlayer[s.electionResult.winner] ?? 0) : 0,
        duration_seconds: gameDurationSeconds(gameId),
        turn_number: s.turn,
        secured_states: securedStates,
        state_groups_dominated: coalitionsDominated,
        national_groups_led: nationalGroupsLed.length,
        national_groups_earning: nationalGroupsEarning.length,
        bot_difficulty: botDifficulty,
        opponent_count: Math.max(0, s.players.length - 1),
      });
      clearGameTiming(gameId);
    }

    // Daily Challenge: record the result device-locally (guest-compatible) and
    // emit completion/win analytics. The Funds reward itself rides the normal
    // applyGameResult path below — no separate economy wiring.
    if (s.isDailyChallenge && !dailyChallengeRecorded.has(gameId)) {
      dailyChallengeRecorded.add(gameId);
      const dateKey = dailyDateKey();
      const local = recordDailyChallengeResult(dateKey, won, electoralVotes);
      track('daily_challenge_completed', {
        game_id: gameId,
        date_key: dateKey,
        won,
        final_ev_self: electoralVotes,
        streak: local.streak,
        candidate_id: owner?.candidateId ?? 'unknown',
        opponent_count: Math.max(0, s.players.length - 1),
        bot_difficulty: botDifficulty,
      });
      if (won) {
        track('daily_challenge_won', {
          game_id: gameId,
          date_key: dateKey,
          final_ev_self: electoralVotes,
          streak: local.streak,
          candidate_id: owner?.candidateId ?? 'unknown',
        });
      }
      // Cross-device: persist to the server too (fire-and-forget; never blocks the reward flow).
      if (useProfile.getState().userId) {
        void recordDailyResultRemote(dateKey, won, electoralVotes);
      }
    }

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
    }).then(({ breakdown, claimed }) => {
      if (claimed) setLastAwardedGameId(gameId);
      if (breakdown.total > 0) {
        track('funds_earned', {
          amount: breakdown.total,
          source: 'game_finish',
          claimed,
          game_mode: mode,
        });
      }
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
