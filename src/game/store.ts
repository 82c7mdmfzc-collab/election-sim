/**
 * Zustand store — single source of truth for all mutable game state.
 *
 * Phase machine:
 *   PLANNING → (each player submits) → RESOLUTION
 *   RESOLUTION → (confirmResolution) → PLANNING [or ELECTION]
 *   ELECTION → (resolveElection) → PLANNING [or ELECTION_TALLY]
 *   ELECTION_TALLY → (completeTally) → GAME_OVER
 *
 * Hot-seat mode (multiplayerMode='single'):
 *   activePlayerIndex walks the player list. HandoffCurtain enforces turn privacy.
 *
 * Online mode (multiplayerMode='online'):
 *   All players allocate simultaneously. localPlayerId identifies this device's
 *   player. The host collects all pendingSubmissions, runs resolveTurn, and pushes
 *   the resolved state to Supabase. Guests receive it via Realtime → syncFromPayload.
 *   Phase transitions (confirmResolution, resolveElection, completeTally) are
 *   host-only — guests are blocked by a guard and receive the new phase via Realtime.
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AudioManager } from '../utils/audioManager';
import { assignPlayerColors, type ResolvedColor } from './colors';
import {
  resolveTurn,
  rollElection,
  resolveElection as engineResolveElection,
  tallyElectoralVotes,
  validatePurchase,
  bestAffinityForState,
  calcStateCost,
  calcNationalCost,
  computeWalletSplit,
} from './engine';
import { createInitialGameState, createInitialGameStateFromPlayers, ALL_STATES } from './statesData';
import { STATE_GROUPS } from './config';
import { rpcPushGameState, rpcSetLobbyStatus } from '../utils/supabaseClient';
import { pushMySubmission, resolveHostTurn } from '../utils/multiplayerActions';
import { saveSession, clearSession } from '../utils/sessionStore';
import type { CandidateDef } from './candidates';
import type {
  BotDifficulty,
  ElectoralResult,
  GamePhase,
  GameState,
  LobbyGameState,
  PendingPurchase,
  PlayerState,
  RoundPurchase,
  TurnReport,
} from './types';

// Re-export so existing imports of GamePhase from this module still compile.
export type { GamePhase } from './types';

// ── Working-cash snapshot (applied during allocation, before resolution) ──────
interface WorkingCash {
  nationalCash: number;
  groupWallets: Record<string, number>;
}

// ── Store shape ───────────────────────────────────────────────────────────────

interface GameStore extends GameState {
  phase: GamePhase;
  activePlayerIndex: number;
  pendingByPlayer: Record<string, PendingPurchase[]>;
  workingCash: Record<string, WorkingCash>;
  submitted: Record<string, boolean>;
  electionResult: ElectoralResult | null;
  lastIncome: Record<string, number>;
  lastTurnReport: TurnReport | null;
  lastRoundPurchases: RoundPurchase[];
  prevDominance: Record<string, string | null>;
  electionTallyProgress: number;
  resolutionTickerDone: boolean;
  hasSubmittedLocalTurn: boolean;

  /** Unique id for the current game, set at start. Keys the once-per-game reward. */
  gameId: string | null;

  // ── Multiplayer ──────────────────────────────────────────────────────────────
  /** 'single' = hot-seat (default), 'online' = Supabase realtime. Persisted. */
  multiplayerMode: 'single' | 'online';
  /** Player ID this device controls in online mode. NOT persisted. */
  localPlayerId: string | null;
  /** Supabase lobby UUID for the current online session. NOT persisted. */
  lobbyId: string | null;
  /** Player ID designated as host (runs resolveTurn). NOT persisted. */
  hostPlayerId: string | null;
  /** Player IDs that have clicked End Turn this round (online mode). NOT persisted. */
  submittedPlayers: string[];

  // ── Turn timer ───────────────────────────────────────────────────────────────
  turnTimeLimit: number | null;
  turnDeadline: number | null;
  handoffAckKey: string | null;

  // ── Actions ─────────────────────────────────────────────────────────────────
  initOnlineGame(players: PlayerState[]): void;
  /**
   * Start a hot-seat / vs-Bot game. `botSeats` maps a chosen candidate's id to a
   * bot difficulty; those seats become AI-controlled (single-player only).
   */
  startGame(
    chosen: CandidateDef[],
    turnTimeLimit?: number | null,
    botSeats?: Record<string, BotDifficulty>,
  ): void;
  allocate(kind: 'state' | 'national', targetId: string, rungs: number): boolean;
  cancelAllocation(kind: 'state' | 'national', targetId: string): void;
  submitTurn(): void;
  confirmResolution(): void;
  dismissResolutionTicker(): void;
  resolveElection(): void;
  advanceTallyProgress(): void;
  completeTally(): void;
  reset(): void;
  abortGame(): void;
  returnToMenu(): void;

  // ── Multiplayer actions ──────────────────────────────────────────────────────
  /** Set session metadata after joining/creating a lobby. */
  setMultiplayerMeta(meta: {
    lobbyId: string;
    localPlayerId: string;
    hostPlayerId: string;
  }): void;
  /**
   * Accept a fully resolved game state pushed from Supabase.
   * Rebuilds derived state (workingCash, pendingByPlayer) and preserves session
   * identity fields (localPlayerId, lobbyId, hostPlayerId, multiplayerMode).
   */
  syncFromPayload(payload: LobbyGameState): void;
  /**
   * Live-update the "who's ready" list during an in-progress PLANNING turn,
   * without disturbing turn/phase/cash. Lets every client reflect opponents'
   * submissions as they arrive (the waiting-room "Thinking…/Ready ✓" badges).
   */
  mergeSubmittedFromRemote(turn: number, submitted: string[]): void;
  /** Clear online session and return to single-player defaults. */
  clearMultiplayerMeta(): void;

  // ── Turn-timer actions ───────────────────────────────────────────────────────
  setTurnTimeLimit(seconds: number | null): void;
  armTurnDeadline(now?: number): void;
  pauseTurnDeadline(): void;
  acknowledgeHandoff(now?: number): void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWorkingCash(players: PlayerState[]): Record<string, WorkingCash> {
  const m: Record<string, WorkingCash> = {};
  for (const p of players) {
    m[p.id] = { nationalCash: p.nationalCash, groupWallets: { ...p.groupWallets } };
  }
  return m;
}

