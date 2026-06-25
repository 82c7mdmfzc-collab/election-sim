import { describe, it, expect } from 'vitest';
import {
  dailyDateKey,
  getDailyChallengeConfig,
  resolveDailyOpponents,
  seededRng,
} from './dailyChallenge';
import { CANDIDATES } from './candidates';

describe('dailyChallenge', () => {
  it('dailyDateKey returns a UTC YYYY-MM-DD string', () => {
    const key = dailyDateKey(new Date('2026-06-22T18:30:00Z'));
    expect(key).toBe('2026-06-22');
  });

  it('seededRng is deterministic and in [0,1)', () => {
    const a = seededRng('x');
    const b = seededRng('x');
    for (let i = 0; i < 20; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('getDailyChallengeConfig is deterministic for a date key', () => {
    const c1 = getDailyChallengeConfig('2026-06-22');
    const c2 = getDailyChallengeConfig('2026-06-22');
    expect(c1).toEqual(c2);
  });

  it('config stays within designed bounds across many days', () => {
    for (let d = 1; d <= 28; d++) {
      const key = `2026-06-${String(d).padStart(2, '0')}`;
      const cfg = getDailyChallengeConfig(key);
      expect([1, 2, 3]).toContain(cfg.opponentCount);
      expect(['medium', 'hard']).toContain(cfg.difficulty);
      expect([60, 90, 120, null]).toContain(cfg.turnTimeLimit);
    }
  });

  it('resolveDailyOpponents is deterministic, excludes the player pick, and is distinct', () => {
    const key = '2026-06-22';
    const pick = CANDIDATES[0].id;
    const a = resolveDailyOpponents(key, pick);
    const b = resolveDailyOpponents(key, pick);

    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.length).toBe(getDailyChallengeConfig(key).opponentCount);
    expect(a.some((c) => c.id === pick)).toBe(false);
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
  });

  it('never collides with the chosen candidate for any roster pick', () => {
    const key = '2026-07-04';
    for (const player of CANDIDATES) {
      const opps = resolveDailyOpponents(key, player.id);
      expect(opps.some((c) => c.id === player.id)).toBe(false);
      expect(opps.length).toBeGreaterThanOrEqual(1);
      expect(opps.length).toBeLessThanOrEqual(3);
    }
  });
});
