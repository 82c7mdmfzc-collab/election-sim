/**
 * rewards.ts — pure Campaign Funds award math (no IO, no store, no React).
 *
 * Mirrors the engine.ts testing pattern so the economy is verifiable in
 * isolation. The client computes the *suggested* award from a finished game and
 * the server caps/records it via the award_funds RPC (see supabase/profiles.sql).
 *
 * Reward perspective: a single device has one progression account, so every
 * award is computed for ONE "owner" seat (online: the local player; otherwise
 * the human in seat 0). `won` etc. are all relative to that seat.
 */

export interface RewardInput {
  /** Did the owner seat win the presidency? */
  won: boolean;
  /** States the owner secured (locked) by game end. */
  securedStates: number;
  /** Coalitions the owner dominated at game end. */
  coalitionsDominated: number;
  /** Owner's win streak AFTER this game (0 if they lost, 1 = first of a streak). */
  winStreak: number;
}

export interface RewardBreakdown {
  base: number;
  winBonus: number;
  securedBonus: number;
  dominanceBonus: number;
  streakBonus: number;
  total: number;
}

/** Matches the per-call cap enforced server-side in award_funds(). */
export const REWARD_CAP = 5000;

const BASE_FINISH = 100;       // just for completing a game
const WIN_BONUS = 400;         // winning the presidency
const PER_SECURED_STATE = 10;  // each state locked by the owner
const PER_COALITION = 50;      // each coalition dominated at the end
const PER_STREAK = 50;         // per consecutive win, capped
const MAX_STREAK_STEPS = 5;    // streak bonus stops compounding past 5

/**
 * Compute the Campaign Funds award for a finished game. Always returns a
 * non-negative total clamped to REWARD_CAP so it can be passed straight to the
 * server RPC.
 */
export function computeReward(input: RewardInput): RewardBreakdown {
  const base = BASE_FINISH;
  const winBonus = input.won ? WIN_BONUS : 0;
  const securedBonus = Math.max(0, input.securedStates) * PER_SECURED_STATE;
  const dominanceBonus = Math.max(0, input.coalitionsDominated) * PER_COALITION;
  const streakBonus = input.won
    ? Math.min(input.winStreak, MAX_STREAK_STEPS) * PER_STREAK
    : 0;

  const raw = base + winBonus + securedBonus + dominanceBonus + streakBonus;
  const total = Math.min(raw, REWARD_CAP);
  return { base, winBonus, securedBonus, dominanceBonus, streakBonus, total };
}
