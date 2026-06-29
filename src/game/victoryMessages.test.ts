import { describe, expect, it } from 'vitest';
import { DEFAULT_VICTORY_MESSAGE_ID, VICTORY_MESSAGES, isVictoryMessageAvailable, victoryMessageText } from './victoryMessages';

describe('victoryMessages', () => {
  it('keeps the default message available without an unlock token', () => {
    expect(isVictoryMessageAvailable(DEFAULT_VICTORY_MESSAGE_ID, [])).toBe(true);
  });

  it('requires a cosmetic token for paid messages', () => {
    expect(isVictoryMessageAvailable('landslide', [])).toBe(false);
    expect(isVictoryMessageAvailable('landslide', ['cosmetic:landslide'])).toBe(true);
  });

  it('requires cosmetic tokens for the meme messages', () => {
    const memeMessages = VICTORY_MESSAGES.filter((m) => m.tone === 'meme');

    expect(memeMessages.map((m) => m.id)).toEqual([
      'map_math',
      'recount_denied',
      'coalition_chef',
      'swing_state_slayer',
      'mandate_mode',
      'campaign_receipts',
    ]);
    for (const message of memeMessages) {
      expect(isVictoryMessageAvailable(message.id, [])).toBe(false);
      expect(isVictoryMessageAvailable(message.id, [`cosmetic:${message.id}`])).toBe(true);
    }
  });

  it('falls back to the default text for unknown message ids', () => {
    expect(victoryMessageText('missing')).toBe(victoryMessageText(DEFAULT_VICTORY_MESSAGE_ID));
    expect(isVictoryMessageAvailable('missing', ['cosmetic:missing'])).toBe(false);
  });
});
