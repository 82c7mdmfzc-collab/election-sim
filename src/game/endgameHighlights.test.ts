import { describe, expect, it } from 'vitest';
import { ALL_STATES } from './statesData';
import { buildFinalTallySnapshot, buildTallyHighlights } from './endgameHighlights';
import type { ElectoralResult, RungMap } from './types';

const WINNER_STATES = new Set(['CA', 'TX', 'FL', 'NY', 'PA', 'IL', 'OH', 'GA', 'NC', 'MI', 'VA', 'WA']);

function fixtureResult(): ElectoralResult {
  const stateLeaders = Object.fromEntries(
    ALL_STATES.map((s) => [s.id, WINNER_STATES.has(s.id) ? 'p1' : 'p2']),
  );
  return {
    winner: 'p1',
    evByPlayer: { p1: 279, p2: 259 },
    stateLeaders,
  };
}

function fixtureRungs(result = fixtureResult()): RungMap {
  return Object.fromEntries(
    ALL_STATES.map((s) => {
      const leader = result.stateLeaders[s.id];
      return [
        s.id,
        leader === 'p1'
          ? { p1: s.id === 'WA' ? 6 : 8, p2: s.id === 'WA' ? 5 : 3 }
          : { p1: s.id === 'AZ' ? 6 : 2, p2: s.id === 'AZ' ? 7 : 7 },
      ];
    }),
  );
}

describe('endgame tally highlights', () => {
  it('caps the highlight reel at seven states', () => {
    const highlights = buildTallyHighlights(ALL_STATES, fixtureResult(), fixtureRungs());

    expect(highlights.length).toBeLessThanOrEqual(7);
  });

  it('keeps the winner tipping-point state as the final highlight', () => {
    const highlights = buildTallyHighlights(ALL_STATES, fixtureResult(), fixtureRungs());
    const finalHighlight = highlights[highlights.length - 1];

    expect(highlights.length).toBeGreaterThan(0);
    expect(finalHighlight?.reason).toBe('tipping_point');
    expect(finalHighlight?.winnerId).toBe('p1');
  });

  it('builds the final reveal snapshot with every state and exact final EV totals', () => {
    const result = fixtureResult();
    const snapshot = buildFinalTallySnapshot(ALL_STATES, result);

    expect(snapshot.revealedIds.size).toBe(ALL_STATES.length);
    expect(snapshot.revealedIds.has('CA')).toBe(true);
    expect(snapshot.evTotals).toEqual(result.evByPlayer);
  });
});
