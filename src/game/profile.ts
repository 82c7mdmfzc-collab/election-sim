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
import { CANDIDATES } from './candidates';
import {
  type CandidateMastery,
  normalizeCandidateMastery,
  type CandidateMasteryAward,
} from './candidateMastery';
import {
  parseDailyLeaderboardResult,
  type DailyLeaderboardResult,
} from './dailyRankings';
import type { BotDifficulty } from './types';
import { parseSeasonStatus, type SeasonStatus } from './season';

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
  /** Equipped profile-banner cosmetic id ('' = none). Server-owned (others see it). */
  equippedBanner: string;
  stats: ProfileStats;
  achievementCounters: AchievementCounters;
  claimedAchievements: string[];
  dailyStreak: DailyStreakState;
  candidateMastery: CandidateMastery;
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
  equippedBanner: '',
  stats: { ...DEFAULT_STATS },
  achievementCounters: normalizeAchievementCounters(null),
  claimedAchievements: [],
  dailyStreak: { ...DEFAULT_DAILY_STREAK },
  candidateMastery: normalizeCandidateMastery(null, CANDIDATES),
};

// ── Remote (Supabase) ─────────────────────────────────────────────────────────

interface ProfileRow {
  campaign_funds: number;
  unlocked_characters: string[];
  stats: Partial<ProfileStats> | null;
  achievement_counters?: Partial<AchievementCounters> | null;
  daily_streak?: Partial<DailyStreakState> | null;
  candidate_mastery?: unknown;
  display_name?: string | null;
  equipped_banner?: string | null;
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
    equippedBanner: row.equipped_banner ?? '',
    stats: { ...DEFAULT_STATS, ...(row.stats ?? {}) },
    achievementCounters: counters,
    claimedAchievements,
    dailyStreak: normalizeDailyStreak(row.daily_streak),
    candidateMastery: normalizeCandidateMastery(row.candidate_mastery, CANDIDATES),
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
    .select('campaign_funds, unlocked_characters, stats, achievement_counters, daily_streak, candidate_mastery, display_name, equipped_banner')
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

export type GameCompletionMode = 'single' | 'bot' | 'daily' | 'online';

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
  candidateMastery: CandidateMastery;
  masteryAward: CandidateMasteryAward;
  /** Season XP granted by this game (0 if no active season / replayed). */
  seasonXp: number;
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
    candidateMastery: normalizeCandidateMastery(row.candidateMastery, CANDIDATES),
    masteryAward: parseMasteryAward(row.masteryAward),
    seasonXp: (() => {
      const s = row.season;
      return s && typeof s === 'object' ? jsonNumber(s as Record<string, unknown>, 'gained') : 0;
    })(),
  };
}

function parseMasteryAward(data: unknown): CandidateMasteryAward {
  if (!data || typeof data !== 'object') {
    return { candidateId: null, xpGained: 0, previousLevel: 1, newLevel: 1, leveledUp: false };
  }
  const row = data as Record<string, unknown>;
  const candidateId = typeof row.candidateId === 'string' && row.candidateId ? row.candidateId : null;
  const previousLevel = Math.max(1, Math.min(5, jsonNumber(row, 'previousLevel'))) as CandidateMasteryAward['previousLevel'];
  const newLevel = Math.max(1, Math.min(5, jsonNumber(row, 'newLevel'))) as CandidateMasteryAward['newLevel'];
  return {
    candidateId,
    xpGained: jsonNumber(row, 'xpGained'),
    previousLevel,
    newLevel,
    leveledUp: row.leveledUp === true,
  };
}

/**
 * Preferred game-end RPC. It owns the game reward, daily streak reward, stats,
 * and server-side progression counters in a single idempotent transaction.
 */
export async function completeGameResultRemote(args: CompleteGameResultArgs): Promise<CompleteGameResultRemote | null> {
  if (!isSupabaseConfigured) return null;
  const params = {
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
  };
  // Retry with backoff: the RPC is idempotent on (user, game_id), so a replayed
  // call is safe — it returns the current balance with gameReward 0 rather than
  // double-crediting. This rescues a finish over a flaky connection at game end.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.rpc('complete_game_result', params);
    if (!error) return parseCompleteGameResult(data, await fetchClaimedAchievements());
    console.warn(`completeGameResultRemote failed (attempt ${attempt + 1}/3):`, error.message);
    if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return null;
}

