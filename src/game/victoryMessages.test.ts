import { describe, expect, it } from 'vitest';
import { DEFAULT_VICTORY_MESSAGE_ID, isVictoryMessageAvailable, victoryMessageText } from './victoryMessages';

describe('victoryMessages', () => {
  it('keeps the default message available without an unlock token', () => {
    expect(isVictoryMessageAvailable(DEFAULT_VICTORY_MESSAGE_ID, [])).toBe(true);
  });

  it('requires a cosmetic token for paid messages', () => {
    expect(isVictoryMessageAvailable('landslide', [])).toBe(false);
    expect(isVictoryMessageAvailable('landslide', ['cosmetic:landslide'])).toBe(true);
  });

  it('falls back to the default text for unknown message ids', () => {
    expect(victoryMessageText('missing')).toBe(victoryMessageText(DEFAULT_VICTORY_MESSAGE_ID));
    expect(isVictoryMessageAvailable('missing', ['cosmetic:missing'])).toBe(false);
  });
});
