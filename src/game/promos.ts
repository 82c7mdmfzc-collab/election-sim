/**
 * promos.ts — time-limited Shop promotions (pure, injectable date).
 *
 * Currently: George Washington is FREE TO CLAIM during July (otherwise 4,500
 * Campaign Funds). The actual grant is server-validated (the claim_free_character
 * RPC in supabase/profiles.sql owns the month rule so a client can't spoof it);
 * this helper only drives the Store UI's "Claim Free" vs "Buy" state. Keeping the
 * rule here keeps date logic out of the UI components.
 */

/** The candidate with a time-limited (July) free-claim window. */
export const JULY_FREE_CLAIM_ID = 'washington';

/**
 * Whether `candidateId` can be claimed for free right now — true only for George
 * Washington during July. `now` is injectable so tests can assert both windows
 * without touching the system clock. Uses the UTC month to match both the server
 * (Supabase runs UTC) and the daily-challenge date convention.
 */
export function isCandidateFreeClaimAvailable(candidateId: string, now: Date = new Date()): boolean {
  return candidateId === JULY_FREE_CLAIM_ID && now.getUTCMonth() === 6; // 6 = July
}
