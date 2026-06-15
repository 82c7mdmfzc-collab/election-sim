/**
 * profile.ts — the meta-progression model and its persistence helpers.
 *
 * A Profile holds everything that survives between games: Campaign Funds,
 * unlocked characters, and lifetime stats. It is mirrored to localStorage so
 * guest/offline play works immediately, and synced to the Supabase `profiles`
 * table (via SECURITY DEFINER RPCs) when the device has a session.
 *
 * The Zustand store + React hook live in src/hooks/useProfile.ts; this module is
 * pure data + IO so it stays easy to reason about and reuse.
 */

import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';

export interface ProfileStats {
  gamesPlayed: number;
  gamesWon: number;
  winStreak: number;
  bestWinStreak: number;
  coalitionsDominated: number;
}

export interface Profile {
  campaignFunds: number;
  unlockedCharacters: string[];
  /** Cosmetic avatar frame id (see src/game/borders.ts). Local-only for now. */
  selectedBorder: string;
  stats: ProfileStats;
}

export const DEFAULT_STATS: ProfileStats = {
  gamesPlayed: 0,
  gamesWon: 0,
  winStreak: 0,
  bestWinStreak: 0,
  coalitionsDominated: 0,
};

export const DEFAULT_PROFILE: Profile = {
  campaignFunds: 0,
  unlockedCharacters: [],
  selectedBorder: 'classic',
  stats: { ...DEFAULT_STATS },
};

const LS_KEY = 'election-sim-profile-v1';

// ── localStorage mirror ───────────────────────────────────────────────────────

export function loadLocalProfile(): Profile {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_PROFILE);
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      campaignFunds: parsed.campaignFunds ?? 0,
      unlockedCharacters: parsed.unlockedCharacters ?? [],
      selectedBorder: parsed.selectedBorder ?? 'classic',
      stats: { ...DEFAULT_STATS, ...(parsed.stats ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_PROFILE);
  }
}

export function saveLocalProfile(p: Profile): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — ignore */
  }
}

// ── Remote (Supabase) ─────────────────────────────────────────────────────────

interface ProfileRow {
  campaign_funds: number;
  unlocked_characters: string[];
  stats: Partial<ProfileStats> | null;
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    campaignFunds: row.campaign_funds ?? 0,
    unlockedCharacters: row.unlocked_characters ?? [],
    selectedBorder: 'classic', // no DB column yet — border is a local-only preference
    stats: { ...DEFAULT_STATS, ...(row.stats ?? {}) },
  };
}

/** Fetch the signed-in user's profile row. Null if not configured / no row. */
export async function fetchRemoteProfile(userId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('campaign_funds, unlocked_characters, stats')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToProfile(data as ProfileRow);
}

/** Persist non-sensitive fields (stats) to the owner row. Funds/unlocks use RPCs. */
export async function pushRemoteStats(userId: string, stats: ProfileStats): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabase.from('profiles').update({ stats, updated_at: new Date().toISOString() }).eq('id', userId);
}

/** Server-validated funds award. Returns the new balance, or null on failure. */
export async function awardFundsRemote(amount: number): Promise<number | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('award_funds', { p_amount: amount });
  if (error) {
    console.warn('awardFundsRemote failed:', error.message);
    return null;
  }
  return data as number;
}

/** Server-validated character unlock (server owns the price). Returns updated profile. */
export async function unlockCharacterRemote(characterId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('unlock_character', { p_character: characterId });
  if (error) {
    console.warn('unlockCharacterRemote failed:', error.message);
    return null;
  }
  return data ? rowToProfile(data as ProfileRow) : null;
}

/**
 * Reconcile a freshly-loaded remote profile with the local mirror. Takes the
 * higher Campaign Funds and the union of unlocks so a guest who earned offline
 * doesn't lose progress when their account loads. Stats take the larger totals.
 */
export function mergeProfiles(local: Profile, remote: Profile): Profile {
  return {
    campaignFunds: Math.max(local.campaignFunds, remote.campaignFunds),
    unlockedCharacters: [...new Set([...local.unlockedCharacters, ...remote.unlockedCharacters])],
    // Border is a local-only cosmetic preference until it gets a DB column.
    selectedBorder: local.selectedBorder ?? remote.selectedBorder ?? 'classic',
    stats: {
      gamesPlayed: Math.max(local.stats.gamesPlayed, remote.stats.gamesPlayed),
      gamesWon: Math.max(local.stats.gamesWon, remote.stats.gamesWon),
      winStreak: remote.stats.winStreak, // streak is "current" — trust the account
      bestWinStreak: Math.max(local.stats.bestWinStreak, remote.stats.bestWinStreak),
      coalitionsDominated: Math.max(local.stats.coalitionsDominated, remote.stats.coalitionsDominated),
    },
  };
}
