/**
 * Headless game simulator — plays full games with no React/DOM/network so we can
 * Monte-Carlo strategy match-ups and measure win rates.
 *
 * It is a thin driver over the PRODUCTION engine. It does NOT reimplement any
 * rules: intents → PendingPurchase via buildPendingSubmission (the same pure
 * validator the Supabase edge function uses), then resolveTurn / rollElection /
 * resolveElection. If a strategy emits an illegal/over-budget intent the whole
 * submission is dropped (all-or-nothing, exactly like online play), so strategies
 * are responsible for emitting only valid intents (see strategies.ts).
 */

import {
  resolveTurn,
  rollElection,
  resolveElection,
  tallyElectoralVotes,
} from '../engine';
import { buildPendingSubmission } from '../lobbySecurity';
import {
  ALL_STATES,
  playerFromCandidate,
  createInitialGameStateFromPlayers,
} from '../statesData';
import { STATE_GROUPS, MEGASTATE_IDS } from '../config';
import type { CandidateDef } from '../candidates';
import type {
  GameState,
  LobbyGameState,
  PlayerState,
  PurchaseIntent,
} from '../types';

// ── Seeded RNG (copied from resolveLobbyTurn.ts so games are reproducible) ──────

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Strategy contract ───────────────────────────────────────────────────────────

/**
 * A strategy looks at the start-of-turn state (PLANNING view, blind to opponents'
 * current-turn moves — i.e. honest simultaneous play) and returns the rungs it
 * wants to buy. Must return only affordable, legal intents (caps + funds), or the
 * whole turn is forfeit. The rng is shared per-game and deterministic.
 */
export type Strategy = (
  view: LobbyGameState,
  playerId: string,
  rng: () => number,
) => PurchaseIntent[];

export interface Seat {
  /** Stable label used in the win-rate tables (e.g. 'big4Rush', 'bot-hard'). */
  label: string;
  candidate: CandidateDef;
  strategy: Strategy;
}

// ── Result metrics ──────────────────────────────────────────────────────────────

export interface PlayerStat {
  id: string;
  label: string;
  candidateId: string;
  won: boolean;
  finalEV: number;
  /** How many of CA/TX/FL/NY this player led at the deciding tally. */
  big4Led: number;
  /** Which of CA/TX/FL/NY this player led at the deciding tally. */
  megaStatesLed: string[];
  evFromMega: number;
  evFromNonMega: number;
  statesLed: number;
  coalitionsDominated: string[];
  spentTotal: number;
  spentMega: number;
  spentNonMega: number;
  spentNational: number;
}

export interface GameResult {
  seed: number;
  endTurn: number;
  timedOut: boolean;
  hungColleges: number;
  winnerLabel: string | null;
  winnerId: string | null;
  players: PlayerStat[];
}

const STATE_EV = Object.fromEntries(ALL_STATES.map((s) => [s.id, s.electoralVotes]));

/** Tag a bare GameState as a PLANNING LobbyGameState for buildPendingSubmission. */
function planningView(gs: GameState): LobbyGameState {
  return {
    ...gs,
    phase: 'PLANNING',
    activePlayerIndex: 0,
    electionResult: null,
    lastIncome: {},
    lastTurnReport: null,
    prevDominance: gs.stateGroupDominance,
    electionTallyProgress: 0,
    hostPlayerId: gs.players[0]?.id ?? '',
    submittedPlayers: [],
    pendingSubmissions: {},
  };
}

