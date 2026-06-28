/**
 * Victory messages — a selectable cosmetic shown in the text box on the winner's
 * victory screen. The player equips one (stored device-side via localPrefs); the
 * default ships unlocked. Priced messages are unlocked through the shared
 * `cosmetic:<id>` token path.
 */

export interface VictoryMessage {
  readonly id: string;
  /** Short label for the picker. */
  readonly label: string;
  /** The speech shown in the victory text box. */
  readonly text: string;
  /** Campaign Funds price; 0 = always available. */
  readonly unlockCost: number;
}

export const VICTORY_MESSAGES: readonly VictoryMessage[] = [
  {
    id: 'classic',
    label: 'Gracious Victor',
    text: 'My fellow Americans — tonight the people have spoken, and together we march toward a brighter future. Thank you, and God bless.',
    unlockCost: 0,
  },
  {
    id: 'landslide',
    label: 'Landslide',
    text: 'From sea to shining sea, the map turned our way. This, my friends, is what a mandate looks like!',
    unlockCost: 3000,
  },
  {
    id: 'humble',
    label: 'Humbled',
    text: 'I am humbled by your trust, and I will work every single day to earn it. The real work starts now.',
    unlockCost: 3000,
  },
  {
    id: 'fired_up',
    label: 'Fired Up',
    text: 'They counted us out. They were wrong. 270 and beyond — now let’s get to work!',
    unlockCost: 3000,
  },
];

export const DEFAULT_VICTORY_MESSAGE_ID = 'classic';

const MESSAGE_MAP: Record<string, VictoryMessage> = Object.fromEntries(
  VICTORY_MESSAGES.map((m) => [m.id, m]),
);

/** Resolve a message id (or null/unknown) to its display text, falling back to the default. */
export function victoryMessageText(id: string | null | undefined): string {
  if (id && MESSAGE_MAP[id]) return MESSAGE_MAP[id].text;
  return MESSAGE_MAP[DEFAULT_VICTORY_MESSAGE_ID].text;
}

/** Free messages are always usable; priced ones require a `cosmetic:<id>` unlock token. */
export function isVictoryMessageAvailable(id: string | null | undefined, unlocked: readonly string[]): boolean {
  if (!id) return false;
  const message = MESSAGE_MAP[id];
  if (!message) return false;
  return message.unlockCost === 0 || unlocked.includes(`cosmetic:${id}`);
}