function emptyPending(players: PlayerState[]): Record<string, PendingPurchase[]> {
  return Object.fromEntries(players.map((p) => [p.id, []]));
}

function emptySubmitted(players: PlayerState[]): Record<string, boolean> {
  return Object.fromEntries(players.map((p) => [p.id, false]));
}

/** Unique-enough id for one game session — keys the once-per-game reward grant. */
function newGameId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function activePlayers(players: PlayerState[]): PlayerState[] {
  return players.filter((p) => !p.eliminated);
}

/** Returns the player this device should operate as (local in online; activeIndex in hot-seat). */
function localPlayer(s: GameStore): PlayerState | null {
  if (s.multiplayerMode === 'online' && s.localPlayerId) {
    return s.players.find((p) => p.id === s.localPlayerId && !p.eliminated) ?? null;
  }
  return activePlayers(s.players)[s.activePlayerIndex] ?? null;
}

/** Snapshots store fields into the LobbyGameState shape for Supabase writes. */
function buildLobbySnapshot(s: GameStore): LobbyGameState {
  return {
    turn: s.turn,
    seqCounter: s.seqCounter,
    players: s.players,
    rungs: s.rungs,
    natRungs: s.natRungs,
    reachSeq: s.reachSeq,
    natReachSeq: s.natReachSeq,
    securedBy: s.securedBy,
    natSecuredBy: s.natSecuredBy,
    stateGroupDominance: s.stateGroupDominance,
    hungColleges: s.hungColleges,
    phase: s.phase,
    activePlayerIndex: s.activePlayerIndex,
    electionResult: s.electionResult,
    lastIncome: s.lastIncome,
    lastTurnReport: s.lastTurnReport,
    lastRoundPurchases: s.lastRoundPurchases,
    prevDominance: s.prevDominance,
    electionTallyProgress: s.electionTallyProgress,
    hostPlayerId: s.hostPlayerId ?? '',
    submittedPlayers: s.submittedPlayers,
    pendingSubmissions: {},
    turnDeadlineUtc: s.turnDeadline,
  };
}

