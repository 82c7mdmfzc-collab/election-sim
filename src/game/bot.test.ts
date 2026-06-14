import { describe, it, expect } from 'vitest';
import { planBotTurn, type BotMove } from './bot';
import {
  bestAffinityForState,
  calcStateCost,
  calcNationalCost,
  computeWalletSplit,
  maxBuyableThisTurn,
} from './engine';
import { createInitialGameState, ALL_STATES } from './statesData';
import { NATIONAL_GROUPS } from './config';
import { CANDIDATES } from './candidates';
import type { BotDifficulty, GameState, PlayerState } from './types';

const STATE_BY_ID = Object.fromEntries(ALL_STATES.map((s) => [s.id, s]));
const NAT_BY_ID = Object.fromEntries(NATIONAL_GROUPS.map((g) => [g.id, g]));

/** Deterministic PRNG so tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function freshGame(): GameState {
  // Two players: a human (seat 0) and a bot (seat 1).
  return createInitialGameState(CANDIDATES.slice(0, 2));
}

/**
 * Replays the bot's moves through the SAME checks the store's allocate uses
 * (entry cap, max rungs, earmarked wallet split / national cash) and asserts
 * every move would be accepted. This is the ground-truth legality check.
 */
function assertLegal(state: GameState, playerId: string, moves: BotMove[]): void {
  const p = state.players.find((x) => x.id === playerId)!;
  const tracker: PlayerState = { ...p, groupWallets: { ...p.groupWallets } };
  const pending: Record<string, number> = {};

  for (const m of moves) {
    expect(m.rungs).toBeGreaterThan(0);
    if (m.kind === 'state') {
      const us = STATE_BY_ID[m.targetId];
      expect(us).toBeTruthy();
      const startRung = state.rungs[m.targetId]?.[playerId] ?? 0;
      const pend = pending[m.targetId] ?? 0;
      const cap = maxBuyableThisTurn(startRung, us.maxRungs);
      expect(pend + m.rungs).toBeLessThanOrEqual(cap);
      expect(startRung + pend + m.rungs).toBeLessThanOrEqual(us.maxRungs);
      expect(state.securedBy[m.targetId]).toBeFalsy();

      const discount = bestAffinityForState(tracker, m.targetId);
      const cost = calcStateCost(m.targetId, us.baseCampaignCost, startRung + pend, m.rungs, discount);
      const split = computeWalletSplit(tracker, m.targetId, cost);
      expect(split, `affordable: ${m.targetId}`).not.toBeNull();
      for (const d of split!.walletDraw) {
        if (d.wallet === 'NATIONAL') tracker.nationalCash -= d.amount;
        else tracker.groupWallets[d.wallet] -= d.amount;
      }
      pending[m.targetId] = pend + m.rungs;
    } else {
      const g = NAT_BY_ID[m.targetId];
      expect(g).toBeTruthy();
      const startRung = state.natRungs[m.targetId]?.[playerId] ?? 0;
      const pend = pending[m.targetId] ?? 0;
      const cap = maxBuyableThisTurn(startRung, g.maxRungs);
      expect(pend + m.rungs).toBeLessThanOrEqual(cap);
      const cost = calcNationalCost(m.targetId, startRung + pend, m.rungs, tracker);
      expect(cost).toBeLessThanOrEqual(tracker.nationalCash + 1e-6);
      tracker.nationalCash -= cost;
      pending[m.targetId] = pend + m.rungs;
    }
  }
}

const DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];

describe('planBotTurn — legality', () => {
  for (const diff of DIFFICULTIES) {
    it(`${diff}: every move is legal & affordable`, () => {
      const state = freshGame();
      const botId = state.players[1].id;
      const moves = planBotTurn(state, botId, diff, mulberry32(42));
      assertLegal(state, botId, moves);
    });

    it(`${diff}: no move exceeds the entry gatekeeper on a fresh board`, () => {
      const state = freshGame();
      const botId = state.players[1].id;
      const moves = planBotTurn(state, botId, diff, mulberry32(7));
      for (const m of moves.filter((x) => x.kind === 'state')) {
        const us = STATE_BY_ID[m.targetId];
        expect(m.rungs).toBeLessThanOrEqual(us.maxRungs === 16 ? 3 : 2);
      }
    });
  }
});

describe('planBotTurn — behavior', () => {
  it('spends when it has funds (medium & hard make purchases)', () => {
    const state = freshGame();
    const botId = state.players[1].id;
    expect(planBotTurn(state, botId, 'medium', mulberry32(1)).length).toBeGreaterThan(0);
    expect(planBotTurn(state, botId, 'hard', mulberry32(1)).length).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed rng seed', () => {
    const state = freshGame();
    const botId = state.players[1].id;
    const a = planBotTurn(state, botId, 'hard', mulberry32(99));
    const b = planBotTurn(state, botId, 'hard', mulberry32(99));
    expect(a).toEqual(b);
  });

  it('returns nothing for an eliminated bot', () => {
    const state = freshGame();
    const botId = state.players[1].id;
    state.players[1] = { ...state.players[1], eliminated: true };
    expect(planBotTurn(state, botId, 'hard', mulberry32(1))).toEqual([]);
  });

  it('returns nothing when broke', () => {
    const state = freshGame();
    const botId = state.players[1].id;
    state.players[1] = { ...state.players[1], nationalCash: 0 };
    // group wallets are already zero on a fresh game
    expect(planBotTurn(state, botId, 'medium', mulberry32(1))).toEqual([]);
  });

  it('hard keeps a larger cash reserve than easy (easy spends harder)', () => {
    const state = freshGame();
    const botId = state.players[1].id;
    const start = state.players[1].nationalCash;
    const spent = (moves: BotMove[]) =>
      moves.reduce((sum, m) => {
        if (m.kind === 'state') {
          const us = STATE_BY_ID[m.targetId];
          return sum + calcStateCost(m.targetId, us.baseCampaignCost, 0, m.rungs, bestAffinityForState(state.players[1], m.targetId));
        }
        return sum + calcNationalCost(m.targetId, 0, m.rungs, state.players[1]);
      }, 0);
    const easySpend = spent(planBotTurn(state, botId, 'easy', mulberry32(5)));
    const hardSpend = spent(planBotTurn(state, botId, 'hard', mulberry32(5)));
    expect(easySpend).toBeLessThanOrEqual(start);
    expect(hardSpend).toBeLessThanOrEqual(start);
    expect(hardSpend).toBeLessThan(easySpend); // hard reserves; easy dumps cash
  });
});
