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
import type { AdRewardStatus } from '../utils/rewardedAds';
import type { DailyChallengeLocal } from '../utils/localPrefs';
import {
  type AchievementCounters,
  type DailyStreakState,
  DEFAULT_DAILY_STREAK,
  normalizeAchievementCounters,
  normalizeDailyStreak,
  premiumUnlockCount,
} from './achievements';
import type { BotDifficulty } from './types';

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
  achievementCounters: AchievementCounters;
  claimedAchievements: string[];
  dailyStreak: DailyStreakState;
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
  achievementCounters: normalizeAchievementCounters(null),
  claimedAchievements: [],
  dailyStreak: { ...DEFAULT_DAILY_STREAK },
};

// ── Remote (Supabase) ─────────────────────────────────────────────────────────

interface ProfileRow {
  campaign_funds: number;
  unlocked_characters: string[];
  stats: Partial<ProfileStats> | null;
  achievement_counters?: Partial<AchievementCounters> | null;
  daily_streak?: Partial<DailyStreakState> | null;
  display_name?: string | null;
}

function rowToProfile(row: ProfileRow, claimedAchievements: string[] = []): Profile {
  const unlockedCharacters = row.unlocked_characters ?? [];
  const counters = normalizeAchievementCounters({
    ...(row.achievement_counters ?? {}),
    premiumUnlocks: Math.max(
      row.achievement_counters?.premiumUnlocks ?? 0,
      premiumUnlockCount(unlockedCharacters),
    ),
  });
  return {
    campaignFunds: row.campaign_funds ?? 0,
    unlockedCharacters,
    selectedBorder: 'classic', // no DB column yet — border is a cosmetic default
    stats: { ...DEFAULT_STATS, ...(row.stats ?? {}) },
    achievementCounters: counters,
    claimedAchievements,
    dailyStreak: normalizeDailyStreak(row.daily_streak),
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
    .select('campaign_funds, unlocked_characters, stats, achievement_counters, daily_streak, display_name')
    .eq('id', userId)
    .maybeSingle();

  let rowData: unknown = data;
  if (error) {
    // Allows older deployments to keep loading until the progression migration is applied.
    const fallback = await supabase
      .from('profiles')
      .select('campaign_funds, unlocked_characters, stats, display_name')
      .eq('id', userId)
      .maybeSingle();
    if (fallback.error || !fallback.data) return null;
    rowData = fallback.data;
  }
  if (!rowData) return null;

  const claimedAchievements = await fetchClaimedAchievements();
  const row = rowData as ProfileRow;
  return { profile: rowToProfile(row, claimedAchievements), displayName: row.display_name ?? null };
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

export type GameCompletionMode = 'single' | 'bot' | 'online';

export interface CompleteGameResultArgs {
  gameId: string;
  won: boolean;
  securedStates: number;
  coalitionsDominated: number;
  winStreak: number;
  mode: GameCompletionMode;
  botDifficulty: BotDifficulty | null;
  botCount: number;
  turns: number;
  electoralVotes: number;
  candidateId: string | null;
  opponentCount: number;
}

export interface CompleteGameResultRemote {
  balance: number;
  gameReward: number;
  dailyStreakReward: number;
  dailyStreakDay: number;
  stats: ProfileStats;
  achievementCounters: AchievementCounters;
  dailyStreak: DailyStreakState;
  newlyCompletedAchievements: string[];
  claimedAchievements: string[];
}

function jsonNumber(obj: Record<string, unknown>, key: string): number {
  const val = obj[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : 0;
}

function jsonStringArray(obj: Record<string, unknown>, key: string): string[] {
  const val = obj[key];
  return Array.isArray(val) ? val.filter((x): x is string => typeof x === 'string') : [];
}

function parseCompleteGameResult(data: unknown, fallbackClaimed: string[]): CompleteGameResultRemote | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  return {
    balance: jsonNumber(row, 'balance'),
    gameReward: jsonNumber(row, 'gameReward'),
    dailyStreakReward: jsonNumber(row, 'dailyStreakReward'),
    dailyStreakDay: jsonNumber(row, 'dailyStreakDay'),
    stats: { ...DEFAULT_STATS, ...((row.stats as Partial<ProfileStats> | null) ?? {}) },
    achievementCounters: normalizeAchievementCounters(row.achievementCounters as Partial<AchievementCounters> | null),
    dailyStreak: normalizeDailyStreak(row.dailyStreak as Partial<DailyStreakState> | null),
    newlyCompletedAchievements: jsonStringArray(row, 'newlyCompletedAchievements'),
    claimedAchievements: jsonStringArray(row, 'claimedAchievements').length > 0
      ? jsonStringArray(row, 'claimedAchievements')
      : fallbackClaimed,
  };
}

/**
 * Preferred game-end RPC. It owns the game reward, daily streak reward, stats,
 * and server-side progression counters in a single idempotent transaction.
 */
export async function completeGameResultRemote(args: CompleteGameResultArgs): Promise<CompleteGameResultRemote | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('complete_game_result', {
    p_game_id: args.gameId,
    p_won: args.won,
    p_secured: args.securedStates,
    p_coalitions: args.coalitionsDominated,
    p_win_streak: args.winStreak,
    p_mode: args.mode,
    p_bot_difficulty: args.botDifficulty,
    p_bot_count: args.botCount,
    p_turns: args.turns,
    p_electoral_votes: args.electoralVotes,
    p_candidate_id: args.candidateId,
    p_opponent_count: args.opponentCount,
  });
  if (error) {
    console.warn('completeGameResultRemote failed:', error.message);
    return null;
  }
  return parseCompleteGameResult(data, await fetchClaimedAchievements());
}

export interface ClaimAchievementResult {
  balance: number;
  amount: number;
  claimedAchievements: string[];
}

export async function claimAchievementRewardRemote(achievementId: string): Promise<ClaimAchievementResult | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('claim_achievement_reward', {
    p_achievement_id: achievementId,
  });
  if (error) {
    console.warn('claimAchievementRewardRemote failed:', error.message);
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  return {
    balance: jsonNumber(row, 'balance'),
    amount: jsonNumber(row, 'amount'),
    claimedAchievements: jsonStringArray(row, 'claimedAchievements'),
  };
}

function jsonStringOrNull(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  return typeof val === 'string' && val.length > 0 ? val : null;
}

function parseAdRewardStatus(data: unknown): AdRewardStatus | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const limit = jsonNumber(row, 'limit') || 5;
  const watched = Math.max(0, Math.min(limit, jsonNumber(row, 'watched')));
  const remaining = Math.max(0, Math.min(limit, jsonNumber(row, 'remaining')));
  return {
    watched,
    remaining,
    limit,
    windowHours: jsonNumber(row, 'windowHours') || 12,
    nextResetAt: jsonStringOrNull(row, 'nextResetAt'),
  };
}

