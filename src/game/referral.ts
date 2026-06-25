/**
 * referral.ts — client wrappers for the referral RPCs (see supabase/referrals.sql).
 *
 * Flow:
 *   • An invite link carries ?ref=CODE. We stash it (localPrefs) and, once the
 *     invitee signs in, call setReferrer() to record the attribution.
 *   • The payout happens SERVER-SIDE when the invitee finishes their first game
 *     (trigger on game_rewards) — both parties get a weighted-random reward
 *     (250/500/750 Funds). There is no client call to grant funds; the client
 *     only records the referrer.
 */

import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';

/** Display range shown to players (actual amount is a server-side weighted roll). */
export const REFERRAL_RANGE = '250–750';

export type SetReferrerResult = 'ok' | 'already_set' | 'not_eligible' | 'invalid_code' | 'self' | 'error';

/** Fetch (allocating on first call) the signed-in user's referral code. */
export async function getMyReferralCode(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_my_referral_code');
  if (error) {
    console.warn('getMyReferralCode failed:', error.message);
    return null;
  }
  return (data as string) ?? null;
}

/** Record who referred the signed-in user. Safe to call for returning users (the
 *  server rejects with 'already_set' / 'not_eligible'). */
export async function setReferrer(code: string): Promise<SetReferrerResult> {
  if (!isSupabaseConfigured) return 'error';
  const { data, error } = await supabase.rpc('set_referrer', { p_code: code });
  if (error) {
    console.warn('setReferrer failed:', error.message);
    return 'error';
  }
  return (data as SetReferrerResult) ?? 'error';
}

/** The shareable invite URL for a referral code. */
export function referralLink(code: string): string {
  return `https://playelector.com/?ref=${encodeURIComponent(code)}`;
}
