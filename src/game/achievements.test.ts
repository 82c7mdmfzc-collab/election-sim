import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_BY_ID,
  DEFAULT_ACHIEVEMENT_COUNTERS,
  claimableAchievements,
  isAchievementComplete,
  normalizeAchievementCounters,
  normalizeDailyStreak,
  streakRewardForDay,
} from './achievements';

describe('achievements', () => {
  it('caps individual achievement rewards at 100 Campaign Funds', () => {
    for (const achievement of Object.values(ACHIEVEMENT_BY_ID)) {
      expect(achievement.reward).toBeLessThanOrEqual(100);
      expect(achievement.reward).toBeGreaterThan(0);
    }
  });

  it('recognizes completed-but-unclaimed achievements', () => {
    const counters = normalizeAchievementCounters({
      gamesFinished: 10,
      gamesWon: 1,
    });
    const claimable = claimableAchievements(counters, ['campaign_finish_first']);

    expect(claimable.map((a) => a.id)).toContain('campaign_win_first');
    expect(claimable.map((a) => a.id)).toContain('campaign_finish_10');
    expect(claimable.map((a) => a.id)).not.toContain('campaign_finish_first');
  });

  it('keeps unfinished achievements locked', () => {
    const counters = { ...DEFAULT_ACHIEVEMENT_COUNTERS, botHardWins: 0 };
    expect(isAchievementComplete(ACHIEVEMENT_BY_ID.bot_beat_hard, counters)).toBe(false);
  });

  it('normalizes malformed counters and daily streaks', () => {
    expect(normalizeAchievementCounters({ fastestWinTurn: 11 }).fastestWinTurn).toBe(11);
    expect(normalizeAchievementCounters({}).fastestWinTurn).toBeNull();
    expect(normalizeDailyStreak({ count: -2, lastDate: '' })).toEqual({ count: 0, lastDate: null });
  });
});

describe('daily streak rewards', () => {
  it('steps through 14 days then stays capped at 100', () => {
    expect(streakRewardForDay(1)).toBe(10);
    expect(streakRewardForDay(14)).toBe(100);
    expect(streakRewardForDay(15)).toBe(100);
    expect(streakRewardForDay(99)).toBe(100);
  });

  it('does not reward invalid streak days', () => {
    expect(streakRewardForDay(0)).toBe(0);
    expect(streakRewardForDay(-4)).toBe(0);
  });
});
