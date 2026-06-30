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
    electionScheduled: false,
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
    // Early turn keeps election probability at 0, so no warning roll is scheduled.
    const next = advanceLobbyPhase(makeLobbyState({ turn: 1 }), 'confirmResolution', 1_000_000, () => 0);
    expect(next).not.toBeNull();
    if (next && next.phase === 'PLANNING') {
      expect(next.turn).toBe(2);
      expect(next.submittedPlayers).toEqual([]);
      expect(next.pendingSubmissions).toEqual({});
      // deadline derives from the SERVER clock + the per-turn limit, not a client value
      expect(next.turnDeadlineUtc).toBe(1_000_000 + 60 * 1000);
    }
  });

  it('confirmResolution never fires an election without a scheduled warning', () => {
    const next = advanceLobbyPhase(makeLobbyState({ turn: 10, electionScheduled: false }), 'confirmResolution', 1_000_000, () => 0);
    expect(next?.phase).toBe('PLANNING');
    expect(next?.turn).toBe(11);
  });

  it('a successful next-turn roll marks the next planning round', () => {
    const next = advanceLobbyPhase(makeLobbyState({ turn: 9, electionScheduled: false }), 'confirmResolution', 1_000_000, () => 0.19);
    expect(next?.phase).toBe('PLANNING');
    expect(next?.turn).toBe(10);
    expect(next?.electionScheduled).toBe(true);
  });

  it('a scheduled warning round advances into ELECTION after resolution', () => {
    const next = advanceLobbyPhase(makeLobbyState({ turn: 10, electionScheduled: true }), 'confirmResolution', 1_000_000, () => 0.99);
    expect(next?.phase).toBe('ELECTION');
    expect(next?.electionScheduled).toBe(false);
    expect(next?.electionResult).not.toBeNull();
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
    const next = advanceLobbyPhase(prior, 'resolveElection', 2_000_000, () => 0.99);
    expect(next?.phase).toBe('PLANNING');
    expect(next?.turn).toBe(5);
    expect(next?.hungColleges).toBe(2);
    expect(next?.electionResult).toBeNull();
    expect(next?.turnDeadlineUtc).toBe(2_000_000 + 60 * 1000);
  });
});
