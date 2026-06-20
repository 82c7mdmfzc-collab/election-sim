import {
  applyWalletDraw,
  bestAffinityForState,
  calcNationalCost,
  calcStateCost,
  computeWalletSplit,
  validatePurchase,
} from './engine';
import { CANDIDATE_MAP } from './candidates';
import { createInitialGameStateFromPlayers, ALL_STATES, playerFromCandidate } from './statesData';
import { STATE_GROUPS } from './config';
import type { LobbyGameState, PendingPurchase, PlayerState, PurchaseIntent, WaitingLobbyState } from './types';

const MAX_INTENTS_PER_TURN = 100;
const ALLOWED_TURN_LIMITS = new Set([30, 60, 120]);

function isPurchaseKind(v: unknown): v is PurchaseIntent['kind'] {
  return v === 'state' || v === 'national';
}

export function normalizePurchaseIntents(raw: unknown): PurchaseIntent[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_INTENTS_PER_TURN) return null;
  const intents: PurchaseIntent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (!isPurchaseKind(rec.kind)) return null;
    if (typeof rec.targetId !== 'string' || rec.targetId.length < 1 || rec.targetId.length > 64) {
      return null;
    }
    if (!Number.isInteger(rec.rungs) || (rec.rungs as number) < 1 || (rec.rungs as number) > 16) {
      return null;
    }
    intents.push({ kind: rec.kind, targetId: rec.targetId, rungs: rec.rungs as number });
  }
  return intents;
}

function cloneWorkingPlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    groupWallets: { ...player.groupWallets },
  };
}

export function buildPendingSubmission(
  state: LobbyGameState,
  playerId: string,
  intents: readonly PurchaseIntent[],
): { pending: PendingPurchase[]; error?: string } {
  if (state.phase !== 'PLANNING') return { pending: [], error: 'not planning' };

  const player = state.players.find((p) => p.id === playerId && !p.eliminated);
  if (!player) return { pending: [], error: 'unknown player' };
  if (intents.length > MAX_INTENTS_PER_TURN) return { pending: [], error: 'too many purchases' };

  const working = cloneWorkingPlayer(player);
  const pending: PendingPurchase[] = [];

  for (const intent of intents) {
    if (!isPurchaseKind(intent.kind)) return { pending: [], error: 'invalid purchase kind' };
    if (!Number.isInteger(intent.rungs) || intent.rungs < 1 || intent.rungs > 16) {
      return { pending: [], error: 'invalid rung count' };
    }

    const startRung =
      intent.kind === 'state'
        ? (state.rungs[intent.targetId]?.[playerId] ?? 0)
        : (state.natRungs[intent.targetId]?.[playerId] ?? 0);
    const pendingRungs = pending
      .filter((p) => p.kind === intent.kind && p.targetId === intent.targetId)
      .reduce((sum, p) => sum + p.rungs, 0);

    const invalid = validatePurchase(working, 0, {
      kind: intent.kind,
      targetId: intent.targetId,
      rungsToBuy: intent.rungs,
      startRung,
      pendingRungs,
    });
    if (invalid) return { pending: [], error: invalid.reason };

    let cost: number;
    let walletDraw: PendingPurchase['walletDraw'];

    if (intent.kind === 'state') {
      const usState = ALL_STATES.find((s) => s.id === intent.targetId);
      if (!usState) return { pending: [], error: 'unknown state' };
      const discount = bestAffinityForState(working, intent.targetId);
      cost = calcStateCost(
        intent.targetId,
        usState.baseCampaignCost,
        startRung + pendingRungs,
        intent.rungs,
        discount,
      );
      const split = computeWalletSplit(working, intent.targetId, cost);
      if (!split) return { pending: [], error: 'insufficient funds' };
      walletDraw = split.walletDraw;
    } else {
      cost = calcNationalCost(intent.targetId, startRung + pendingRungs, intent.rungs, working);
      if (!Number.isFinite(cost) || cost > working.nationalCash) {
        return { pending: [], error: 'insufficient national cash' };
      }
      walletDraw = cost > 0 ? [{ wallet: 'NATIONAL', amount: cost }] : [];
    }

    applyWalletDraw(working, walletDraw);
    pending.push({ kind: intent.kind, targetId: intent.targetId, rungs: intent.rungs, cost, walletDraw });
  }

  return { pending };
}

export function sanitizePendingSubmissions(
  state: LobbyGameState,
): Record<string, PendingPurchase[]> {
  const sanitized: Record<string, PendingPurchase[]> = {};
  for (const player of state.players.filter((p) => !p.eliminated)) {
    const raw = state.pendingSubmissions[player.id] ?? [];
    const intents = normalizePurchaseIntents(raw.map((p) => ({
      kind: p?.kind,
      targetId: p?.targetId,
      rungs: p?.rungs,
    })));
    if (!intents) {
      sanitized[player.id] = [];
      continue;
    }
    sanitized[player.id] = buildPendingSubmission(state, player.id, intents).pending;
  }
  return sanitized;
}

export function normalizeTurnTimeLimit(raw: unknown): number | null {
  if (raw == null) return null;
  if (!Number.isInteger(raw) || !ALLOWED_TURN_LIMITS.has(raw as number)) return null;
  return raw as number;
}

export function buildLobbyGameStateFromWaiting(
  waiting: WaitingLobbyState,
  nowMs = Date.now(),
  turnTimeLimitSec: number | null = null,
): LobbyGameState | null {
  if (!Array.isArray(waiting.players) || waiting.players.length < 2 || waiting.players.length > 4) {
    return null;
  }
  if (!waiting.players.some((p) => p.id === waiting.hostPlayerId && p.isHost)) return null;

  const seenCandidates = new Set<string>();
  const players: PlayerState[] = [];
  for (const wp of waiting.players) {
    const candidate = CANDIDATE_MAP[wp.candidateId];
    if (!candidate || seenCandidates.has(wp.candidateId)) return null;
    if (typeof wp.id !== 'string' || typeof wp.name !== 'string') return null;
    seenCandidates.add(wp.candidateId);
    players.push(playerFromCandidate(candidate, { id: wp.id, name: wp.name }));
  }

  const core = createInitialGameStateFromPlayers(players);
  const limit = normalizeTurnTimeLimit(turnTimeLimitSec);
  return {
    ...core,
    phase: 'PLANNING',
    activePlayerIndex: 0,
    electionResult: null,
    lastIncome: Object.fromEntries(players.map((p) => [p.id, 0])),
    lastTurnReport: null,
    lastRoundPurchases: [],
    prevDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
    electionTallyProgress: 0,
    hostPlayerId: waiting.hostPlayerId,
    submittedPlayers: [],
    pendingSubmissions: {},
    turnDeadlineUtc: limit != null ? nowMs + limit * 1000 : null,
    turnTimeLimitSec: limit,
  };
}
