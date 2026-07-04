import { describe, expect, it } from 'vitest';
import { compareDailyScores, isBetterDailyScore, parseDailyLeaderboardResult } from './dailyRankings';

describe('dailyRankings', () => {
  const base = {
    dateKey: '2026-07-02',
    won: true,
    ev: 300,
    turns: 14,
    securedStates: 8,
    coalitions: 3,
    submittedAt: '2026-07-02T12:00:00Z',
  };

  it('sorts by win, EV, speed, map control, then submission time', () => {
    expect(compareDailyScores({ ...base, won: true }, { ...base, won: false, ev: 538 })).toBeLessThan(0);
    expect(compareDailyScores({ ...base, ev: 320 }, { ...base, ev: 300 })).toBeLessThan(0);
    expect(compareDailyScores({ ...base, turns: 12 }, { ...base, turns: 14 })).toBeLessThan(0);
    expect(compareDailyScores({ ...base, securedStates: 10 }, { ...base, securedStates: 8 })).toBeLessThan(0);
    expect(compareDailyScores({ ...base, submittedAt: '2026-07-02T11:00:00Z' }, base)).toBeLessThan(0);
  });

  it('detects replacement-worthy scores', () => {
    expect(isBetterDailyScore({ ...base, ev: 301 }, base)).toBe(true);
    expect(isBetterDailyScore({ ...base, ev: 299 }, base)).toBe(false);
  });

  it('parses leaderboard payloads defensively', () => {
    const parsed = parseDailyLeaderboardResult({
      top: [{ rank: 1, name: 'Ada', won: true, ev: 330, turns: 12, securedStates: 9, coalitions: 4, isMe: true }],
      me: { rank: 1, name: 'Ada', won: true, ev: 330, turns: 12, securedStates: 9, coalitions: 4, isMe: true },
    });
    expect(parsed.rows[0].name).toBe('Ada');
    expect(parsed.me?.isMe).toBe(true);
  });
});