export async function fetchAdRewardStatusRemote(): Promise<AdRewardStatus | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_ad_reward_status');
  if (error) {
    console.warn('fetchAdRewardStatusRemote failed:', error.message);
    return null;
  }
  return parseAdRewardStatus(data);
}

export type AdRewardClaimRemote =
  | ({ status: 'claimed'; amount: number; balance: number } & AdRewardStatus)
  | ({ status: 'limit'; amount: 0; balance: number } & AdRewardStatus);

export async function claimAdRewardRemote(args: {
  placement: string;
  provider?: string | null;
  adUnit?: string | null;
}): Promise<AdRewardClaimRemote | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('claim_ad_reward', {
    p_placement: args.placement,
    p_provider: args.provider ?? null,
    p_ad_unit: args.adUnit ?? null,
  });
  if (error) {
    console.warn('claimAdRewardRemote failed:', error.message);
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const status = row.status === 'claimed' ? 'claimed' : row.status === 'limit' ? 'limit' : null;
  const rewardStatus = parseAdRewardStatus(data);
  if (!status || !rewardStatus) return null;
  const balance = jsonNumber(row, 'balance');
  if (status === 'claimed') {
    return { ...rewardStatus, status, amount: jsonNumber(row, 'amount'), balance };
  }
  return { ...rewardStatus, status, amount: 0, balance };
}

async function fetchClaimedAchievements(): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('achievement_rewards')
    .select('achievement_id');
  if (error || !data) return [];
  return data
    .map((row) => (row as { achievement_id?: unknown }).achievement_id)
    .filter((id): id is string => typeof id === 'string');
}

/** Server-validated character unlock (server owns the price). Returns updated profile. */
export async function unlockCharacterRemote(characterId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('unlock_character', { p_character: characterId });
  if (error) {
    console.warn('unlockCharacterRemote failed:', error.message);
    return null;
  }
  return data ? rowToProfile(data as ProfileRow, await fetchClaimedAchievements()) : null;
}

/** Server-validated cosmetic unlock (server owns the price; stores a `cosmetic:<id>`
 *  token in unlocked_characters). Returns the updated profile. See supabase/cosmetics.sql. */
export async function unlockCosmeticRemote(cosmeticId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('unlock_cosmetic', { p_cosmetic: cosmeticId });
  if (error) {
    console.warn('unlockCosmeticRemote failed:', error.message);
    return null;
  }
  return data ? rowToProfile(data as ProfileRow, await fetchClaimedAchievements()) : null;
}

// ── Daily Challenge cross-device sync (see supabase/daily.sql) ─────────────────
// Maps the server jsonb { count, lastDate, lastWonDate, lastEv } onto the
// device-local DailyChallengeLocal shape. Returns null when never played ({}).
export function parseDailyStatus(data: unknown): DailyChallengeLocal | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (typeof row.lastDate !== 'string' || !row.lastDate) return null; // never played
  return {
    lastPlayedDate: row.lastDate,
    lastWonDate: typeof row.lastWonDate === 'string' && row.lastWonDate ? row.lastWonDate : null,
    streak: typeof row.count === 'number' && Number.isFinite(row.count) ? row.count : 0,
    lastEv: typeof row.lastEv === 'number' && Number.isFinite(row.lastEv) ? row.lastEv : 0,
  };
}

/** Cross-device daily-challenge status (null when not configured / signed out / never played). */
export async function getDailyStatusRemote(): Promise<DailyChallengeLocal | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_daily_status');
  if (error) {
    console.warn('getDailyStatusRemote failed:', error.message);
    return null;
  }
  return parseDailyStatus(data);
}

/** Record a finished daily attempt server-side (cross-device streak). Returns the new status. */
export async function recordDailyResultRemote(dateKey: string, won: boolean, ev: number): Promise<DailyChallengeLocal | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('record_daily_result', { p_date_key: dateKey, p_won: won, p_ev: ev });
  if (error) {
    console.warn('recordDailyResultRemote failed:', error.message);
    return null;
  }
  return parseDailyStatus(data);
}

/**
 * Permanently delete the signed-in user's account and all associated data
 * (Apple Guideline 5.1.1(v) / Google Play data-deletion). Removing the auth
 * user cascades to the profiles row server-side. Returns true on success.
 * See supabase/profiles.sql delete_account().
 */
export async function deleteAccountRemote(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { error } = await supabase.rpc('delete_account');
  if (error) {
    console.warn('deleteAccountRemote failed:', error.message);
    return false;
  }
  return true;
}
