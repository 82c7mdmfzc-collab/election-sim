/**
 * season.ts — client model for the Campaign Trail season pass.
 *
 * The SERVER owns the reward catalog (supabase/season.sql → seasons.tiers /
 * objectives jsonb), returned verbatim by get_season_status. This module only
 * PARSES that catalog and computes derived, display-only values (current tier,
 * claimability, countdown) — it never authors reward amounts, so there is no
 * client/server drift to police.
 *
 * Pure + edge-safe (no DOM / localStorage), though only the app imports it.
 */

export interface SeasonTierReward {
  funds?: number;
  cosmetic?: string;
  masteryXp?: number;
}

export interface SeasonTier {
  tier: number;
  cumXp: number;
  free: SeasonTierReward;
  premium: SeasonTierReward;
}

export interface SeasonObjective {
  id: string;
  threshold: number;
  xp: number;
  funds?: number;
  cosmetic?: string;
}

export interface SeasonCatalog {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  premiumCost: number;
  tiers: SeasonTier[];
  objectives: SeasonObjective[];
  ended: boolean;
}

export interface SeasonProgress {
  xp: number;
  premium: boolean;
  candidatesWon: string[];
}

export type SeasonTrack = 'free' | 'premium' | 'objective';

export interface SeasonClaim {
  ref: string;
  track: SeasonTrack;
}

export interface SeasonStatus {
  season: SeasonCatalog | null;
  progress: SeasonProgress;
  claims: SeasonClaim[];
}

/** Player-facing copy for the Roster Objectives (server owns the amounts). */
export const OBJECTIVE_META: Record<string, { name: string; description: string }> = {
  coalition_builder: { name: 'Coalition Builder', description: 'Win with 3 different candidates.' },
  big_tent:          { name: 'Big Tent',          description: 'Win with 5 different candidates.' },
  party_unity:       { name: 'Party Unity',       description: 'Win with 7 different candidates.' },
};

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function parseReward(v: unknown): SeasonTierReward {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : {};
  const r: SeasonTierReward = {};
  if (num(o.funds) > 0) r.funds = num(o.funds);
  if (typeof o.cosmetic === 'string' && o.cosmetic) r.cosmetic = o.cosmetic;
  if (num(o.masteryXp) > 0) r.masteryXp = num(o.masteryXp);
  return r;
}

export const EMPTY_PROGRESS: SeasonProgress = { xp: 0, premium: false, candidatesWon: [] };

/** Parse the get_season_status jsonb into a typed status (season null = none active). */
export function parseSeasonStatus(data: unknown): SeasonStatus {
  const obj = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const s = obj.season && typeof obj.season === 'object' ? obj.season as Record<string, unknown> : null;

  const season: SeasonCatalog | null = s
    ? {
        id: String(s.id ?? ''),
        title: String(s.title ?? 'Season'),
        startsAt: String(s.startsAt ?? ''),
        endsAt: String(s.endsAt ?? ''),
        premiumCost: num(s.premiumCost, 4000),
        ended: s.ended === true,
        tiers: Array.isArray(s.tiers)
          ? s.tiers.map((t) => {
              const o = t as Record<string, unknown>;
              return {
                tier: num(o.tier),
                cumXp: num(o.cumXp),
                free: parseReward(o.free),
                premium: parseReward(o.premium),
              };
            }).sort((a, b) => a.tier - b.tier)
          : [],
        objectives: Array.isArray(s.objectives)
          ? s.objectives.map((o) => {
              const r = o as Record<string, unknown>;
              return {
                id: String(r.id ?? ''),
                threshold: num(r.threshold),
                xp: num(r.xp),
                funds: num(r.funds) > 0 ? num(r.funds) : undefined,
                cosmetic: typeof r.cosmetic === 'string' && r.cosmetic ? r.cosmetic : undefined,
              };
            })
          : [],
      }
    : null;

  const p = obj.progress && typeof obj.progress === 'object' ? obj.progress as Record<string, unknown> : {};
  const progress: SeasonProgress = {
    xp: num(p.xp),
    premium: p.premium === true,
    candidatesWon: Array.isArray(p.candidatesWon) ? p.candidatesWon.filter((c): c is string => typeof c === 'string') : [],
  };

  const claims: SeasonClaim[] = Array.isArray(obj.claims)
    ? obj.claims
        .map((c) => c as Record<string, unknown>)
        .filter((c) => typeof c.ref === 'string' && typeof c.track === 'string')
        .map((c) => ({ ref: String(c.ref), track: c.track as SeasonTrack }))
    : [];

  return { season, progress, claims };
}

