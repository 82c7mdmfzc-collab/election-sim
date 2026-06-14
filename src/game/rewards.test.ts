import { describe, it, expect } from 'vitest';
import { computeReward, REWARD_CAP } from './rewards';

describe('computeReward', () => {
  it('awards only the finish base for a loss with no progress', () => {
    const r = computeReward({ won: false, securedStates: 0, coalitionsDominated: 0, winStreak: 0 });
    expect(r.base).toBe(100);
    expect(r.winBonus).toBe(0);
    expect(r.streakBonus).toBe(0);
    expect(r.total).toBe(100);
  });

  it('adds the win bonus when the owner wins', () => {
    const r = computeReward({ won: true, securedStates: 0, coalitionsDominated: 0, winStreak: 1 });
    expect(r.winBonus).toBe(400);
    expect(r.streakBonus).toBe(50); // streak of 1
    expect(r.total).toBe(100 + 400 + 50);
  });

  it('scales secured states and coalitions', () => {
    const r = computeReward({ won: false, securedStates: 6, coalitionsDominated: 3, winStreak: 0 });
    expect(r.securedBonus).toBe(60);
    expect(r.dominanceBonus).toBe(150);
    expect(r.total).toBe(100 + 60 + 150);
  });

  it('caps the streak bonus at 5 consecutive wins', () => {
    const r = computeReward({ won: true, securedStates: 0, coalitionsDominated: 0, winStreak: 9 });
    expect(r.streakBonus).toBe(250); // 5 * 50, not 9 * 50
  });

  it('does not pay a streak bonus on a loss even with a prior streak number', () => {
    const r = computeReward({ won: false, securedStates: 0, coalitionsDominated: 0, winStreak: 3 });
    expect(r.streakBonus).toBe(0);
  });

  it('clamps the total to the server cap', () => {
    const r = computeReward({ won: true, securedStates: 1000, coalitionsDominated: 1000, winStreak: 100 });
    expect(r.total).toBe(REWARD_CAP);
  });

  it('never returns a negative total from odd inputs', () => {
    const r = computeReward({ won: false, securedStates: -5, coalitionsDominated: -2, winStreak: -1 });
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBe(100);
  });
});
