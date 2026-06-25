import { describe, it, expect } from 'vitest';
import {
  dailyDateKey,
  getDailyChallengeConfig,
  resolveDailyOpponents,
  getDailyRival,
  boostPositiveStats,
  seededRng,
} from './dailyChallenge';
import { CANDIDATES, CANDIDATE_MAP } from './candidates';

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

  it('getDailyRival is deterministic and independent of the player pick', () => {
    const key = '2026-06-22';
    expect(getDailyRival(key).id).toBe(getDailyRival(key).id);
    const rivalId = getDailyRival(key).id;
    // Same headline rival as opponent #1 regardless of who the player picks.
    const pickA = CANDIDATES.find((c) => c.id !== rivalId)!.id;
    const pickB = [...CANDIDATES].reverse().find((c) => c.id !== rivalId)!.id;
    expect(resolveDailyOpponents(key, pickA)[0].id).toBe(rivalId);
    expect(resolveDailyOpponents(key, pickB)[0].id).toBe(rivalId);
  });

  it('resolveDailyOpponents is deterministic, excludes the player pick, and is distinct', () => {
    const key = '2026-06-22';
    const rivalId = getDailyRival(key).id;
    const pick = CANDIDATES.find((c) => c.id !== rivalId)!.id;
    const a = resolveDailyOpponents(key, pick);
    const b = resolveDailyOpponents(key, pick);

    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.length).toBe(getDailyChallengeConfig(key).opponentCount);
    expect(a.some((c) => c.id === pick)).toBe(false);
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
  });

  it('never collides with the chosen candidate for any non-rival pick; rival is opponent #1', () => {
    const key = '2026-07-04';
    const rivalId = getDailyRival(key).id;
    for (const player of CANDIDATES) {
      if (player.id === rivalId) continue; // the player is barred from picking the rival
      const opps = resolveDailyOpponents(key, player.id);
      expect(opps.some((c) => c.id === player.id)).toBe(false);
      expect(opps[0].id).toBe(rivalId);
      expect(opps.length).toBeGreaterThanOrEqual(1);
      expect(opps.length).toBeLessThanOrEqual(3);
    }
  });

  it('the daily rival is boosted: positive stats doubled, penalties unchanged', () => {
    const key = '2026-06-22';
    const base = CANDIDATE_MAP[getDailyRival(key).id];
    const pick = CANDIDATES.find((c) => c.id !== base.id)!.id;
    const boosted = resolveDailyOpponents(key, pick)[0];
    expect(boosted.id).toBe(base.id);
    for (const k of Object.keys(base.affinities)) {
      const v = base.affinities[k];
      expect(boosted.affinities[k]).toBe(v > 0 ? v * 2 : v);
    }
    for (const k of Object.keys(base.payoutModifiers)) {
      const v = base.payoutModifiers[k];
      expect(boosted.payoutModifiers[k]).toBe(v > 0 ? v * 2 : v);
    }
  });

  it('boostPositiveStats doubles positives only and never mutates the source', () => {
    const reagan = CANDIDATE_MAP['ronald_reagan'];
    const beforeAff = { ...reagan.affinities };
    const beforePay = { ...reagan.payoutModifiers };
    const boosted = boostPositiveStats(reagan);
    expect(boosted.payoutModifiers['Big Conservative']).toBe(reagan.payoutModifiers['Big Conservative'] * 2);
    expect(boosted.affinities['High Tech']).toBe(reagan.affinities['High Tech']); // penalty (<0) unchanged
    expect(reagan.affinities).toEqual(beforeAff); // base untouched
    expect(reagan.payoutModifiers).toEqual(beforePay);
    expect(boosted).not.toBe(reagan);
  });
});
