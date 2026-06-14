import { describe, it, expect } from 'vitest';
import { resolveLobbyTurn } from './resolveLobbyTurn';
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
    turn: 1,
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
    phase: 'PLANNING',
    activePlayerIndex: 0,
    electionResult: null,
    lastIncome: { p1: 0, p2: 0 },
    lastTurnReport: null,
    prevDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
    electionTallyProgress: 0,
    hostPlayerId: 'p1',
    submittedPlayers: ['p1', 'p2'],
    pendingSubmissions: {
      p1: [{ kind: 'state', targetId: 'CA', rungs: 1, cost: 10, walletDraw: [{ wallet: 'NATIONAL', amount: 10 }] }],
      p2: [],
    },
    ...overrides,
  };
}

describe('resolveLobbyTurn', () => {
  it('resolves when all active players have submitted and consumes pending', () => {
    const outcome = resolveLobbyTurn(makeLobbyState());
    expect(outcome).not.toBeNull();
    const r = outcome!.resolved;
    expect(r.phase).toBe('RESOLUTION');
    expect(r.submittedPlayers).toEqual([]);
    expect(r.pendingSubmissions).toEqual({});
    // p1's purchased rung was applied
    expect(r.rungs['CA'].p1).toBe(1);
    // ticker log reflects the purchase, host is preserved
    expect(r.lastRoundPurchases).toEqual([
      expect.objectContaining({ playerId: 'p1', targetId: 'CA', rungsBought: 1, cost: 10 }),
    ]);
    expect(r.hostPlayerId).toBe('p1');
  });

  it('returns null when not all players submitted and force is false', () => {
    expect(resolveLobbyTurn(makeLobbyState({ submittedPlayers: ['p1'] }))).toBeNull();
  });

  it('resolves a partial turn when force is true', () => {
    const outcome = resolveLobbyTurn(makeLobbyState({ submittedPlayers: ['p1'] }), true);
    expect(outcome).not.toBeNull();
    expect(outcome!.resolved.phase).toBe('RESOLUTION');
  });

  it('ignores eliminated players when checking submissions', () => {
    const state = makeLobbyState({
      players: [makePlayer('p1'), makePlayer('p2', { eliminated: true })],
      submittedPlayers: ['p1'],
    });
    // p2 is eliminated, so p1 alone counts as "all submitted"
    expect(resolveLobbyTurn(state)).not.toBeNull();
  });
});
