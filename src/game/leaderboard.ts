/**
 * leaderboard.ts — read-only global rankings.
 *
 * Thin client over the get_leaderboard SECURITY DEFINER RPC (supabase/leaderboard.sql),
 * which is the only path that can read other players' display names + ranked stat.
 * Parsing is defensive (mirrors the helpers in game/profile.ts) so a schema drift or
 * a not-yet-migrated deployment degrades to "no data" rather than throwing.
 */

import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';

export type LeaderboardBoard = 'wins_all' | 'wins_month' | 'wins_week' | 'streak';

export interface LeaderboardRow {
  rank: number;
  name: string;
  value: number;
  /** Equipped profile-banner cosmetic id ('' = none). See components/ProfileBanner. */
  banner: string;
  /** Chosen avatar preset id ('' = initials). See game/avatars.ts. */
  avatar: string;
  /** True for the signed-in caller's own row (highlighted in the list). */
  isMe: boolean;
}

export interface LeaderboardResult {
  rows: LeaderboardRow[];
  /** The caller's standing, even when outside the visible top. Null when unranked. */
  me: { rank: number; value: number } | null;
}

export const BOARD_META: Record<LeaderboardBoard, { label: string; sub: string; unit: string }> = {
  wins_all:   { label: 'All-Time', sub: 'Lifetime wins',  unit: 'W' },
  wins_month: { label: 'Month',    sub: 'Last 30 days',   unit: 'W' },
  wins_week:  { label: 'Week',     sub: 'Last 7 days',    unit: 'W' },
  streak:     { label: 'Streak',   sub: 'Best win streak', unit: '🔥' },
};

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseRow(v: unknown): LeaderboardRow | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name : null;
  if (!name) return null;
  return {
    rank: num(r.rank),
    name,
    value: num(r.value),
    banner: typeof r.banner === 'string' ? r.banner : '',
    avatar: typeof r.avatar === 'string' ? r.avatar : '',
    isMe: r.isMe === true,
  };
}

function parseResult(data: unknown): LeaderboardResult {
  if (!data || typeof data !== 'object') return { rows: [], me: null };
  const obj = data as Record<string, unknown>;
  const rows = Array.isArray(obj.top)
    ? obj.top.map(parseRow).filter((r): r is LeaderboardRow => r !== null)
    : [];
  let me: LeaderboardResult['me'] = null;
  if (obj.me && typeof obj.me === 'object') {
    const m = obj.me as Record<string, unknown>;
    me = { rank: num(m.rank), value: num(m.value) };
  }
  return { rows, me };
}

/** Fetch one leaderboard board. Returns null when Supabase is unconfigured or the
 *  RPC errors (e.g. migration not yet applied) — callers render an error state. */
export async function fetchLeaderboardRemote(
  board: LeaderboardBoard,
  limit = 100,
): Promise<LeaderboardResult | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_leaderboard', { p_board: board, p_limit: limit });
  if (error) {
    console.warn('fetchLeaderboardRemote failed:', error.message);
    return null;
  }
  return parseResult(data);
}
