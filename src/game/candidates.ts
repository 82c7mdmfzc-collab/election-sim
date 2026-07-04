/**
 * Candidate roster — the selectable presets for a new game.
 *
 * Each candidate carries asymmetric modifiers keyed to existing group IDs
 * (StateGroupId for geographic coalitions, NationalGroupId for the 5 ladders):
 *
 *   affinities       — COST modifiers. effectiveCost = baseCost * (1 - affinity).
 *                      Positive = cheaper buy-in, negative = cost penalty.
 *   payoutModifiers  — PROFIT modifiers. payout = basePayout * (1 + modifier).
 *                      Positive = extra profit, negative = profit reduction.
 *
 * Starting cash and per-turn base income are in $1k units (300 = $300k).
 *
 * ⚠️ Trump's Gun Lobby cost reduction is 0.15 (overridden from 0.20) and he
 * carries a +0.05 Swing States cost affinity (override) — see plan.
 */

export type PlayerColorId = 'red' | 'blue' | 'green' | 'purple';

/** Political party — cosmetic only (drives color + badge, never gameplay). */
export type Party = 'republican' | 'democrat' | 'independent';

/** Party → preferred seat color. */
export const PARTY_COLOR: Record<Party, PlayerColorId> = {
  republican: 'red',
  democrat: 'blue',
  independent: 'green',
};

export const PARTY_LABEL: Record<Party, string> = {
  republican: 'Republican',
  democrat: 'Democrat',
  independent: 'Independent',
};

export interface CandidateDef {
  readonly id: string;
  readonly name: string;
  /** Short initials/emoji used as a text fallback when the image hasn't loaded. */
  readonly portrait: string;
  /** Full-size portrait image served from /assets/portraits/. Used on SETUP cards. */
  readonly portraitUrl: string;
  /** Circular token image served from /assets/tokens/. Used in the HUD next to EV. */
  readonly tokenUrl: string;
  /** $1k units. */
  readonly startingCash: number;
  /** Optional flat War Chest income per turn in $1k units. Defaults to NATIONAL_INCOME. */
  readonly baseIncome?: number;
  /** Political party — cosmetic (sets color + badge, drives no gameplay). */
  readonly party: Party;
  /** Default political color (overridable per-seat at setup). */
  readonly color: PlayerColorId;
  readonly tagline: string;
  /** COST modifiers (cost reductions positive; penalties negative). */
  readonly affinities: Record<string, number>;
  /** PROFIT modifiers (extra profit positive; reductions negative). */
  readonly payoutModifiers: Record<string, number>;
  /**
   * Campaign Funds price to unlock in the Shop. 0 = always available (the
   * founding roster). Must match the server price catalog in
   * supabase/profiles.sql for any premium (>0) character.
   */
  readonly unlockCost: number;
}

// ── Group asset utilities ──────────────────────────────────────────────────────

/**
 * Convert a group ID string (which may contain spaces, &, or apostrophes) to
 * the snake_case filename slug used under /assets/groups/.
 *
 * Verified mappings:
 *   'African American'   → 'african_american'
 *   'Town and Gown'      → 'town_and_gown'
 *   'Manufacturing Base' → 'manufacturing_base'
 *   "Women's Vote"       → 'women_vote'
 *   'Latino'             → 'latino'
 */
