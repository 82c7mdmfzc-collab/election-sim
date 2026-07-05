/**
 * affordability — the single source of truth for "can the active player fund one
 * more campaign level here?". Pure and dependency-light (engine/config/statesData
 * only) so it is testable without React or the store, and so the buy-button
 * disabled state can NEVER disagree with what allocate() will actually accept.
 *
 * The funds check uses the same ground truth allocate() relies on:
 *   • states  → computeWalletSplit() (group wallets drained alphabetically, then
 *               national cash) returns null iff the cost cannot be covered.
 *   • national → national cash only (national groups never draw group wallets).
 *
 * All cash values are in $1k units (e.g. 150 = $150k).
 */

import {
  bestAffinityForState,
  calcStateCost,
  calcNationalCost,
  computeWalletSplit,
  maxBuyableThisTurn,
} from './engine';
import { ALL_STATES } from './statesData';
import { STATE_GROUPS_BY_STATE, NATIONAL_GROUP_MAP } from './config';
import type { PlayerState, GameModifiers } from './types';

/** Working-cash snapshot applied during allocation (already nets out pending spend). */
export interface WorkingCash {
  nationalCash: number;
  groupWallets: Record<string, number>;
}

export interface Affordability {
  /** Cost of the next single campaign level (in $1k units). */
  nextCost: number;
  /** Spendable funds toward this target (state-group wallets + national, or national only). */
  available: number;
  /** True iff the next level can be funded and isn't blocked by cap/max/secured. */
  affordable: boolean;
  /** Already at the maximum campaign level for this target. */
  atMax: boolean;
  /** Hit the per-turn entry cap for this target. */
  capReached: boolean;
  /** Target is locked (secured by someone). */
  secured: boolean;
  /** Player-facing reason the action is unavailable, or null when affordable. */
  reason: string | null;
}

export const AFFORDABILITY_UNAVAILABLE: Affordability = {
  nextCost: 0, available: 0, affordable: false,
  atMax: false, capReached: false, secured: false, reason: null,
};

/**
 * Pure affordability computation — mirrors allocate()'s validation exactly.
 * `workingCash` must be the post-pending snapshot (what allocate operates on).
 */
export function computeAffordability(args: {
  kind: 'state' | 'national';
  targetId: string;
  player: PlayerState;
  workingCash: WorkingCash;
  startRung: number;     // settled levels at start of turn
  pendingRungs: number;  // levels already queued for this target this turn
  secured: boolean;
  modifiers?: GameModifiers;
}): Affordability {
  const { kind, targetId, player, workingCash, startRung, pendingRungs, secured, modifiers } = args;
  const proxy: PlayerState = {
    ...player,
    nationalCash: workingCash.nationalCash,
    groupWallets: workingCash.groupWallets,
  };
  const climbed = startRung + pendingRungs;

  if (kind === 'state') {
    const usState = ALL_STATES.find((s) => s.id === targetId);
    if (!usState) return AFFORDABILITY_UNAVAILABLE;
    const maxRungs = usState.maxRungs;
    const discount = bestAffinityForState(proxy, targetId);
    const nextCost = calcStateCost(targetId, usState.baseCampaignCost, climbed, 1, discount, modifiers);
    const usable = (STATE_GROUPS_BY_STATE[targetId] ?? []).reduce(
      (a, g) => a + (workingCash.groupWallets[g] ?? 0), 0,
    );
    const available = usable + workingCash.nationalCash;
    const atMax = climbed >= maxRungs;
    const capReached = !atMax && pendingRungs >= maxBuyableThisTurn(startRung, maxRungs, modifiers);
    const canPay = computeWalletSplit(proxy, targetId, nextCost) !== null;
    return {
      nextCost, available, atMax, capReached, secured,
      affordable: !secured && !atMax && !capReached && canPay,
      reason: reasonFor({ secured, atMax, capReached, canPay, nextCost }),
    };
  }

  const g = NATIONAL_GROUP_MAP[targetId];
  if (!g) return AFFORDABILITY_UNAVAILABLE;
  const maxRungs = g.maxRungs;
  const nextCost = calcNationalCost(targetId, climbed, 1, proxy);
  const available = workingCash.nationalCash;
  const atMax = climbed >= maxRungs;
  const capReached = !atMax && pendingRungs >= maxBuyableThisTurn(startRung, maxRungs, modifiers);
  const canPay = nextCost <= workingCash.nationalCash;
  return {
    nextCost, available, atMax, capReached, secured,
    affordable: !secured && !atMax && !capReached && canPay,
    reason: reasonFor({ secured, atMax, capReached, canPay, nextCost }),
  };
}

function reasonFor(s: {
  secured: boolean; atMax: boolean; capReached: boolean; canPay: boolean; nextCost: number;
}): string | null {
  if (s.secured) return 'Secured';
  if (s.atMax) return 'Max Campaign Influence';
  if (s.capReached) return 'Capped this turn';
  if (!s.canPay) return `Need $${s.nextCost}k`;
  return null;
}
