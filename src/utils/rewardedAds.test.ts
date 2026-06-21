import { describe, expect, it } from 'vitest';
import {
  AD_REWARD_LIMIT,
  AD_REWARD_WINDOW_MS,
  adRewardStatusFromTimestamps,
} from './rewardedAds';

describe('adRewardStatusFromTimestamps', () => {
  it('counts only rewarded ads inside the rolling 12 hour window', () => {
    const now = 1_000_000_000;
    const status = adRewardStatusFromTimestamps([
      now - AD_REWARD_WINDOW_MS - 1,
      now - 1_000,
      now - 2_000,
    ], now);

    expect(status.watched).toBe(2);
    expect(status.remaining).toBe(AD_REWARD_LIMIT - 2);
    expect(status.nextResetAt).toBeNull();
  });

  it('reports the next reset time when the local quota is full', () => {
    const now = 1_000_000_000;
    const oldest = now - 20_000;
    const status = adRewardStatusFromTimestamps([
      oldest,
      now - 16_000,
      now - 12_000,
      now - 8_000,
      now - 4_000,
    ], now);

    expect(status.watched).toBe(AD_REWARD_LIMIT);
    expect(status.remaining).toBe(0);
    expect(status.nextResetAt).toBe(new Date(oldest + AD_REWARD_WINDOW_MS).toISOString());
  });
});
