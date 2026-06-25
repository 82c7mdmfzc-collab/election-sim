/**
 * rewards.ts — pure Campaign Funds award math (no IO, no store, no React).
 *
 * Mirrors the engine.ts testing pattern so the economy is verifiable in
 * isolation. This computes the optimistic award shown instantly in the victory
 * reveal; the AUTHORITATIVE amount is computed server-side and deduped per game
 * via the claim_game_reward RPC (see supabase/rewards.sql), which is the value
 * the balance reconciles to. The formula here is kept in sync with that SQL.
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

/** Matches the per-game cap enforced server-side in claim_game_reward(). */
export const REWARD_CAP = 60;

const BASE_FINISH = 5;         // just for completing a game
const WIN_BONUS = 20;          // winning the presidency
const PER_SECURED_STATE = 1;   // each state locked by the owner
const PER_COALITION = 3;       // each coalition dominated at the end
const PER_STREAK = 5;          // per consecutive win, capped
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
  const total = Math.floor(Math.min(raw, REWARD_CAP));
  return { base, winBonus, securedBonus, dominanceBonus, streakBonus, total };
}
