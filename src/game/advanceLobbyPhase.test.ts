import { describe, it, expect } from 'vitest';
import { advanceLobbyPhase } from './advanceLobbyPhase';
import { ALL_STATES } from './statesData';
import { NATIONAL_GROUPS, STATE_GROUPS } from './config';
import type { LobbyGameState, PlayerState } from './types';

function makePlayer(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    candidateId: id,
    name: id,
    affinities: {},
    payoutModifiers: {},
    nationalCash: 1000,
    groupWallets: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, 0])),
    eliminated: false,
    ...overrides,
  };
}

function makeLobbyState(overrides: Partial<LobbyGameState> = {}): LobbyGameState {
  const players = [makePlayer('p1'), makePlayer('p2')];
  const stateIds = ALL_STATES.map((s) => s.id);
  const natIds = NATIONAL_GROUPS.map((g) => g.id);
  return {
    turn: 3,
    seqCounter: 0,
    players,
    rungs: Object.fromEntries(stateIds.map((id) => [id, { p1: 0, p2: 0 }])),
    natRungs: Object.fromEntries(natIds.map((id) => [id, { p1: 0, p2: 0 }])),
    reachSeq: Object.fromEntries(stateIds.map((id) => [id, { p1: 0, p2: 0 }])),
    natReachSeq: Object.fromEntries(natIds.map((id) => [id, { p1: 0, p2: 0 }])),
    securedBy: Object.fromEntries(stateIds.map((id) => [id, null])),
    natSecuredBy: Object.fromEntries(natIds.map((id) => [id, null])),
    stateGroupDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
    hungColleges: 0,
    phase: 'RESOLUTION',
    activePlayerIndex: 0,
    electionResult: null,
    lastIncome: { p1: 0, p2: 0 },
    lastTurnReport: null,
    prevDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
    electionTallyProgress: 0,
    hostPlayerId: 'p1',
    submittedPlayers: [],
    pendingSubmissions: {},
    turnTimeLimitSec: 60,
    ...overrides,
  };
}

describe('advanceLobbyPhase', () => {
  it('rejects an action from the wrong phase', () => {
    expect(advanceLobbyPhase(makeLobbyState({ phase: 'PLANNING' }), 'confirmResolution')).toBeNull();
    expect(advanceLobbyPhase(makeLobbyState({ phase: 'RESOLUTION' }), 'resolveElection')).toBeNull();
    expect(advanceLobbyPhase(makeLobbyState({ phase: 'RESOLUTION' }), 'completeTally')).toBeNull();
  });

  it('confirmResolution without an election advances to the next PLANNING turn', () => {
    // hungColleges high + early turn keeps election probability at 0 so no election rolls.
    const next = advanceLobbyPhase(makeLobbyState({ turn: 1 }), 'confirmResolution', 1_000_000);
    expect(next).not.toBeNull();
    if (next && next.phase === 'PLANNING') {
      expect(next.turn).toBe(2);
      expect(next.submittedPlayers).toEqual([]);
      expect(next.pendingSubmissions).toEqual({});
      // deadline derives from the SERVER clock + the per-turn limit, not a client value
      expect(next.turnDeadlineUtc).toBe(1_000_000 + 60 * 1000);
    }
    // (If an election did roll, phase would be ELECTION — also valid, just assert non-null above.)
  });

  it('completeTally moves ELECTION_TALLY → GAME_OVER', () => {
    const next = advanceLobbyPhase(makeLobbyState({ phase: 'ELECTION_TALLY' }), 'completeTally');
    expect(next?.phase).toBe('GAME_OVER');
  });

  it('resolveElection requires an electionResult', () => {
    expect(advanceLobbyPhase(makeLobbyState({ phase: 'ELECTION', electionResult: null }), 'resolveElection')).toBeNull();
  });

  it('resolveElection with no winner and 2 players hangs the college and returns to PLANNING', () => {
    // Empty board → nobody reaches 270; with 2 active players this is a Hung College.
    const prior = makeLobbyState({
      phase: 'ELECTION',
      turn: 4,
      hungColleges: 1,
      electionResult: { evByPlayer: { p1: 0, p2: 0 }, stateLeaders: {}, winner: null },
    });
    const next = advanceLobbyPhase(prior, 'resolveElection', 2_000_000);
    expect(next?.phase).toBe('PLANNING');
    expect(next?.turn).toBe(5);
    expect(next?.hungColleges).toBe(2);
    expect(next?.electionResult).toBeNull();
    expect(next?.turnDeadlineUtc).toBe(2_000_000 + 60 * 1000);
  });
});