export function slugifyGroupId(id: string): string {
  return id
    .toLowerCase()
    .replace(/'s\b/g, '')   // "women's" → "women"
    .replace(/[&']/g, '')   // remove remaining & and lone '
    .trim()
    .replace(/\s+/g, '_');  // spaces → underscore
}

/** Returns the public asset URL for a state or national group image. */
export function groupImageUrl(kind: 'state' | 'national', id: string): string {
  return `/assets/groups/${kind}/${slugifyGroupId(id)}.png`;
}

/**
 * ── Candidate price tiers (Campaign Funds) ──────────────────────────────────
 * The ONE place to set how much each character costs to unlock in the Shop.
 * Every candidate's `unlockCost` below is set from one of these tiers.
 *
 * ⚠️ Mirror any price change in BOTH server copies or purchases break / desync:
 *   • supabase/profiles.sql            → unlock_character() catalog
 *   • supabase/functions/resolve-turn/_engine/candidates.ts → unlockCost field
 */
export const CANDIDATE_PRICE = {
  FREE: 0,
  TIER1: 1500,
  TIER2: 4500,
  TIER3: 10000,
} as const;

export const CANDIDATES: readonly CandidateDef[] = [
  {
    id: 'tooley',
    name: 'Bobby Tooley',
    portrait: 'BT',
    portraitUrl: '/assets/portraits/bobby_tooley.jpg',
    tokenUrl: '/assets/tokens/bobby_tooley_token.png',
    startingCash: 300,
    baseIncome: 300,
    party: 'independent',
    color: 'green',
    tagline: 'The Grassroots Generalist — modest edges, no weaknesses.',
    unlockCost: CANDIDATE_PRICE.FREE,
    // ⚖️ Starter buff (2026-07-04): the old zero-modifier kit lost to every other
    // candidate (sim E3: 58.8–100% against). Smallest-granularity (0.05), penalty-
    // free bonuses spread wide — the "no downsides" generalist. Sim note: E3 vs a
    // blank slate saturates near ~70% for ANY small kit (a hard-bot mirror exploits
    // every edge), so keep magnitudes at 0.05 and avoid 'Swing States' (its cost
    // affinity alone measured +10pts over this kit).
    affinities: {
      'Agriculture': 0.05,
      'Manufacturing Base': 0.05,
    },
    payoutModifiers: {
      'Export Driven': 0.05,
      'Youth Vote': 0.05,
    },
  },
  {
    id: 'trump',
    name: 'Donald Trump',
    portrait: 'DT',
    portraitUrl: '/assets/portraits/donald_trump.jpg',
    tokenUrl: '/assets/tokens/donald_trump_token.png',
    startingCash: 250,
    party: 'republican',
    color: 'red',
    tagline: 'The Industrial Populist.',
    unlockCost: CANDIDATE_PRICE.FREE,
    affinities: {
      // cost reductions (Gun Lobby overridden 0.20 → 0.15)
      'Gun Lobby': 0.15,
      'Manufacturing Base': 0.15,
      'Oil and Gas': 0.15,
      'Agriculture': 0.10,
      'Swing States': 0.05, // override: new affinity
      // cost penalties
      'Town and Gown': -0.20,
      'High Tech': -0.15,
    },
    payoutModifiers: {
      'Big Conservative': 0.20,
      'Gun Lobby': 0.15,
      'Oil and Gas': 0.15,
      'Old South': 0.10,
      'Environmental': -0.20,
    },
  },
  {
    id: 'harris',
    name: 'Kamala Harris',
    portrait: 'KH',
    portraitUrl: '/assets/portraits/kamala_harris.jpg',
    tokenUrl: '/assets/tokens/kamala_harris_token.png',
    startingCash: 250,
    party: 'democrat',
    color: 'blue',
    tagline: 'The Metro Coalition.',
    unlockCost: CANDIDATE_PRICE.FREE,
    affinities: {
      'Environmental': 0.20,
      'High Tech': 0.15,
      'Big Conservative': -0.25,
      'Old South': -0.15,
      'Oil and Gas': -0.15,
    },
    payoutModifiers: {
      "Women's Vote": 0.20,
      'Environmental': 0.15,
      'Town and Gown': 0.10,
      'Oil and Gas': -0.15,
      'Gun Lobby': -0.20,
    },
  },
  {
    id: 'lincoln',
    name: 'Abraham Lincoln',
    portrait: 'AL',
    portraitUrl: '/assets/portraits/abraham_lincoln.jpg',
    tokenUrl: '/assets/tokens/abraham_lincoln_token.png',
    startingCash: 250,
    party: 'republican',
    color: 'red',
    tagline: 'The Centrist Unifier.',
    unlockCost: CANDIDATE_PRICE.FREE,
    affinities: {
      'African American': 0.15,
      'Manufacturing Base': 0.10,
      'Agriculture': 0.10,
      'Youth Vote': -0.20,
      'Big Conservative': -0.10,
      'Environmental': -0.10,
    },
    payoutModifiers: {
      'Swing States': 0.20,
      'Export Driven': 0.15,
      'Agriculture': 0.10,
      'High Tech': -0.15,
    },
  },
  // ── Premium roster (unlockable in the Shop) ────────────────────────────────
  {
    id: 'joe_biden',
    name: 'Joe Biden',
    portrait: 'JB',
    portraitUrl: '/assets/portraits/joe_biden.jpg',
    tokenUrl: '/assets/tokens/joe_biden_token.png',
    startingCash: 250,
    party: 'democrat',
    color: 'blue',
    tagline: 'The Union Hall Veteran.',
    // Given away for free — part of the founding roster (no Shop purchase).
    unlockCost: CANDIDATE_PRICE.FREE,
    affinities: {
      // cheaper buy-in
      'Manufacturing Base': 0.15,
      'African American': 0.15,
      'Town and Gown': 0.10,
      'Agriculture': 0.10,
      // cost penalties
      'Gun Lobby': -0.20,
      'Old South': -0.10,
    },
    payoutModifiers: {
      "Women's Vote": 0.15,
      'Environmental': 0.10,
      'Youth Vote': 0.10,
      'Big Conservative': -0.20,
    },
  },
  {
    id: 'ronald_reagan',
    name: 'Ronald Reagan',
    portrait: 'RR',
    portraitUrl: '/assets/portraits/ronald_reagan.jpg',
    tokenUrl: '/assets/tokens/ronald_reagan_token.png',
    startingCash: 250,
    party: 'republican',
    color: 'red',
    tagline: 'The Sun Belt Optimist.',
    unlockCost: CANDIDATE_PRICE.TIER2,
    affinities: {
      'Swing States': 0.20,
      'Old South': 0.20,
      'Big Conservative': 0.15,
      'Oil and Gas': 0.15,
      'High Tech': -0.10,
      'Town and Gown': -0.15,
    },
    payoutModifiers: {
      'Big Conservative': 0.20,
      'Old South': 0.15,
      'Swing States': 0.15,
      'Oil and Gas': 0.15,
      'Environmental': -0.20,
    },
  },
  // ── Limited-time promo (free for July signups; purchasable for Funds after) ──
  {
    id: 'washington',
    name: 'George Washington',
    portrait: 'GW',
    portraitUrl: '/assets/portraits/washington.jpg',
    tokenUrl: '/assets/tokens/washington_token.png',
    startingCash: 250,
    party: 'independent',
    color: 'green',
    tagline: 'The Nonpartisan Founder — a balanced sidegrade.',
    // 4,500 normally; free to CLAIM during July (see isCandidateFreeClaimAvailable +
    // the claim_free_character RPC). Stats unchanged — must stay net-neutral.
    unlockCost: CANDIDATE_PRICE.TIER2,
    // ⚖️ Cosmetic/sidegrade ONLY. A free (July-grant) character must not hand out a
    // concentrated economic edge, so these modifiers are deliberately small and sum
    // to ZERO on each axis: every perk is offset by an equal penalty. Net-neutral.
    affinities: {
      'Agriculture': 0.05,
      'Swing States': 0.05,
      'High Tech': -0.05,
      'Big Conservative': -0.05,
    },
    payoutModifiers: {
      'Swing States': 0.10,
      'Export Driven': 0.05,
      'Old South': -0.05,
      'Environmental': -0.10,
    },
  },
  {
    id: 'starmer',
    name: 'Keir Starmer',
    portrait: 'KS',
    portraitUrl: '/assets/portraits/starmer.jpg',
    tokenUrl: '/assets/tokens/starmer_token.png',
    startingCash: 250,
    party: 'democrat',
    color: 'blue',
    tagline: 'The Technocratic Centre.',
    unlockCost: CANDIDATE_PRICE.TIER2,
    affinities: {
      'High Tech': 0.20,
      'Town and Gown': 0.20,
      'Manufacturing Base': 0.15,
      'Big Conservative': -0.20,
      'Oil and Gas': -0.15,
      'Old South': -0.10,
    },
    payoutModifiers: {
      "Women's Vote": 0.20,
      'High Tech': 0.15,
      'Export Driven': 0.15,
      'Gun Lobby': -0.20,
    },
  },
  {
    id: 'farage',
    name: 'Nigel Farage',
    portrait: 'NF',
    portraitUrl: '/assets/portraits/farage.jpg',
    tokenUrl: '/assets/tokens/farage_token.png',
    startingCash: 250,
    party: 'republican',
    color: 'red',
    tagline: 'The Insurgent Populist.',
    unlockCost: CANDIDATE_PRICE.TIER3,
    affinities: {
      'Gun Lobby': 0.20,
      'Old South': 0.20,
      'Big Conservative': 0.15,
      'Oil and Gas': 0.15,
      'High Tech': -0.20,
      'Town and Gown': -0.15,
    },
    payoutModifiers: {
      'Big Conservative': 0.20,
      'Gun Lobby': 0.15,
      'Old South': 0.15,
      'Environmental': -0.20,
    },
  },
  {
    id: 'jfk',
    name: 'John F. Kennedy',
    portrait: 'JK',
    portraitUrl: '/assets/portraits/jfk.jpg',
    tokenUrl: '/assets/tokens/jfk_token.png',
    startingCash: 250,
    party: 'democrat',
    color: 'blue',
    tagline: 'The New Frontier.',
    unlockCost: CANDIDATE_PRICE.TIER2,
    affinities: {
      'High Tech': 0.20,
      'Youth Vote': 0.20,
      'African American': 0.15,
      'Big Conservative': -0.20,
      'Oil and Gas': -0.15,
      'Old South': -0.10,
    },
    payoutModifiers: {
      'Youth Vote': 0.20,
      'High Tech': 0.15,
      "Women's Vote": 0.15,
      'Gun Lobby': -0.20,
    },
  },
];

export const CANDIDATE_MAP: Record<string, CandidateDef> = Object.fromEntries(
  CANDIDATES.map((c) => [c.id, c]),
);

/** Characters that must be purchased before they can be selected. */
export const PREMIUM_CANDIDATES: readonly CandidateDef[] = CANDIDATES.filter((c) => c.unlockCost > 0);

/**
 * Whether a candidate is playable for the given set of owned/unlocked ids.
 * Founding roster (unlockCost 0) is always available.
 */
export function isCandidateAvailable(c: CandidateDef, unlocked: readonly string[]): boolean {
  return c.unlockCost === 0 || unlocked.includes(c.id);
}

/** Hex values for each seat color (mirrors the --p-* CSS vars). */
export const PLAYER_COLORS: Record<PlayerColorId, string> = {
  red: '#d8233c',
  blue: '#2563eb',
  green: '#1fa85b',
  purple: '#7c3aed',
};

/**
 * Colorblind-safe seat palette (Okabe–Ito), active when the player enables
 * "Colorblind-safe colors" in Settings. The four hues stay mutually
 * distinguishable under deuteranopia/protanopia — critically, no red↔green
 * collision. Routed through game/playerColors.playerColorHex; the matching
 * `html.cb-safe` CSS-var overrides live in App.css.
 */
export const PLAYER_COLORS_CB: Record<PlayerColorId, string> = {
  red: '#d55e00',    // vermillion
  blue: '#0072b2',   // blue
  green: '#009e73',  // bluish green
  purple: '#cc79a7', // reddish purple
};