export interface LoginBonusResult {
  /** Funds granted now (0 if already claimed today). */
  amount: number;
  /** New campaign-funds balance. */
  balance: number;
}

/**
 * Claim the once-per-UTC-day login bonus. Safe to call on every launch — the
 * server gates on the stored date and returns amount 0 when already claimed.
 * See claim_login_bonus in supabase/daily.sql. Null when unconfigured / errored.
 */
export async function claimLoginBonusRemote(): Promise<LoginBonusResult | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('claim_login_bonus');
  if (error) {
    console.warn('claimLoginBonusRemote failed:', error.message);
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  return { amount: jsonNumber(row, 'amount'), balance: jsonNumber(row, 'balance') };
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

export interface TrainCandidateMasteryResult {
  balance: number;
  candidateMastery: CandidateMastery;
  trainingAward: {
    candidateId: string | null;
    cost: number;
    previousLevel: CandidateMasteryAward['previousLevel'];
    newLevel: CandidateMasteryAward['newLevel'];
    xp: number;
  };
}

function parseTrainCandidateMasteryResult(data: unknown): TrainCandidateMasteryResult | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const awardRaw = row.trainingAward;
  const award = awardRaw && typeof awardRaw === 'object' ? awardRaw as Record<string, unknown> : {};
  const candidateId = typeof award.candidateId === 'string' && award.candidateId ? award.candidateId : null;
  const previousLevel = Math.max(1, Math.min(5, jsonNumber(award, 'previousLevel'))) as CandidateMasteryAward['previousLevel'];
  const newLevel = Math.max(1, Math.min(5, jsonNumber(award, 'newLevel'))) as CandidateMasteryAward['newLevel'];
  return {
    balance: jsonNumber(row, 'balance'),
    candidateMastery: normalizeCandidateMastery(row.candidateMastery, CANDIDATES),
    trainingAward: {
      candidateId,
      cost: jsonNumber(award, 'cost'),
      previousLevel,
      newLevel,
      xp: jsonNumber(award, 'xp'),
    },
  };
}

export async function trainCandidateMasteryRemote(characterId: string): Promise<TrainCandidateMasteryResult | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('train_candidate_mastery', {
    p_character: characterId,
  });
  if (error) {
    console.warn('trainCandidateMasteryRemote failed:', error.message);
    return null;
  }
  return parseTrainCandidateMasteryResult(data);
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

export type UnlockRemoteErrorReason =
  | 'not_configured'
  | 'missing_function'
  | 'auth'
  | 'insufficient_funds'
  | 'unknown_item'
  | 'unknown';

export type UnlockCosmeticRemoteResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: UnlockRemoteErrorReason; message: string };

function classifyUnlockRpcError(error: unknown, fallback = 'Could not unlock cosmetic.'): { reason: UnlockRemoteErrorReason; message: string } {
  const rawMessage = (error as { message?: string })?.message ?? fallback;
  const code = String((error as { code?: string })?.code ?? '');
  const message = rawMessage.toLowerCase();

  if (code === 'PGRST202' || code === '42883' || message.includes('could not find the function') || message.includes('does not exist')) {
    return {
      reason: 'missing_function',
      message: 'Cosmetic purchases need the latest database update. Apply supabase/cosmetics.sql, then try again.',
    };
  }
  if (message.includes('insufficient funds')) {
    return { reason: 'insufficient_funds', message: 'Not enough Campaign Funds for this cosmetic.' };
  }
  if (message.includes('no profile') || message.includes('permission denied') || message.includes('jwt') || message.includes('auth')) {
    return { reason: 'auth', message: 'Sign in again, then try unlocking this cosmetic.' };
  }
  if (message.includes('unknown cosmetic')) {
    return { reason: 'unknown_item', message: 'This cosmetic is not available to purchase yet.' };
  }
  return { reason: 'unknown', message: rawMessage || fallback };
}

/** Server-validated FREE claim (server owns the "free right now" rule — e.g. George
 *  Washington in July). Grants the character for 0 funds. Returns updated profile.
 *  See claim_free_character in supabase/profiles.sql + isCandidateFreeClaimAvailable. */
export async function claimFreeCharacterRemote(characterId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('claim_free_character', { p_character: characterId });
  if (error) {
    console.warn('claimFreeCharacterRemote failed:', error.message);
    return null;
  }
  return data ? rowToProfile(data as ProfileRow, await fetchClaimedAchievements()) : null;
}