/** Push the current store's phase state to Supabase after a phase transition. Host only. */
function pushPhaseToSupabase(s: GameStore): void {
  if (s.multiplayerMode !== 'online' || !s.lobbyId) return;
  // Host-only push via SECURITY DEFINER RPC (server verifies host_uid).
  void rpcPushGameState(s.lobbyId, buildLobbySnapshot(s));
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => {
      const initial = createInitialGameState();

      return {
        ...initial,
        phase: 'SETUP',
        activePlayerIndex: 0,
        pendingByPlayer: emptyPending(initial.players),
        workingCash: buildWorkingCash(initial.players),
        submitted: emptySubmitted(initial.players),
        electionResult: null,
        lastIncome: Object.fromEntries(initial.players.map((p) => [p.id, 0])),
        lastTurnReport: null,
        lastRoundPurchases: [],
        prevDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
        electionTallyProgress: 0,
        resolutionTickerDone: false,
        hasSubmittedLocalTurn: false,
        gameId: null,
        multiplayerMode: 'single',
        localPlayerId: null,
        lobbyId: null,
        hostPlayerId: null,
        submittedPlayers: [],
        turnTimeLimit: null,
        turnDeadline: null,
        handoffAckKey: null,

        // ── startGame ─────────────────────────────────────────────────────────
        startGame(chosen, turnTimeLimit, botSeats) {
          const fresh = createInitialGameState(chosen);
          // Tag AI seats (single-player vs-Bot). Player ids equal candidate ids
          // here, and every other map keys by id, so this is a safe overlay.
          const players = botSeats
            ? fresh.players.map((p) =>
                botSeats[p.candidateId]
                  ? { ...p, isBot: true, botDifficulty: botSeats[p.candidateId] }
                  : p,
              )
            : fresh.players;
          set({
            ...fresh,
            players,
            gameId: newGameId(),
            phase: 'PLANNING',
            activePlayerIndex: 0,
            pendingByPlayer: emptyPending(fresh.players),
            workingCash: buildWorkingCash(fresh.players),
            submitted: emptySubmitted(fresh.players),
            electionResult: null,
            lastIncome: Object.fromEntries(fresh.players.map((p) => [p.id, 0])),
            lastTurnReport: null,
            lastRoundPurchases: [],
            prevDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
            resolutionTickerDone: false,
            hasSubmittedLocalTurn: false,
            turnTimeLimit: turnTimeLimit ?? get().turnTimeLimit ?? null,
            turnDeadline: null,
            handoffAckKey: '1:0',
          });
        },

        // ── allocate ──────────────────────────────────────────────────────────
        allocate(kind, targetId, rungs) {
          const snap = get();
          if (snap.phase !== 'PLANNING') return false;

          const player = localPlayer(snap);
          if (!player) return false;

          const wc = snap.workingCash[player.id];
          if (!wc) return false;

          const startRung =
            kind === 'state'
              ? (snap.rungs[targetId]?.[player.id] ?? 0)
              : (snap.natRungs[targetId]?.[player.id] ?? 0);

          const pendingForTarget = (snap.pendingByPlayer[player.id] ?? []).filter(
            (p) => p.targetId === targetId,
          );
          const pendingRungs = pendingForTarget.reduce((s, p) => s + p.rungs, 0);
          const pendingCost = (snap.pendingByPlayer[player.id] ?? []).reduce(
            (s, p) => s + p.cost,
            0,
          );

          const playerProxy: PlayerState = {
            ...player,
            nationalCash: wc.nationalCash,
            groupWallets: wc.groupWallets,
          };

          const err = validatePurchase(playerProxy, pendingCost, {
            kind,
            targetId,
            rungsToBuy: rungs,
            startRung,
            pendingRungs,
          });
          if (err) {
            console.warn('allocate rejected:', err.reason);
            return false;
          }

          let cost: number;
          let walletDraw: PendingPurchase['walletDraw'];

          if (kind === 'state') {
            const usState = ALL_STATES.find((s) => s.id === targetId)!;
            const discount = bestAffinityForState(playerProxy, targetId);
            cost = calcStateCost(targetId, usState.baseCampaignCost, startRung + pendingRungs, rungs, discount);
            const split = computeWalletSplit(playerProxy, targetId, cost);
            if (!split) return false;
            walletDraw = split.walletDraw;
          } else {
            cost = calcNationalCost(targetId, startRung + pendingRungs, rungs, playerProxy);
            walletDraw = [{ wallet: 'NATIONAL', amount: cost }];
          }

          const nextWc = {
            nationalCash: wc.nationalCash,
            groupWallets: { ...wc.groupWallets },
          };
          for (const draw of walletDraw) {
            if (draw.wallet === 'NATIONAL') {
              nextWc.nationalCash -= draw.amount;
            } else {
              nextWc.groupWallets[draw.wallet] = (nextWc.groupWallets[draw.wallet] ?? 0) - draw.amount;
            }
          }

          const purchase: PendingPurchase = { kind, targetId, rungs, cost, walletDraw };

          set((s) => ({
            pendingByPlayer: {
              ...s.pendingByPlayer,
              [player.id]: [...(s.pendingByPlayer[player.id] ?? []), purchase],
            },
            workingCash: { ...s.workingCash, [player.id]: nextWc },
          }));
          return true;
        },

        // ── cancelAllocation ─────────────────────────────────────────────────
        cancelAllocation(kind, targetId) {
          const snap = get();
          if (snap.phase !== 'PLANNING') return;
          const player = localPlayer(snap);
          if (!player) return;

          const pending = snap.pendingByPlayer[player.id] ?? [];
          const toRemove = pending.filter((p) => p.kind === kind && p.targetId === targetId);
          if (toRemove.length === 0) return;

          const newPending = pending.filter((p) => !(p.kind === kind && p.targetId === targetId));
          const freshWc: WorkingCash = {
            nationalCash: player.nationalCash,
            groupWallets: { ...player.groupWallets },
          };
          for (const p of newPending) {
            for (const d of p.walletDraw) {
              if (d.wallet === 'NATIONAL') freshWc.nationalCash -= d.amount;
              else freshWc.groupWallets[d.wallet] = (freshWc.groupWallets[d.wallet] ?? 0) - d.amount;
            }
          }

          set((s) => ({
            pendingByPlayer: { ...s.pendingByPlayer, [player.id]: newPending },
            workingCash: { ...s.workingCash, [player.id]: freshWc },
          }));
        },

        // ── submitTurn ───────────────────────────────────────────────────────
        submitTurn() {
          const snap = get();
          if (snap.phase !== 'PLANNING') return;

          // ── Online mode: push pending; host resolves when all submitted ────
          if (snap.multiplayerMode === 'online') {
            const { localPlayerId, lobbyId, hostPlayerId } = snap;
            if (!localPlayerId || !lobbyId) return;
            if (snap.submittedPlayers.includes(localPlayerId)) return;

            const myPending = snap.pendingByPlayer[localPlayerId] ?? [];
            const nextSubmitted = [...snap.submittedPlayers, localPlayerId];

            // Optimistic local update so the "Waiting for others…" UI renders immediately
            set({ submittedPlayers: nextSubmitted, hasSubmittedLocalTurn: true });

            // Atomic merge via Postgres RPC (prevents race with simultaneous submits)
            void pushMySubmission(lobbyId, localPlayerId, myPending, nextSubmitted);

            // If this device is the host AND everyone is now in, resolve immediately
            // without waiting for the Realtime round-trip.
            const allDone = snap.players
              .filter((p) => !p.eliminated)
              .every((p) => nextSubmitted.includes(p.id));

            if (allDone && localPlayerId === hostPlayerId) {
              void resolveHostTurn(lobbyId, (resolved) => get().syncFromPayload(resolved));
            }
            return;
          }

          // ── Hot-seat mode: original logic ─────────────────────────────────
          const active = activePlayers(snap.players);
          const player = active[snap.activePlayerIndex];
          if (!player) return;

          const nextSubmitted = { ...snap.submitted, [player.id]: true };
          const nextIndex = snap.activePlayerIndex + 1;

          if (nextIndex < active.length) {
            set({ submitted: nextSubmitted, activePlayerIndex: nextIndex, turnDeadline: null });
            return;
          }

          const lastRoundPurchases: RoundPurchase[] = activePlayers(snap.players).flatMap((p) =>
            (snap.pendingByPlayer[p.id] ?? []).map((pp) => ({
              playerId: p.id,
              candidateId: p.candidateId,
              kind: pp.kind,
              targetId: pp.targetId,
              rungsBought: pp.rungs,
              cost: pp.cost,
            }))
          );
          const { state: newState, report } = resolveTurn(snap, snap.pendingByPlayer);
          set({
            ...newState,
            phase: 'RESOLUTION',
            activePlayerIndex: 0,
            pendingByPlayer: emptyPending(newState.players),
            workingCash: buildWorkingCash(newState.players),
            submitted: emptySubmitted(newState.players),
            lastIncome: report.incomeByPlayer,
            lastTurnReport: report,
            lastRoundPurchases,
            prevDominance: snap.stateGroupDominance,
            resolutionTickerDone: false,
          });
        },

        // ── dismissResolutionTicker ──────────────────────────────────────────
        dismissResolutionTicker() {
          set({ resolutionTickerDone: true });
        },

        // ── confirmResolution ────────────────────────────────────────────────
        confirmResolution() {
          const snap = get();
          if (snap.phase !== 'RESOLUTION') return;
          if (snap.multiplayerMode === 'online' && snap.localPlayerId !== snap.hostPlayerId) return;

          if (rollElection(snap)) {
            const result = tallyElectoralVotes(snap);
            set({ electionResult: result, phase: 'ELECTION' });
          } else {
            const newDeadline = snap.turnTimeLimit != null ? Date.now() + snap.turnTimeLimit * 1000 : null;
            set((s) => ({
              phase: 'PLANNING',
              turn: s.turn + 1,
              activePlayerIndex: 0,
              pendingByPlayer: emptyPending(s.players),
              workingCash: buildWorkingCash(s.players),
              submitted: emptySubmitted(s.players),
              submittedPlayers: [],
              hasSubmittedLocalTurn: false,
              handoffAckKey: `${s.turn + 1}:0`,
              turnDeadline: newDeadline,
            }));
            AudioManager.play('round_end');
          }

          pushPhaseToSupabase(get());
        },

        // ── resolveElection ──────────────────────────────────────────────────
        resolveElection() {
          const snap = get();
          if (snap.phase !== 'ELECTION' || !snap.electionResult) return;
          if (snap.multiplayerMode === 'online' && snap.localPlayerId !== snap.hostPlayerId) return;

          const outcome = engineResolveElection(snap);

          if (outcome.type === 'winner') {
            set({ phase: 'ELECTION_TALLY', electionTallyProgress: 0 });
            pushPhaseToSupabase(get());
            return;
          }

          if (outcome.type === 'hung') {
            const newDeadline = snap.turnTimeLimit != null ? Date.now() + snap.turnTimeLimit * 1000 : null;
            set((s) => ({
              hungColleges: s.hungColleges + 1,
              electionResult: null,
              phase: 'PLANNING',
              turn: s.turn + 1,
              activePlayerIndex: 0,
              pendingByPlayer: emptyPending(s.players),
              workingCash: buildWorkingCash(s.players),
              submitted: emptySubmitted(s.players),
              submittedPlayers: [],
              hasSubmittedLocalTurn: false,
              handoffAckKey: `${s.turn + 1}:0`,
              turnDeadline: newDeadline,
            }));
            pushPhaseToSupabase(get());
            return;
          }

          // Elimination
          const nextState = outcome.nextState!;
          const remaining = activePlayers(nextState.players);

          if (remaining.length <= 1) {
            const winnerId = remaining[0]?.id ?? null;
            set({
              ...nextState,
              electionResult: winnerId
                ? { ...outcome.result, winner: winnerId }
                : outcome.result,
              phase: 'ELECTION_TALLY',
              electionTallyProgress: 0,
            });
            pushPhaseToSupabase(get());
            return;
          }

          const elimDeadline = snap.turnTimeLimit != null ? Date.now() + snap.turnTimeLimit * 1000 : null;
          set({
            ...nextState,
            electionResult: null,
            phase: 'PLANNING',
            turn: nextState.turn + 1,
            activePlayerIndex: 0,
            pendingByPlayer: emptyPending(nextState.players),
            workingCash: buildWorkingCash(nextState.players),
            submitted: emptySubmitted(nextState.players),
            handoffAckKey: `${nextState.turn + 1}:0`,
            turnDeadline: elimDeadline,
          });
          pushPhaseToSupabase(get());
        },

        // ── advanceTallyProgress ─────────────────────────────────────────────
        advanceTallyProgress() {
          set((s) => ({ electionTallyProgress: s.electionTallyProgress + 1 }));
        },

        // ── completeTally ────────────────────────────────────────────────────
        completeTally() {
          const snap = get();
          if (snap.multiplayerMode === 'online' && snap.localPlayerId !== snap.hostPlayerId) return;
          set({ phase: 'GAME_OVER' });
          pushPhaseToSupabase(get());
        },

        // ── reset ────────────────────────────────────────────────────────────
        reset() {
          const fresh = createInitialGameState();
          set({
            ...fresh,
            phase: 'SETUP',
            activePlayerIndex: 0,
            pendingByPlayer: emptyPending(fresh.players),
            workingCash: buildWorkingCash(fresh.players),
            submitted: emptySubmitted(fresh.players),
            electionResult: null,
            lastIncome: Object.fromEntries(fresh.players.map((p) => [p.id, 0])),
            lastTurnReport: null,
            lastRoundPurchases: [],
            prevDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
            electionTallyProgress: 0,
            resolutionTickerDone: false,
            hasSubmittedLocalTurn: false,
            multiplayerMode: 'single',
            localPlayerId: null,
            lobbyId: null,
            hostPlayerId: null,
            submittedPlayers: [],
            turnTimeLimit: null,
            turnDeadline: null,
            handoffAckKey: null,
          });
        },

        // ── abortGame ────────────────────────────────────────────────────────
        abortGame() {
          AudioManager.stop('tick');
          clearSession();
          const snap = get();
          // Mark the online lobby as finished before leaving (host-only, server-enforced)
          if (snap.multiplayerMode === 'online' && snap.lobbyId) {
            void rpcSetLobbyStatus(snap.lobbyId, 'finished');
          }
          const fresh = createInitialGameState();
          set({
            ...fresh,
            phase: 'MENU',
            activePlayerIndex: 0,
            pendingByPlayer: emptyPending(fresh.players),
            workingCash: buildWorkingCash(fresh.players),
            submitted: emptySubmitted(fresh.players),
            electionResult: null,
            lastIncome: Object.fromEntries(fresh.players.map((p) => [p.id, 0])),
            lastTurnReport: null,
            lastRoundPurchases: [],
            prevDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
            electionTallyProgress: 0,
            resolutionTickerDone: false,
            hasSubmittedLocalTurn: false,
            multiplayerMode: 'single',
            localPlayerId: null,
            lobbyId: null,
            hostPlayerId: null,
            submittedPlayers: [],
            turnTimeLimit: null,
            turnDeadline: null,
            handoffAckKey: null,
          });
          AudioManager.play('quit');
        },

        // ── returnToMenu ─────────────────────────────────────────────────────
        returnToMenu() {
          AudioManager.stop('tick');
          const snap = get();
          if (snap.multiplayerMode === 'online' && snap.lobbyId) {
            void rpcSetLobbyStatus(snap.lobbyId, 'finished');
          }
          clearSession();
          const fresh = createInitialGameState();
          set({
            ...fresh,
            phase: 'MENU',
            activePlayerIndex: 0,
            pendingByPlayer: emptyPending(fresh.players),
            workingCash: buildWorkingCash(fresh.players),
            submitted: emptySubmitted(fresh.players),
            electionResult: null,
            lastIncome: Object.fromEntries(fresh.players.map((p) => [p.id, 0])),
            lastTurnReport: null,
            lastRoundPurchases: [],
            prevDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
            electionTallyProgress: 0,
            resolutionTickerDone: false,
            hasSubmittedLocalTurn: false,
            multiplayerMode: 'single',
            localPlayerId: null,
            lobbyId: null,
            hostPlayerId: null,
            submittedPlayers: [],
            turnTimeLimit: null,
            turnDeadline: null,
            handoffAckKey: null,
          });
        },

        // ── Multiplayer actions ───────────────────────────────────────────────
        setMultiplayerMeta({ lobbyId, localPlayerId, hostPlayerId }) {
          saveSession({ lobbyId, localPlayerId });
          set({ multiplayerMode: 'online', lobbyId, localPlayerId, hostPlayerId, submittedPlayers: [] });
        },

        syncFromPayload(payload) {
          set((s) => ({
            // Core GameState
            turn: payload.turn,
            seqCounter: payload.seqCounter,
            players: payload.players,
            rungs: payload.rungs,
            natRungs: payload.natRungs,
            reachSeq: payload.reachSeq,
            natReachSeq: payload.natReachSeq,
            securedBy: payload.securedBy,
            natSecuredBy: payload.natSecuredBy,
            stateGroupDominance: payload.stateGroupDominance,
            hungColleges: payload.hungColleges,
            // Phase / UI fields
            phase: payload.phase,
            activePlayerIndex: payload.activePlayerIndex,
            electionResult: payload.electionResult,
            lastIncome: payload.lastIncome,
            lastTurnReport: payload.lastTurnReport,
            lastRoundPurchases: payload.lastRoundPurchases ?? [],
            prevDominance: payload.prevDominance,
            resolutionTickerDone: false,
            hasSubmittedLocalTurn: false,
            electionTallyProgress: payload.electionTallyProgress,
            // Rebuild derived state from the new players
            workingCash: buildWorkingCash(payload.players),
            pendingByPlayer: emptyPending(payload.players),
            submitted: emptySubmitted(payload.players),
            // Multiplayer coordination
            submittedPlayers: payload.submittedPlayers ?? [],
            // Preserve this device's session identity — never overwrite from remote
            localPlayerId: s.localPlayerId,
            lobbyId: s.lobbyId,
            hostPlayerId: s.hostPlayerId,
            multiplayerMode: s.multiplayerMode,
            // Pre-ack the handoff so the curtain never shows in online mode
            handoffAckKey: `${payload.turn}:0`,
            turnDeadline: payload.turnDeadlineUtc ?? null,
          }));
        },

        mergeSubmittedFromRemote(turn, submitted) {
          const s = get();
          // Only mirror submissions for the turn we're actively planning — never
          // touch turn/phase/cash, and ignore stale events from older turns.
          if (s.phase !== 'PLANNING' || s.turn !== turn) return;
          const next = submitted ?? [];
          if (
            next.length === s.submittedPlayers.length &&
            next.every((id) => s.submittedPlayers.includes(id))
          ) {
            return; // no change — avoid a needless re-render
          }
          set({ submittedPlayers: next });
        },

        clearMultiplayerMeta() {
          clearSession();
          set({ multiplayerMode: 'single', localPlayerId: null, lobbyId: null, hostPlayerId: null, submittedPlayers: [] });
        },

        initOnlineGame(players) {
          const fresh = createInitialGameStateFromPlayers(players);
          const tl = get().turnTimeLimit;
          const newDeadline = tl != null ? Date.now() + tl * 1000 : null;
          set({
            ...fresh,
            gameId: newGameId(),
            phase: 'PLANNING',
            activePlayerIndex: 0,
            pendingByPlayer: emptyPending(fresh.players),
            workingCash: buildWorkingCash(fresh.players),
            submitted: emptySubmitted(fresh.players),
            electionResult: null,
            lastIncome: Object.fromEntries(fresh.players.map((p) => [p.id, 0])),
            lastTurnReport: null,
            lastRoundPurchases: [],
            prevDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
            electionTallyProgress: 0,
            resolutionTickerDone: false,
            hasSubmittedLocalTurn: false,
            turnDeadline: newDeadline,
            handoffAckKey: '1:0',
          });
        },

        // ── Turn-timer actions ────────────────────────────────────────────────
        setTurnTimeLimit(seconds) {
          set({ turnTimeLimit: seconds });
        },

        armTurnDeadline(now = Date.now()) {
          const { phase, turnTimeLimit, turnDeadline } = get();
          if (phase !== 'PLANNING' || turnTimeLimit == null) {
            if (turnDeadline !== null) set({ turnDeadline: null });
            return;
          }
          set({ turnDeadline: now + turnTimeLimit * 1000 });
        },

        pauseTurnDeadline() {
          if (get().turnDeadline !== null) set({ turnDeadline: null });
        },

        acknowledgeHandoff(now = Date.now()) {
          const { turn, activePlayerIndex, phase, turnTimeLimit } = get();
          set({
            handoffAckKey: `${turn}:${activePlayerIndex}`,
            turnDeadline:
              phase === 'PLANNING' && turnTimeLimit != null ? now + turnTimeLimit * 1000 : null,
          });
        },
      };
    },
    {
      name: 'election-sim-storage-v5',
      partialize: (state) =>
        Object.fromEntries(
          Object.entries(state).filter(
            ([k]) =>
              k !== 'turnDeadline' &&
              k !== 'handoffAckKey' &&
              k !== 'resolutionTickerDone' &&
              k !== 'hasSubmittedLocalTurn' &&
              k !== 'localPlayerId' &&
              k !== 'lobbyId' &&
              k !== 'hostPlayerId' &&
              k !== 'submittedPlayers',
          ),
        ) as Partial<GameStore>,
    },
  ),
);