/** One full game between the given seats. Deterministic in `seed`. */
export function runGame(seats: Seat[], seed: number, maxTurns = 40): GameResult {
  const players: PlayerState[] = seats.map((s, i) =>
    playerFromCandidate(s.candidate, { id: `p${i}`, name: s.label }),
  );
  const seatById = Object.fromEntries(seats.map((s, i) => [`p${i}`, s]));
  let state: GameState = createInitialGameStateFromPlayers(players);

  const rng = mulberry32(hashSeed(`${seed}`));

  // Cumulative spend per player, split by target bucket.
  const spend: Record<string, { total: number; mega: number; nonMega: number; national: number }> =
    Object.fromEntries(players.map((p) => [p.id, { total: 0, mega: 0, nonMega: 0, national: 0 }]));

  let winnerId: string | null = null;
  let endTurn = 0;
  let timedOut = false;

  for (let turn = 1; turn <= maxTurns; turn++) {
    state = { ...state, turn, electionScheduled: rollElection({ ...state, turn }, rng) };
    const view = planningView(state);

    const purchasesByPlayer: Record<string, ReturnType<typeof buildPendingSubmission>['pending']> = {};
    for (const p of state.players.filter((pl) => !pl.eliminated)) {
      const intents = seatById[p.id].strategy(view, p.id, rng);
      const { pending } = buildPendingSubmission(view, p.id, intents);
      purchasesByPlayer[p.id] = pending;
      for (const pp of pending) {
        const bucket = spend[p.id];
        bucket.total += pp.cost;
        if (pp.kind === 'national') bucket.national += pp.cost;
        else if (MEGASTATE_IDS.has(pp.targetId)) bucket.mega += pp.cost;
        else bucket.nonMega += pp.cost;
      }
    }

    state = resolveTurn(state, purchasesByPlayer).state;

    if (state.electionScheduled) {
      state = { ...state, electionScheduled: false };
      const outcome = resolveElection(state);
      if (outcome.type === 'winner') {
        winnerId = outcome.result.winner;
        endTurn = turn;
        break;
      }
      if (outcome.type === 'elimination' && outcome.nextState) {
        state = outcome.nextState; // (only fires with >2 players)
      } else {
        // Hung college (2-player): escalate so the next election is likelier.
        state = { ...state, hungColleges: state.hungColleges + 1 };
      }
    }
  }

  if (!winnerId) {
    timedOut = true;
    endTurn = maxTurns;
  }

  // Final tally for per-state EV attribution and any timeout tiebreak.
  const finalTally = tallyElectoralVotes(state);
  if (!winnerId) {
    // Timeout: award the EV leader so win-rate accounting stays well-defined.
    let bestEv = -1;
    for (const p of state.players.filter((pl) => !pl.eliminated)) {
      const ev = finalTally.evByPlayer[p.id] ?? 0;
      if (ev > bestEv) { bestEv = ev; winnerId = p.id; }
    }
  }

  const dominatedBy: Record<string, string[]> = Object.fromEntries(players.map((p) => [p.id, []]));
  for (const g of STATE_GROUPS) {
    const dom = state.stateGroupDominance[g.id];
    if (dom) dominatedBy[dom]?.push(g.id);
  }

  const stat = (p: PlayerState): PlayerStat => {
    let evMega = 0, evNonMega = 0, statesLed = 0;
    const megaLed: string[] = [];
    for (const [sid, leader] of Object.entries(finalTally.stateLeaders)) {
      if (leader !== p.id) continue;
      statesLed++;
      const ev = STATE_EV[sid] ?? 0;
      if (MEGASTATE_IDS.has(sid)) { evMega += ev; megaLed.push(sid); } else evNonMega += ev;
    }
    return {
      id: p.id,
      label: seatById[p.id].label,
      candidateId: p.candidateId,
      won: p.id === winnerId,
      finalEV: finalTally.evByPlayer[p.id] ?? 0,
      big4Led: megaLed.length,
      megaStatesLed: megaLed,
      evFromMega: evMega,
      evFromNonMega: evNonMega,
      statesLed,
      coalitionsDominated: dominatedBy[p.id] ?? [],
      spentTotal: spend[p.id].total,
      spentMega: spend[p.id].mega,
      spentNonMega: spend[p.id].nonMega,
      spentNational: spend[p.id].national,
    };
  };

  return {
    seed,
    endTurn,
    timedOut,
    hungColleges: state.hungColleges,
    winnerId,
    winnerLabel: winnerId ? seatById[winnerId].label : null,
    players: state.players.map(stat),
  };
}