/** Highest tier number whose cumXp the player has reached (0 = none yet). */
export function currentTierNumber(tiers: SeasonTier[], xp: number): number {
  let best = 0;
  for (const t of tiers) if (xp >= t.cumXp) best = Math.max(best, t.tier);
  return best;
}

export interface SeasonHeaderProgress {
  tier: number;
  isMax: boolean;
  /** XP into the current tier band. */
  xpIntoTier: number;
  /** Width of the current tier band. */
  xpForTier: number;
  pct: number;
  /** XP remaining to the next tier (0 at max). */
  xpToNext: number;
}

/** Where the player sits on the track, for the header XP bar. */
export function seasonHeaderProgress(tiers: SeasonTier[], xp: number): SeasonHeaderProgress {
  const tier = currentTierNumber(tiers, xp);
  const maxTier = tiers.length ? tiers[tiers.length - 1].tier : 0;
  const isMax = tier >= maxTier && maxTier > 0;
  const prevCum = tier > 0 ? (tiers.find((t) => t.tier === tier)?.cumXp ?? 0) : 0;
  const next = tiers.find((t) => t.tier === tier + 1);
  const nextCum = next?.cumXp ?? prevCum;
  const xpForTier = Math.max(0, nextCum - prevCum);
  const xpIntoTier = Math.max(0, xp - prevCum);
  const pct = isMax ? 100 : Math.max(0, Math.min(100, Math.round((xpIntoTier / Math.max(1, xpForTier)) * 100)));
  return { tier, isMax, xpIntoTier, xpForTier, pct, xpToNext: isMax ? 0 : Math.max(0, nextCum - xp) };
}

export function isTierClaimed(claims: SeasonClaim[], tier: number, track: 'free' | 'premium'): boolean {
  return claims.some((c) => c.track === track && c.ref === String(tier));
}

export function isObjectiveClaimed(claims: SeasonClaim[], objectiveId: string): boolean {
  return claims.some((c) => c.track === 'objective' && c.ref === objectiveId);
}

/** True when a tier's reward on this track is earned, unclaimed, and (if premium) unlocked. */
export function isTierClaimable(
  t: SeasonTier,
  track: 'free' | 'premium',
  status: SeasonStatus,
): boolean {
  const reward = t[track];
  if (!reward.funds && !reward.cosmetic && !reward.masteryXp) return false;
  if (status.progress.xp < t.cumXp) return false;
  if (track === 'premium' && !status.progress.premium) return false;
  return !isTierClaimed(status.claims, t.tier, track);
}

/** Count of unclaimed, currently-earned rewards (drives the home-tile badge). */
export function claimableCount(status: SeasonStatus): number {
  if (!status.season) return 0;
  let n = 0;
  for (const t of status.season.tiers) {
    if (isTierClaimable(t, 'free', status)) n++;
    if (isTierClaimable(t, 'premium', status)) n++;
  }
  for (const o of status.season.objectives) {
    if (status.progress.candidatesWon.length >= o.threshold && !isObjectiveClaimed(status.claims, o.id)) n++;
  }
  return n;
}

/** "Ends in 12d" / "Ends in 6h" / "Season ended". `nowMs` is injected (edge-safe). */
export function seasonCountdown(endsAt: string, nowMs: number): string {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return '';
  const ms = end - nowMs;
  if (ms <= 0) return 'Season ended';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `Ends in ${days}d`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `Ends in ${hours}h`;
}
