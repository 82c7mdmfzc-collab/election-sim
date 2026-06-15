/**
 * profile.ts — the meta-progression model and its persistence helpers.
 *
 * A Profile holds everything that survives between games: Campaign Funds,
 * unlocked characters, and lifetime stats. This economy is ACCOUNT-ONLY — it
 * lives in the Supabase `profiles` table keyed to a durable auth.uid() and is
 * mutated only via SECURITY DEFINER RPCs. There is no guest/localStorage
 * economy: a signed-out player simply has no funds, unlocks, or stats.
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

// ── Remote (Supabase) ─────────────────────────────────────────────────────────

interface ProfileRow {
  campaign_funds: number;
  unlocked_characters: string[];
  stats: Partial<ProfileStats> | null;
  display_name?: string | null;
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    campaignFunds: row.campaign_funds ?? 0,
    unlockedCharacters: row.unlocked_characters ?? [],
    selectedBorder: 'classic', // no DB column yet — border is a cosmetic default
    stats: { ...DEFAULT_STATS, ...(row.stats ?? {}) },
  };
}

export interface RemoteAccount {
  profile: Profile;
  displayName: string | null;
}

/** Fetch the signed-in user's account (economy + permanent username). Null if
 *  not configured / no row. */
export async function fetchRemoteAccount(userId: string): Promise<RemoteAccount | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('campaign_funds, unlocked_characters, stats, display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ProfileRow;
  return { profile: rowToProfile(row), displayName: row.display_name ?? null };
}

/** Persist non-sensitive fields (stats) to the owner row. Funds/unlocks use RPCs. */
export async function pushRemoteStats(userId: string, stats: ProfileStats): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabase.from('profiles').update({ stats, updated_at: new Date().toISOString() }).eq('id', userId);
}

/**
 * Server-authoritative reward claim. The SERVER computes the amount from the
 * (range-checked) game outcome and dedups by game_id, so the client can neither
 * pick the amount nor replay a game for more funds. Returns the new balance, or
 * null on failure. See supabase/rewards.sql.
 */
export async function claimGameRewardRemote(args: {
  gameId: string;
  won: boolean;
  securedStates: number;
  coalitionsDominated: number;
  winStreak: number;
}): Promise<number | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('claim_game_reward', {
    p_game_id: args.gameId,
    p_won: args.won,
    p_secured: args.securedStates,
    p_coalitions: args.coalitionsDominated,
    p_win_streak: args.winStreak,
  });
  if (error) {
    console.warn('claimGameRewardRemote failed:', error.message);
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
