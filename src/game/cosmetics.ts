/**
 * cosmetics.ts — the repeat-spend cosmetic catalog (pure data, no IO).
 *
 * Mirrors the existing cosmetic precedents (game/borders.ts, game/victoryMessages.ts):
 * each item has a stable id + Campaign Funds unlockCost, looked up via a MAP and
 * gated by an availability check. Selection is stored device-side in localPrefs.
 *
 * Cosmetics are PURELY visual and MUST NOT affect gameplay (no pay-to-win).
 *
 * All three categories are live: `share_frame` (end-game card), `map_theme`
 * (recolors the board — see game/mapTheme.ts), and `profile_banner` (shown on the
 * profile modal + leaderboard rows — CSS recipes in App.css). Priced unlocks are
 * server-validated by `unlock_cosmetic` (supabase/cosmetics.sql), which grants a
 * `cosmetic:<id>` token. Items flagged `seasonExclusive` are NOT purchasable —
 * they can only be granted by the Season pass (supabase/season.sql); they still
 * render/equip once owned.
 */

export type CosmeticCategory = 'share_frame' | 'map_theme' | 'profile_banner';

export interface CosmeticDef {
  readonly id: string;
  readonly category: CosmeticCategory;
  readonly name: string;
  readonly description: string;
  /** Campaign Funds price. 0 = always available. Ignored when `seasonExclusive`. */
  readonly unlockCost: number;
  /** Only obtainable via the Season pass — hidden from the shop's buy rails. */
  readonly seasonExclusive?: boolean;
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
  { id: 'patriot',  category: 'share_frame', name: 'Patriot',       description: 'Bold red-white-blue result card.', unlockCost: 3000 },
  { id: 'gold',     category: 'share_frame', name: 'Gold Standard', description: 'Black-tie gold result card.',     unlockCost: 3000 },
  { id: 'campaign_trail', category: 'share_frame', name: 'Campaign Trail', description: 'Season 1 exclusive result card.', unlockCost: 0, seasonExclusive: true },
  // ── map_theme (LIVE — see game/mapTheme.ts) ────────────────────────────────────
  { id: 'theme_dusk',           category: 'map_theme', name: 'Dusk Map',    description: 'A warm dusk palette for the board.', unlockCost: 800 },
  { id: 'theme_marble',         category: 'map_theme', name: 'Marble Map',  description: 'An ivory board with navy hairlines.', unlockCost: 1200 },
  { id: 'theme_midnight_gold',  category: 'map_theme', name: 'Midnight Gold', description: 'Near-black board trimmed in gold.', unlockCost: 0, seasonExclusive: true },
  // ── profile_banner (LIVE — CSS recipes in App.css) ─────────────────────────────
  { id: 'banner_laurel',    category: 'profile_banner', name: 'Laurel',      description: 'A laurel wreath banner for your profile.', unlockCost: 500 },
  { id: 'banner_stars',     category: 'profile_banner', name: 'Stars & Stripes', description: 'Red-white-blue stars banner.',      unlockCost: 800 },
  { id: 'banner_circuit',   category: 'profile_banner', name: 'Circuit',     description: 'Season 1 free-track banner.',    unlockCost: 0, seasonExclusive: true },
  { id: 'banner_coalition', category: 'profile_banner', name: 'Coalition',   description: 'Won with three candidates.',      unlockCost: 0, seasonExclusive: true },
  { id: 'banner_gilded',    category: 'profile_banner', name: 'Gilded',      description: 'Campaign Trail premium banner.',  unlockCost: 0, seasonExclusive: true },
  { id: 'banner_s1_champion', category: 'profile_banner', name: 'S1 Champion', description: 'Completed the Season 1 pass.',  unlockCost: 0, seasonExclusive: true },
];

export const COSMETIC_MAP: Record<string, CosmeticDef> =
  Object.fromEntries(COSMETICS.map((c) => [c.id, c]));

export function cosmeticsByCategory(category: CosmeticCategory): CosmeticDef[] {
  return COSMETICS.filter((c) => c.category === category);
}

/** Category items a player can BUY (season-exclusive rewards are hidden from the shop). */
export function purchasableCosmetics(category: CosmeticCategory): CosmeticDef[] {
  return COSMETICS.filter((c) => c.category === category && !c.seasonExclusive);
}

/** True when the id names a real profile_banner cosmetic (used by ProfileBanner). */
export function isBannerId(id: string | null | undefined): id is string {
  if (!id) return false;
  const c = COSMETIC_MAP[id];
  return !!c && c.category === 'profile_banner';
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
