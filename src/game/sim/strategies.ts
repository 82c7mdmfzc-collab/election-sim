/**
 * Strategy archetypes for the balance simulation.
 *
 * Two kinds:
 *  - botStrategy(difficulty): the real production AI (planBotTurn) as a proxy for
 *    "skilled play". Already emits legal/affordable moves.
 *  - scripted archetypes: deliberately one-dimensional playstyles used to test
 *    "is approach X stronger than approach Y". Each is just a *priority order* over
 *    states fed through greedyBuy(), which guarantees only legal+affordable intents
 *    (so buildPendingSubmission never drops the turn).
 *
 * Scripted archetypes invest only in states (no national ladders) to keep them
 * pure; the bot baseline exercises the full action space.
 */

import {
  bestAffinityForState,
  calcStateCost,
  computeWalletSplit,
  maxBuyableThisTurn,
} from '../engine';
import { planBotTurn } from '../bot';
import { ALL_STATES } from '../statesData';
import { STATE_GROUPS, STATE_GROUP_MAP, MEGASTATE_IDS } from '../config';
import type { BotDifficulty, LobbyGameState, PlayerState, PurchaseIntent } from '../types';
import type { Strategy } from './runGame';

const STATE_BY_ID = Object.fromEntries(ALL_STATES.map((s) => [s.id, s]));

/** EV per $1k of (already-discounted) base cost — the raw value metric. */
function evEfficiency(stateId: string): number {
  const s = STATE_BY_ID[stateId];
  return s ? s.electoralVotes / s.baseCampaignCost : 0;
}

function byEfficiencyDesc(ids: string[]): string[] {
  return [...ids].sort((a, b) => evEfficiency(b) - evEfficiency(a));
}

/**
 * Greedily buy 1 rung at a time down a priority list, re-passing until nothing
 * more fits the budget. Mirrors the engine's validation exactly (entry cap, max
 * rungs, secured, wallet split) so every returned intent is guaranteed legal.
 */
function greedyBuy(
  view: LobbyGameState,
  playerId: string,
  priority: string[],
): PurchaseIntent[] {
  const player = view.players.find((p) => p.id === playerId);
  if (!player) return [];
  // Working clone — wallets mutate as we commit, just like buildPendingSubmission.
  const working: PlayerState = { ...player, groupWallets: { ...player.groupWallets } };
  const bought: Record<string, number> = {};

  const tryBuyOne = (stateId: string): boolean => {
    const us = STATE_BY_ID[stateId];
    if (!us || view.securedBy[stateId]) return false;
    const startRung = view.rungs[stateId]?.[playerId] ?? 0;
    const pending = bought[stateId] ?? 0;
    const cap = maxBuyableThisTurn(startRung, us.maxRungs);
    const room = Math.min(cap - pending, us.maxRungs - startRung - pending);
    if (room <= 0) return false;
    const discount = bestAffinityForState(working, stateId);
    const cost = calcStateCost(stateId, us.baseCampaignCost, startRung + pending, 1, discount);
    const split = computeWalletSplit(working, stateId, cost);
    if (!split) return false;
    for (const d of split.walletDraw) {
      if (d.wallet === 'NATIONAL') working.nationalCash -= d.amount;
      else working.groupWallets[d.wallet] = (working.groupWallets[d.wallet] ?? 0) - d.amount;
    }
    bought[stateId] = pending + 1;
    return true;
  };

  // Bounded passes: stop when a full sweep buys nothing.
  for (let pass = 0; pass < 24; pass++) {
    let progressed = false;
    for (const sid of priority) if (tryBuyOne(sid)) progressed = true;
    if (!progressed) break;
  }

  return Object.entries(bought)
    .filter(([, r]) => r > 0)
    .map(([targetId, rungs]) => ({ kind: 'state' as const, targetId, rungs }));
}

// ── Priority orderings (computed once; data is static) ──────────────────────────

const BIG4 = ['CA', 'TX', 'FL', 'NY'];
const NON_MEGA = ALL_STATES.map((s) => s.id).filter((id) => !MEGASTATE_IDS.has(id));

/** Megastate-first: grab the Big 4, then most-efficient fillers toward 270. */
const ORDER_BIG4_RUSH = [...BIG4, ...byEfficiencyDesc(NON_MEGA)];

/** Never touch megastates; chase the best EV-per-dollar small/mid states. */
const ORDER_VALUE_SMALL = byEfficiencyDesc(NON_MEGA);

/** Complete the highest-payout coalitions first (cheap members first). */
const ORDER_COALITION_FARMER = (() => {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const g of [...STATE_GROUPS].sort((a, b) => b.bonusPayout - a.bonusPayout)) {
    for (const sid of byEfficiencyDesc([...g.members])) {
      if (!seen.has(sid)) { seen.add(sid); order.push(sid); }
    }
  }
  return order;
})();

/** Swing-States coalition first, then efficient fillers. */
const ORDER_SWING_FOCUS = (() => {
  const swing = STATE_GROUP_MAP['Swing States']?.members ?? [];
  const swingOrder = byEfficiencyDesc([...swing]);
  const rest = byEfficiencyDesc(ALL_STATES.map((s) => s.id).filter((id) => !swing.includes(id)));
  return [...swingOrder, ...rest];
})();

// ── Public strategies ───────────────────────────────────────────────────────────

export function botStrategy(difficulty: BotDifficulty): Strategy {
  return (view, playerId, rng) =>
    planBotTurn(view, playerId, difficulty, rng).map(({ kind, targetId, rungs }) => ({
      kind,
      targetId,
      rungs,
    }));
}

export const big4Rush: Strategy = (view, playerId) => greedyBuy(view, playerId, ORDER_BIG4_RUSH);
export const valueSmall: Strategy = (view, playerId) => greedyBuy(view, playerId, ORDER_VALUE_SMALL);
export const coalitionFarmer: Strategy = (view, playerId) =>
  greedyBuy(view, playerId, ORDER_COALITION_FARMER);
export const swingFocus: Strategy = (view, playerId) => greedyBuy(view, playerId, ORDER_SWING_FOCUS);

/** Registry used by the experiment runner. */
export const SCRIPTED: Record<string, Strategy> = {
  big4Rush,
  valueSmall,
  coalitionFarmer,
  swingFocus,
};
