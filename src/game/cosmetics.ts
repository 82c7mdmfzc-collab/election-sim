/**
 * cosmetics.ts — the repeat-spend cosmetic catalog (pure data, no IO).
 *
 * Mirrors the existing cosmetic precedents (game/borders.ts, game/victoryMessages.ts):
 * each item has a stable id + Campaign Funds unlockCost, looked up via a MAP and
 * gated by an availability check. Selection is stored device-side in localPrefs.
 *
 * Cosmetics are PURELY visual and MUST NOT affect gameplay (no pay-to-win).
 *
 * v1 ships the `share_frame` category live (themes for the end-game share card).
 * `map_theme` / `profile_banner` are typed and listed as `comingSoon` placeholders;
 * priced unlocks will validate server-side later (mirror `unlock_character` in
 * supabase/profiles.sql) — see the TODO in components/Shop.tsx.
 */

export type CosmeticCategory = 'share_frame' | 'map_theme' | 'profile_banner';

export interface CosmeticDef {
  readonly id: string;
  readonly category: CosmeticCategory;
  readonly name: string;
  readonly description: string;
  /** Campaign Funds price. 0 = always available. */
  readonly unlockCost: number;
  /** Not yet purchasable/equippable — shown as a teaser placeholder. */
  readonly comingSoon?: boolean;
}

/** Palette applied to the share card for a given `share_frame` cosmetic. */
export interface ShareFramePalette {
  readonly bg: string;
  readonly accent: string;   // top rule + section label
  readonly heading: string;  // winner name
  readonly subhead: string;  // EV / subtitle
  readonly neutral: string;  // unsecured states
}

export const SHARE_FRAME_PALETTES: Record<string, ShareFramePalette> = {
  // `midnight` intentionally matches the original hard-coded share card, so the
  // default rendering (and ShareCard.test.tsx) is byte-for-byte unchanged.
  midnight: { bg: '#0b1220', accent: '#f59e0b', heading: '#f8fafc', subhead: '#facc15', neutral: '#334155' },
  patriot:  { bg: '#0a1a3f', accent: '#e23b4e', heading: '#ffffff', subhead: '#7db1ff', neutral: '#2a3a63' },
  gold:     { bg: '#16130a', accent: '#f5c451', heading: '#fff7e6', subhead: '#f5c451', neutral: '#3a3320' },
};

export const DEFAULT_SHARE_FRAME_ID = 'midnight';

export const COSMETICS: readonly CosmeticDef[] = [
  // ── share_frame (LIVE) ────────────────────────────────────────────────────────
  { id: 'midnight', category: 'share_frame', name: 'Midnight',      description: 'The classic navy result card.',  unlockCost: 0 },
  { id: 'patriot',  category: 'share_frame', name: 'Patriot',       description: 'Bold red-white-blue result card.', unlockCost: 600 },
  { id: 'gold',     category: 'share_frame', name: 'Gold Standard', description: 'Black-tie gold result card.',     unlockCost: 600 },
  // ── placeholders (typed; not yet equippable) ───────────────────────────────────
  { id: 'theme_dusk',    category: 'map_theme',      name: 'Dusk Map',      description: 'A warm dusk palette for the board.', unlockCost: 800, comingSoon: true },
  { id: 'banner_laurel', category: 'profile_banner', name: 'Laurel Banner', description: 'A laurel banner for your profile.',  unlockCost: 500, comingSoon: true },
];

export const COSMETIC_MAP: Record<string, CosmeticDef> =
  Object.fromEntries(COSMETICS.map((c) => [c.id, c]));

export function cosmeticsByCategory(category: CosmeticCategory): CosmeticDef[] {
  return COSMETICS.filter((c) => c.category === category);
}

/** Free cosmetics are always usable; priced ones require an unlock token `cosmetic:<id>`. */
export function isCosmeticAvailable(id: string, unlocked: readonly string[]): boolean {
  const c = COSMETIC_MAP[id];
  if (!c) return false;
  return c.unlockCost === 0 || unlocked.includes(`cosmetic:${id}`);
}

/** Resolve a `share_frame` id (or null/unknown) to its palette, falling back to default. */
export function shareFramePalette(id: string | null | undefined): ShareFramePalette {
  if (id && SHARE_FRAME_PALETTES[id]) return SHARE_FRAME_PALETTES[id];
  return SHARE_FRAME_PALETTES[DEFAULT_SHARE_FRAME_ID];
}