/** Server-validated cosmetic unlock (server owns the price; stores a `cosmetic:<id>`
 *  token in unlocked_characters). Returns the updated profile. See supabase/cosmetics.sql. */
export async function unlockCosmeticRemote(cosmeticId: string): Promise<UnlockCosmeticRemoteResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, reason: 'not_configured', message: 'Cosmetic purchases are not configured in this build.' };
  }
  const { data, error } = await supabase.rpc('unlock_cosmetic', { p_cosmetic: cosmeticId });
  if (error) {
    console.warn('unlockCosmeticRemote failed:', error.message);
    return { ok: false, ...classifyUnlockRpcError(error) };
  }
  if (!data) {
    return { ok: false, reason: 'unknown', message: 'Could not unlock cosmetic. Please try again.' };
  }
  return { ok: true, profile: rowToProfile(data as ProfileRow, await fetchClaimedAchievements()) };
}

// ── Season pass (see supabase/season.sql) ─────────────────────────────────────
// All four RPCs return the get_season_status jsonb; parseSeasonStatus normalizes it.

export async function getSeasonStatusRemote(): Promise<SeasonStatus | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_season_status');
  if (error) { console.warn('getSeasonStatusRemote failed:', error.message); return null; }
  return parseSeasonStatus(data);
}

export interface SeasonActionResult {
  ok: boolean;
  status?: SeasonStatus;
  message?: string;
}

function classifySeasonError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('insufficient funds')) return 'Not enough Campaign Funds.';
  if (m.includes('already claimed')) return 'Already claimed.';
  if (m.includes('premium track locked')) return 'Unlock the premium track first.';
  if (m.includes('not reached') || m.includes('not met')) return 'Not unlocked yet.';
  if (m.includes('not owned')) return 'You don’t own that candidate.';
  if (m.includes('needs a candidate')) return 'Pick a candidate for this tome.';
  if (m.includes('season ended')) return 'The season has ended.';
  return 'Something went wrong. Try again.';
}

export async function unlockSeasonPassRemote(): Promise<SeasonActionResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Not available in this build.' };
  const { data, error } = await supabase.rpc('unlock_season_pass');
  if (error) return { ok: false, message: classifySeasonError(error.message) };
  return { ok: true, status: parseSeasonStatus(data) };
}

export async function claimSeasonTierRemote(
  tier: number,
  track: 'free' | 'premium',
  candidate?: string | null,
): Promise<SeasonActionResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Not available in this build.' };
  const { data, error } = await supabase.rpc('claim_season_tier', {
    p_tier: tier, p_track: track, p_candidate: candidate ?? null,
  });
  if (error) return { ok: false, message: classifySeasonError(error.message) };
  return { ok: true, status: parseSeasonStatus(data) };
}

export async function claimSeasonObjectiveRemote(objectiveId: string): Promise<SeasonActionResult> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Not available in this build.' };
  const { data, error } = await supabase.rpc('claim_season_objective', { p_objective: objectiveId });
  if (error) return { ok: false, message: classifySeasonError(error.message) };
  return { ok: true, status: parseSeasonStatus(data) };
}

/** Equip (or clear, with '') an owned profile banner. Server validates ownership.
 *  Returns the updated profile, or null on failure. See supabase/cosmetics.sql. */
export async function setEquippedBannerRemote(bannerId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('set_equipped_banner', { p_banner: bannerId });
  if (error) {
    console.warn('setEquippedBannerRemote failed:', error.message);
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

export async function recordDailyScoreRemote(args: {
  dateKey: string;
  won: boolean;
  ev: number;
  turns: number;
  securedStates: number;
  coalitions: number;
}): Promise<DailyLeaderboardResult | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('record_daily_score', {
    p_date_key: args.dateKey,
    p_won: args.won,
    p_ev: args.ev,
    p_turns: args.turns,
    p_secured_states: args.securedStates,
    p_coalitions: args.coalitions,
  });
  if (error) {
    console.warn('recordDailyScoreRemote failed:', error.message);
    return null;
  }
  return parseDailyLeaderboardResult(data);
}

export async function getDailyLeaderboardRemote(dateKey: string, limit = 50): Promise<DailyLeaderboardResult | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_daily_leaderboard', {
    p_date_key: dateKey,
    p_limit: limit,
  });
  if (error) {
    console.warn('getDailyLeaderboardRemote failed:', error.message);
    return null;
  }
  return parseDailyLeaderboardResult(data);
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
