import { describe, it, expect } from 'vitest';
import {
  parseSeasonStatus,
  currentTierNumber,
  seasonHeaderProgress,
  isTierClaimable,
  isTierClaimed,
  claimableCount,
  seasonCountdown,
  type SeasonStatus,
} from './season';

const RAW = {
  season: {
    id: 'season_1',
    title: 'Road to the White House',
    startsAt: '2026-07-06T00:00:00Z',
    endsAt: '2026-08-31T00:00:00Z',
    premiumCost: 4000,
    ended: false,
    tiers: [
      { tier: 1, cumXp: 100, free: { funds: 25 }, premium: { funds: 150, cosmetic: 'banner_gilded' } },
      { tier: 2, cumXp: 200, free: {}, premium: { funds: 150 } },
      { tier: 3, cumXp: 300, free: { funds: 50 }, premium: { funds: 175 } },
    ],
    objectives: [
      { id: 'coalition_builder', threshold: 3, xp: 200, cosmetic: 'banner_coalition' },
    ],
  },
  progress: { xp: 250, premium: false, candidatesWon: ['tooley', 'trump', 'harris'] },
  claims: [{ ref: '1', track: 'free' }],
};

describe('parseSeasonStatus', () => {
  it('parses the server catalog + progress + claims', () => {
    const s = parseSeasonStatus(RAW);
    expect(s.season?.id).toBe('season_1');
    expect(s.season?.tiers).toHaveLength(3);
    expect(s.progress.xp).toBe(250);
    expect(s.progress.candidatesWon).toEqual(['tooley', 'trump', 'harris']);
    expect(s.claims).toEqual([{ ref: '1', track: 'free' }]);
  });

  it('returns a null season when none is active', () => {
    expect(parseSeasonStatus({ season: null }).season).toBeNull();
    expect(parseSeasonStatus({}).season).toBeNull();
  });
});

describe('tier math', () => {
  const status: SeasonStatus = parseSeasonStatus(RAW);

  it('finds the current tier from xp', () => {
    expect(currentTierNumber(status.season!.tiers, 250)).toBe(2); // reached 200, not 300
  });

  it('computes header progress within the current band', () => {
    const h = seasonHeaderProgress(status.season!.tiers, 250);
    expect(h.tier).toBe(2);
    expect(h.xpToNext).toBe(50); // 300 - 250
    expect(h.pct).toBe(50);      // halfway from 200→300
  });

  it('gates premium claims behind the premium flag', () => {
    const t1 = status.season!.tiers[0];
    // Free tier 1 is reached but already claimed → not claimable.
    expect(isTierClaimed(status.claims, 1, 'free')).toBe(true);
    expect(isTierClaimable(t1, 'free', status)).toBe(false);
    // Premium tier 1 is reached + unclaimed but premium isn't unlocked → not claimable.
    expect(isTierClaimable(t1, 'premium', status)).toBe(false);
  });

  it('counts claimable rewards for the home-tile badge', () => {
    // xp 250 reaches tiers 1 & 2. Free t1 claimed; free t2 has no reward; free t3 not reached.
    // Premium locked → 0 premium. Objective met (3 candidates) + unclaimed → +1.
    expect(claimableCount(status)).toBe(1);
  });
});

describe('seasonCountdown', () => {
  const end = '2026-08-31T00:00:00Z';
  it('formats days remaining', () => {
    expect(seasonCountdown(end, Date.parse('2026-08-20T00:00:00Z'))).toBe('Ends in 11d');
  });
  it('formats hours on the final day', () => {
    expect(seasonCountdown(end, Date.parse('2026-08-30T20:00:00Z'))).toBe('Ends in 4h');
  });
  it('reports an ended season', () => {
    expect(seasonCountdown(end, Date.parse('2026-09-01T00:00:00Z'))).toBe('Season ended');
  });
});