// ── Selectors ─────────────────────────────────────────────────────────────────

export function useActivePlayer(): PlayerState | null {
  return useGameStore((s) => localPlayer(s));
}

export function usePlayerById(id: string): PlayerState | undefined {
  return useGameStore((s) => s.players.find((p) => p.id === id));
}

export function useStateRungs(stateId: string, playerId: string): number {
  return useGameStore((s) => s.rungs[stateId]?.[playerId] ?? 0);
}

export function useNatRungs(groupId: string, playerId: string): number {
  return useGameStore((s) => s.natRungs[groupId]?.[playerId] ?? 0);
}

export function useActiveNationalCash(): number {
  return useGameStore((s) => {
    const p = localPlayer(s);
    if (!p) return 0;
    return s.workingCash[p.id]?.nationalCash ?? p.nationalCash;
  });
}

export function useActiveGroupWallet(groupId: string): number {
  return useGameStore((s) => {
    const p = localPlayer(s);
    if (!p) return 0;
    return s.workingCash[p.id]?.groupWallets[groupId] ?? p.groupWallets[groupId] ?? 0;
  });
}

export function useActivePending(): PendingPurchase[] {
  return useGameStore((s) => {
    const p = localPlayer(s);
    if (!p) return [];
    return s.pendingByPlayer[p.id] ?? [];
  });
}

