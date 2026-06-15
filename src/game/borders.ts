/**
 * borders.ts — cosmetic avatar frames ("borders").
 *
 * A border is a ring/frame image with a transparent center hole that overlays a
 * character token, so any frame fits any candidate. The default `classic` ships
 * free; further borders are a data add + an image drop and can later become Shop
 * cosmetics (give them an `unlockCost > 0` and gate them like premium candidates).
 *
 * Art spec (per frame): 512×512 PNG, outer edge at the canvas, transparent inner
 * circle ≈432px (≈84%) centered — identical geometry across all borders so they
 * line up on every avatar.
 */

export interface BorderDef {
  readonly id: string;
  readonly name: string;
  /** Campaign Funds price. 0 = always available. */
  readonly unlockCost: number;
}

export const BORDERS: readonly BorderDef[] = [
  { id: 'classic', name: 'Classic',     unlockCost: 0 },
  { id: 'gold',    name: 'Gold Laurel', unlockCost: 750 },
  { id: 'stars',   name: 'Stars & Bars', unlockCost: 750 },
];

export const BORDER_MAP: Record<string, BorderDef> =
  Object.fromEntries(BORDERS.map((b) => [b.id, b]));

export const DEFAULT_BORDER_ID = 'classic';

/** Public asset URL for a border frame. */
export function borderImageUrl(id: string): string {
  return `/assets/borders/${id}.png`;
}

/** Founding (free) borders are always usable; others require an unlock. */
export function isBorderAvailable(id: string, unlocked: readonly string[]): boolean {
  const b = BORDER_MAP[id];
  if (!b) return false;
  return b.unlockCost === 0 || unlocked.includes(`border:${id}`);
}
