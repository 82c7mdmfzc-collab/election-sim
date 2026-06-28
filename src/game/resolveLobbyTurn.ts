/**
 * resolveLobbyTurn — environment-agnostic, server-authoritative turn resolution.
 *
 * This is the single source of truth for resolving an online multiplayer turn.
 * It consumes the lobby's hidden `pendingSubmissions` and produces the next
 * RESOLUTION-phase `LobbyGameState`. It is pure (no Supabase / DOM / React deps)
 * so it can run BOTH in the app's test suite and inside the `resolve-turn`
 * Supabase Edge Function (which vendors a Deno-valid copy of src/game via
 * `npm run build:edge`).
 *
 * Running this on the server — instead of in the "host" browser — is what stops
 * a malicious host from doctoring a resolved state for their own lobby.
 */

import { resolveTurn } from './engine';
import { buildPendingSubmission, sanitizePendingSubmissions } from './lobbySecurity';
import { planBotTurn } from './bot';
import type { LobbyGameState, RoundPurchase } from './types';

export interface ResolveOutcome {
  resolved: LobbyGameState;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Resolve one online turn.
 *
 * @param remote  the lobby's current LobbyGameState (phase must be PLANNING).
 * @param force   when true, resolve even if not every active player submitted
 *                (the caller is responsible for only forcing after the turn
 *                deadline has genuinely passed).
 * @returns the resolved RESOLUTION-phase state, or `null` if the turn should
 *          not be resolved yet (not all active players have submitted, no force).
 */
export function resolveLobbyTurn(
  remote: LobbyGameState,
  force = false,
): ResolveOutcome | null {
  const active = remote.players.filter((p) => !p.eliminated);
  const activeHumans = active.filter((p) => !p.isBot);
  const allIn = activeHumans.every((p) => remote.submittedPlayers.includes(p.id));
  if (!force && !allIn) return null;

  const pendingSubmissions = sanitizePendingSubmissions(remote);
  for (const bot of active.filter((p) => p.isBot)) {
    const view = { ...remote, pendingByPlayer: pendingSubmissions };
    const rng = mulberry32(hashSeed(`${remote.hostPlayerId}:${remote.turn}:${bot.id}:${bot.botDifficulty ?? 'medium'}`));
    const intents = planBotTurn(view, bot.id, bot.botDifficulty ?? 'medium', rng)
      .map(({ kind, targetId, rungs }) => ({ kind, targetId, rungs }));
    pendingSubmissions[bot.id] = buildPendingSubmission(remote, bot.id, intents).pending;
  }

  // Flat purchase log (drives the RESOLUTION ticker overlay on every client).
  const lastRoundPurchases: RoundPurchase[] = active.flatMap((p) =>
    (pendingSubmissions[p.id] ?? []).map((pp) => ({
      playerId: p.id,
      candidateId: p.candidateId,
      kind: pp.kind,
      targetId: pp.targetId,
      rungsBought: pp.rungs,
      cost: pp.cost,
    })),
  );

  const { state: newState, report } = resolveTurn(remote, pendingSubmissions);

  const resolved: LobbyGameState = {
    ...newState,
    phase: 'RESOLUTION',
    activePlayerIndex: 0,
    electionResult: null,
    lastIncome: report.incomeByPlayer,
    lastTurnReport: report,
    lastRoundPurchases,
    prevDominance: remote.stateGroupDominance,
    electionTallyProgress: 0,
    hostPlayerId: remote.hostPlayerId,
    submittedPlayers: [],
    pendingSubmissions: {},
    turnTimeLimitSec: remote.turnTimeLimitSec,
  };

  return { resolved };
}
