export type PlayerId = string;
export type StateId = string;
export type StateGroupId = string;
export type NationalGroupId = string;

// ── Static map entity ─────────────────────────────────────────────────────────
export interface US_State {
  readonly id: StateId;
  readonly name: string;
  readonly electoralVotes: number;
  readonly baseCampaignCost: number;
  /** Derived at runtime via maxRungsFor(); not stored on the literal. */
  readonly maxRungs: 8 | 12 | 16;
}

// ── Economy entities ──────────────────────────────────────────────────────────
export interface StateGroup {
  readonly id: StateGroupId;
  readonly members: readonly StateId[];
  readonly totalEV: number;
  /** Cash deposited to dominant player's group wallet each turn ($1k units). */
  readonly bonusPayout: number;
}

export interface NationalGroup {
  readonly id: NationalGroupId;
  readonly maxRungs: 10;
  /** Cash to nationalCash for rung≥5 leader each turn. */
  readonly turnBonus: number;
  /** == turnBonus * 0.5 */
  readonly rungCost: number;
}

// ── Player runtime state ──────────────────────────────────────────────────────
export interface PlayerState {
  readonly id: PlayerId;
  readonly candidateId: string;
  readonly name: string;
  /**
   * Cost modifiers: keyed by StateGroupId or NationalGroupId.
   * Reduces (or, when negative, raises) effective rung cost:
   * effectiveCost = baseCost * (1 - affinity). A negative value is a cost
   * penalty (e.g. -0.20 → 1.20× cost).
   */
  readonly affinities: Record<string, number>;
  /**
   * Profit modifiers: keyed by StateGroupId or NationalGroupId.
   * Scales the per-turn payout for that group: payout * (1 + modifier).
   * Positive = extra profit, negative = profit reduction.
   */
  readonly payoutModifiers: Record<string, number>;
  nationalCash: number;
  groupWallets: Record<StateGroupId, number>;
  eliminated: boolean;
  /** AI-controlled seat (single-player "vs Bot" mode). Absent/false = human. */
  isBot?: boolean;
  /** Bot strength when isBot is true. */
  botDifficulty?: BotDifficulty;
}

export type BotDifficulty = 'easy' | 'medium' | 'hard';

// ── Progress tracking ─────────────────────────────────────────────────────────
/** Current rung count per state per player. */
export type RungMap = Record<StateId, Record<PlayerId, number>>;
/** Current rung count per national group per player. */
export type NatRungMap = Record<NationalGroupId, Record<PlayerId, number>>;
/**
 * Monotonic sequence number at which a player last incremented their rung
 * in a state. Lower = reached that count first → wins ties.
 */
export type ReachSeq = Record<StateId, Record<PlayerId, number>>;
export type NatReachSeq = Record<NationalGroupId, Record<PlayerId, number>>;

// ── Core authoritative game state (fully JSON-serializable) ──────────────────
export interface GameState {
  turn: number;
  /** Monotonic counter; stamps every rung increment for "reached-first" ties. */
  seqCounter: number;
  players: PlayerState[];
  rungs: RungMap;
  natRungs: NatRungMap;
  reachSeq: ReachSeq;
  natReachSeq: NatReachSeq;
  /** Permanently locked states (max rung, no clash). null = still contested. */
  securedBy: Record<StateId, PlayerId | null>;
  natSecuredBy: Record<NationalGroupId, PlayerId | null>;
  /** Which player currently dominates each State Group. null = no one. */
  stateGroupDominance: Record<StateGroupId, PlayerId | null>;
  /** Number of elections that ended without a 270+ winner (escalator). */
  hungColleges: number;
}

// ── Pending allocation (per player, hidden until resolution) ──────────────────
export interface WalletDraw {
  wallet: StateGroupId | 'NATIONAL';
  amount: number;
}

export interface PendingPurchase {
  kind: 'state' | 'national';
  targetId: StateId | NationalGroupId;
  /** Rungs being added this turn. */
  rungs: number;
  /** Total effective cost after affinity discount. */
  cost: number;
  /** Ordered breakdown of which wallets were debited. */
  walletDraw: WalletDraw[];
}

// ── Per-round purchase log (drives the Resolution ticker overlay) ─────────────
export interface RoundPurchase {
  playerId: PlayerId;
  candidateId: string;
  kind: 'state' | 'national';
  /** stateId (e.g. 'GA') or nationalGroupId (e.g. 'Gun Lobby') */
  targetId: string;
  rungsBought: number;
  /** $k units, same scale as PendingPurchase.cost */
  cost: number;
}

// ── Election results ──────────────────────────────────────────────────────────
export interface ElectoralResult {
  readonly evByPlayer: Record<PlayerId, number>;
  readonly stateLeaders: Record<StateId, PlayerId | null>;
  readonly winner: PlayerId | null;
}

// ── Turn resolution report (drives the RESOLUTION-phase UI / clash animation) ──
export interface SecuredEvent {
  kind: 'state' | 'national';
  targetId: StateId | NationalGroupId;
  playerId: PlayerId;
}

export interface TurnReport {
  /** State IDs where ≥2 players clashed (reverted + forfeited cash) this turn. */
  clashedStates: StateId[];
  /** National group IDs where a clash occurred this turn. */
  clashedNational: NationalGroupId[];
  /** Targets newly locked (max rung, solo) this turn. */
  newlySecured: SecuredEvent[];
  /** Net national-cash delta per player across the turn (purchases + income). */
  incomeByPlayer: Record<PlayerId, number>;
}

// ── Multiplayer / Supabase types ──────────────────────────────────────────────

export type GamePhase =
  | 'SETUP' | 'MENU' | 'PLANNING' | 'RESOLUTION'
  | 'ELECTION' | 'ELECTION_TALLY' | 'GAME_OVER';

/**
 * Shape stored in the `game_state` JSONB column of the `lobbies` table.
 * Extends GameState with the Zustand phase fields needed for full UI reconstruction
 * and the multiplayer coordination fields managed by the host.
 */
export interface LobbyGameState extends GameState {
  phase: GamePhase;
  activePlayerIndex: number;
  electionResult: ElectoralResult | null;
  lastIncome: Record<PlayerId, number>;
  lastTurnReport: TurnReport | null;
  prevDominance: Record<string, PlayerId | null>;
  electionTallyProgress: number;
  /** Player ID of the client that runs resolveTurn and drives phase transitions. */
  hostPlayerId: PlayerId;
  /** Player IDs that have clicked End Turn for the current round. */
  submittedPlayers: PlayerId[];
  /** Accumulated pending purchases per player; merged atomically via RPC. */
  pendingSubmissions: Record<PlayerId, PendingPurchase[]>;
  /** Flat log of all purchases this round; drives the Resolution ticker overlay. Optional for backward-compat with old Supabase rows. */
  lastRoundPurchases?: RoundPurchase[];
  /** UTC epoch ms when the current planning turn expires; synced to all clients. Optional for backward-compat. */
  turnDeadlineUtc?: number | null;
  /** Per-turn time limit in seconds, set once at game start. The server uses this
   *  to compute each new turn's deadline from its own clock. Optional for back-compat. */
  turnTimeLimitSec?: number | null;
}

// ── Waiting-room types (before game starts) ───────────────────────────────────

export interface WaitingPlayer {
  id: string;           // UUID assigned at join time
  candidateId: string;  // e.g., 'harris', 'trump'
  name: string;         // custom display name entered by the player
  isHost: boolean;
}

export interface WaitingLobbyState {
  playerCount: number;
  hostPlayerId: string;
  players: WaitingPlayer[];
}