export function usePendingRungs(kind: 'state' | 'national', targetId: string): number {
  return useGameStore((s) => {
    const p = localPlayer(s);
    if (!p) return 0;
    return (s.pendingByPlayer[p.id] ?? [])
      .filter((pp) => pp.kind === kind && pp.targetId === targetId)
      .reduce((sum, pp) => sum + pp.rungs, 0);
  });
}

export function useElectoralResult(): ElectoralResult {
  const rungs = useGameStore((s) => s.rungs);
  const securedBy = useGameStore((s) => s.securedBy);
  const reachSeq = useGameStore((s) => s.reachSeq);
  const players = useGameStore((s) => s.players);
  const natRungs = useGameStore((s) => s.natRungs);
  const natReachSeq = useGameStore((s) => s.natReachSeq);
  const natSecuredBy = useGameStore((s) => s.natSecuredBy);
  return tallyElectoralVotes({
    turn: 0, seqCounter: 0, players,
    rungs, natRungs, reachSeq, natReachSeq,
    securedBy, natSecuredBy,
    stateGroupDominance: {}, hungColleges: 0,
  });
}

export function useSecuredEVs(playerId: string): number {
  return useGameStore((s) =>
    ALL_STATES.reduce(
      (sum, st) => (s.securedBy[st.id] === playerId ? sum + st.electoralVotes : sum),
      0,
    ),
  );
}

export function useDominance(groupId: string): string | null {
  return useGameStore((s) => s.stateGroupDominance[groupId] ?? null);
}

export function useTurnTimeLimit(): number | null {
  return useGameStore((s) => s.turnTimeLimit);
}

export function useTurnDeadline(): number | null {
  return useGameStore((s) => s.turnDeadline);
}

export function useHandoffAckKey(): string | null {
  return useGameStore((s) => s.handoffAckKey);
}

export function usePlayerColors(): Record<string, ResolvedColor> {
  const players = useGameStore((s) => s.players);
  return useMemo(() => assignPlayerColors(players), [players]);
}
