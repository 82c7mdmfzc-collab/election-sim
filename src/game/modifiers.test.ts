import { describe, it, expect } from 'vitest';
import {
  MODIFIERS,
  MODIFIER_MAP,
  buildModifiers,
  normalizeModifiers,
  rollHitsChance,
  rollModifierIds,
  dailyModifierId,
  isCrazyModeAvailable,
  CRAZY_MODE_END_MS,
} from './modifiers';
import { rungCostFor, electionProbability } from './config';
import { maxBuyableThisTurn } from './engine';

describe('modifier catalog', () => {
  it('has 10 modifiers with ≥2 new mechanics and unique ids', () => {
    expect(MODIFIERS).toHaveLength(10);
    expect(MODIFIERS.filter((m) => m.isNewMechanic).length).toBeGreaterThanOrEqual(2);
    expect(new Set(MODIFIERS.map((m) => m.id)).size).toBe(10);
  });
  it('maps every id', () => {
    for (const m of MODIFIERS) expect(MODIFIER_MAP[m.id]).toBe(m);
  });
});

describe('buildModifiers + normalizeModifiers', () => {
  it('merges effects of the given ids', () => {
    const m = buildModifiers(['coalition_windfall', 'war_chest']);
    expect(m.coalitionPayoutMult).toBe(2);
    expect(m.startingCashBonus).toBe(400);
  });
  it('clamps out-of-range values', () => {
    const m = normalizeModifiers({ coalitionPayoutMult: 99, startingCashBonus: 999999, winThreshold: 10, electionStartTurn: 1 });
    expect(m.coalitionPayoutMult).toBe(4);       // mult max
    expect(m.startingCashBonus).toBe(2000);      // cash max
    expect(m.winThreshold).toBe(230);            // threshold min
    expect(m.electionStartTurn).toBe(4);         // start-turn min
  });
  it('ignores unknown ids', () => {
    expect(buildModifiers(['nope'])).toEqual({});
  });
});

describe('rolling', () => {
  it('hits the 40% chance at the boundary', () => {
    expect(rollHitsChance(() => 0.39)).toBe(true);
    expect(rollHitsChance(() => 0.4)).toBe(false);
  });
  it('rolls distinct ids and honors the exclude list', () => {
    let calls = 0;
    const seq = [0, 0.5]; // deterministic picks
    const rand = () => seq[calls++ % seq.length];
    const ids = rollModifierIds(2, ['coalition_windfall'], rand);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);            // distinct
    expect(ids).not.toContain('coalition_windfall'); // excluded
  });
  it('daily modifier is deterministic per date and a real id', () => {
    const a = dailyModifierId('2026-07-06');
    const b = dailyModifierId('2026-07-06');
    const c = dailyModifierId('2026-07-07');
    expect(a).toBe(b);
    expect(MODIFIER_MAP[a]).toBeTruthy();
    // (c may or may not differ, but must also be valid)
    expect(MODIFIER_MAP[c]).toBeTruthy();
  });
  it('gates Crazy Mode on the Aug-20 cutoff', () => {
    expect(isCrazyModeAvailable(CRAZY_MODE_END_MS - 1)).toBe(true);
    expect(isCrazyModeAvailable(CRAZY_MODE_END_MS)).toBe(false);
  });
});

describe('engine effects (modifiers absent = base)', () => {
  it('megastate/non-megastate cost multipliers', () => {
    const baseCA = rungCostFor('CA', 100, 1, 0);
    expect(rungCostFor('CA', 100, 1, 0, { megastateCostMult: 0.75 })).toBe(Math.round(baseCA * 0.75));
    const basePA = rungCostFor('PA', 100, 1, 0);
    expect(rungCostFor('PA', 100, 1, 0, { nonMegastateCostMult: 0.8 })).toBe(Math.round(basePA * 0.8));
    // absent = unchanged
    expect(rungCostFor('PA', 100, 1, 0, {})).toBe(basePA);
  });
  it('Ground Game lifts the first-entry cap', () => {
    expect(maxBuyableThisTurn(0, 12)).toBe(2);                          // normal entry cap
    expect(maxBuyableThisTurn(0, 12, { entryCapLifted: true })).toBe(12); // lifted
    expect(maxBuyableThisTurn(0, 16, { entryCapLifted: true })).toBe(16);
  });
  it('Snap Election opens the window earlier', () => {
    expect(electionProbability(6, 0)).toBe(0);                    // normally no election at turn 6
    expect(electionProbability(6, 0, 6)).toBeGreaterThan(0);      // snap: window open at 6
    expect(electionProbability(5, 0, 6)).toBe(0);                 // still gated before startTurn
  });
});
