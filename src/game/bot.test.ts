import { describe, it, expect } from 'vitest';
import { planBotTurn, type BotMove } from './bot';
import {
  bestAffinityForState,
  calcStateCost,
  calcNationalCost,
  computeWalletSplit,
  maxBuyableThisTurn,
  resolveTurn,
  tallyElectoralVotes,
} from './engine';
import { createInitialGameState, createInitialGameStateFromPlayers, playerFromCandidate, ALL_STATES } from './statesData';
import { NATIONAL_GROUPS } from './config';
import { CANDIDATES } from './candidates';
import type { BotDifficulty, GameState, PendingPurchase, PlayerState } from './types';

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

function movesToPending(state: GameState, playerId: string, moves: BotMove[]): PendingPurchase[] {
  const p = state.players.find((x) => x.id === playerId)!;
  const tracker: PlayerState = { ...p, groupWallets: { ...p.groupWallets } };
  const pendingRungs: Record<string, number> = {};
  const purchases: PendingPurchase[] = [];

  for (const m of moves) {
    if (m.kind === 'state') {
      const us = STATE_BY_ID[m.targetId];
      const startRung = state.rungs[m.targetId]?.[playerId] ?? 0;
      const pend = pendingRungs[m.targetId] ?? 0;
      const discount = bestAffinityForState(tracker, m.targetId);
      const cost = calcStateCost(m.targetId, us.baseCampaignCost, startRung + pend, m.rungs, discount);
      const split = computeWalletSplit(tracker, m.targetId, cost);
      if (!split) continue;
      for (const d of split.walletDraw) {
        if (d.wallet === 'NATIONAL') tracker.nationalCash -= d.amount;
        else tracker.groupWallets[d.wallet] -= d.amount;
      }
      pendingRungs[m.targetId] = pend + m.rungs;
      purchases.push({ kind: 'state', targetId: m.targetId, rungs: m.rungs, cost, walletDraw: split.walletDraw });
    } else {
      const startRung = state.natRungs[m.targetId]?.[playerId] ?? 0;
      const pend = pendingRungs[m.targetId] ?? 0;
      const cost = calcNationalCost(m.targetId, startRung + pend, m.rungs, tracker);
      if (cost > tracker.nationalCash) continue;
      tracker.nationalCash -= cost;
      pendingRungs[m.targetId] = pend + m.rungs;
      purchases.push({ kind: 'national', targetId: m.targetId, rungs: m.rungs, cost, walletDraw: [{ wallet: 'NATIONAL', amount: cost }] });
    }
  }

  return purchases;
}

function simulateDuel(
  left: BotDifficulty,
  right: BotDifficulty,
  seed: number,
  candidateIndex: number,
): Record<BotDifficulty, number> {
  const base = CANDIDATES[candidateIndex % CANDIDATES.length];
  const players = [
    { ...playerFromCandidate(base, { id: `${left}-left`, name: left }), isBot: true, botDifficulty: left },
    { ...playerFromCandidate(base, { id: `${right}-right`, name: right }), isBot: true, botDifficulty: right },
  ];
  let state = createInitialGameStateFromPlayers(players);
  const rngs = Object.fromEntries(players.map((p, i) => [p.id, mulberry32(seed * 100 + i + 1)]));

  for (let turn = 0; turn < 12; turn++) {
    const pending: Record<string, PendingPurchase[]> = {};
    for (const p of players) {
      const view = { ...state, pendingByPlayer: pending } as GameState;
      const moves = planBotTurn(view, p.id, p.botDifficulty!, rngs[p.id]);
      pending[p.id] = movesToPending(state, p.id, moves);
    }
    const result = resolveTurn(state, pending);
    state = { ...result.state, turn: state.turn + 1 };
  }

  const evs = tallyElectoralVotes(state).evByPlayer;
  return {
    easy: players.filter((p) => p.botDifficulty === 'easy').reduce((sum, p) => sum + (evs[p.id] ?? 0), 0),
    medium: players.filter((p) => p.botDifficulty === 'medium').reduce((sum, p) => sum + (evs[p.id] ?? 0), 0),
    hard: players.filter((p) => p.botDifficulty === 'hard').reduce((sum, p) => sum + (evs[p.id] ?? 0), 0),
  };
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

  it('easy leaves budget unused while hard makes a serious plan', () => {
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
    expect(easySpend).toBeLessThan(start);
    expect(hardSpend).toBeGreaterThan(0);
  });

  it('calibrates full simulated games by difficulty tier', () => {
    const mediumVsEasy = { easy: 0, medium: 0 };
    const hardVsMedium = { medium: 0, hard: 0 };

    for (let seed = 1; seed <= 5; seed++) {
      for (let c = 0; c < 3; c++) {
        const meA = simulateDuel('medium', 'easy', seed, c);
        const meB = simulateDuel('easy', 'medium', seed + 50, c);
        mediumVsEasy.medium += meA.medium + meB.medium;
        mediumVsEasy.easy += meA.easy + meB.easy;

        const hmA = simulateDuel('hard', 'medium', seed + 100, c);
        const hmB = simulateDuel('medium', 'hard', seed + 150, c);
        hardVsMedium.hard += hmA.hard + hmB.hard;
        hardVsMedium.medium += hmA.medium + hmB.medium;
      }
    }

    expect(hardVsMedium.hard).toBeGreaterThan(hardVsMedium.medium);
    expect(mediumVsEasy.medium).toBeGreaterThan(mediumVsEasy.easy);
  }, 30000);
});
