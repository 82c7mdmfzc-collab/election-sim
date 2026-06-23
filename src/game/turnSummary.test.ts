import { describe, it, expect } from 'vitest';
import { turnSummaryLines } from './turnSummary';
import type { PlayerState, TurnReport } from './types';

function player(id: string, name: string): PlayerState {
  return {
    id, candidateId: id, name,
    affinities: {}, payoutModifiers: {},
    nationalCash: 0, groupWallets: {}, eliminated: false,
  };
}

const players = [player('p1', 'You Player'), player('p2', 'Rival')];
const emptyReport: TurnReport = { clashedStates: [], clashedNational: [], newlySecured: [], incomeByPlayer: {} };

describe('turnSummaryLines', () => {
  it('returns nothing for a quiet turn', () => {
    expect(turnSummaryLines({
      report: emptyReport,
      prevDominance: { Latino: null },
      dominance: { Latino: null },
      players,
      ownerId: 'p1',
    })).toEqual([]);
  });

  it('describes a secure with "You" for the owner seat', () => {
    const lines = turnSummaryLines({
      report: { ...emptyReport, newlySecured: [{ kind: 'state', targetId: 'GA', playerId: 'p1' }] },
      prevDominance: {},
      dominance: {},
      players,
      ownerId: 'p1',
    });
    expect(lines[0]).toBe('🔒 You called Georgia — Called for good.');
  });

  it('describes a coalition gain and an evaporation', () => {
    const lines = turnSummaryLines({
      report: emptyReport,
      prevDominance: { Latino: null, 'High Tech': 'p1' },
      dominance: { Latino: 'p1', 'High Tech': 'p2' },
      players,
      ownerId: 'p1',
    });
    expect(lines).toContain('🏛 You now lead the Latino Coalition — backing paid every turn.');
    // p1 lost High Tech (before p1, after p2) → owner-perspective evaporation line
    expect(lines).toContain('📉 You lost the High Tech Coalition — its Reserve collapsed to $0.');
  });

  it('uses third-person grammar when the owner is not involved', () => {
    const lines = turnSummaryLines({
      report: emptyReport,
      prevDominance: { Latino: null },
      dominance: { Latino: 'p2' },
      players,
      ownerId: 'p1',
    });
    expect(lines).toContain('🏛 Rival now leads the Latino Coalition — backing paid every turn.');
  });

  it('summarizes clashes and caps the list', () => {
    const lines = turnSummaryLines({
      report: { ...emptyReport, clashedStates: ['GA', 'TX', 'FL', 'NY'], clashedNational: [] },
      prevDominance: {},
      dominance: {},
      players,
      ownerId: 'p1',
    });
    const clashLine = lines.find((l) => l.startsWith('⚠'));
    expect(clashLine).toContain('Georgia, Texas, Florida…');
    expect(clashLine).toContain('burned');
  });
});
