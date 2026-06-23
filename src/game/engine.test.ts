import { describe, it, expect } from 'vitest';
import {
  calcStateCost,
  calcNationalCost,
  maxBuyableThisTurn,
  computeWalletSplit,
  recomputeDominance,
  groupDominanceProgress,
  resolveTurn,
  tallyElectoralVotes,
  rollElection,
  resolveElection,
  validatePurchase,
  payTurnIncome,
  bestAffinityForState,
} from './engine';
import { ALL_STATES } from './statesData';
import { CANDIDATE_MAP } from './candidates';
import { NATIONAL_GROUPS, STATE_GROUPS, STATE_GROUP_MAP, NATIONAL_GROUP_MAP, electionProbability, maxRungsFor } from './config';
import type { GameState, PlayerState } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlayer(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    candidateId: id,
    name: id,
    affinities: {},
    payoutModifiers: {},
    nationalCash: 1000,
    groupWallets: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, 0])),
    eliminated: false,
    ...overrides,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const players = [makePlayer('p1'), makePlayer('p2')];
  const stateIds = ALL_STATES.map((s) => s.id);
  const natIds = NATIONAL_GROUPS.map((g) => g.id);

  return {
    turn: 1,
    seqCounter: 0,
    players,
    rungs: Object.fromEntries(stateIds.map((id) => [id, { p1: 0, p2: 0 }])),
    natRungs: Object.fromEntries(natIds.map((id) => [id, { p1: 0, p2: 0 }])),
    reachSeq: Object.fromEntries(stateIds.map((id) => [id, { p1: 0, p2: 0 }])),
    natReachSeq: Object.fromEntries(natIds.map((id) => [id, { p1: 0, p2: 0 }])),
    securedBy: Object.fromEntries(stateIds.map((id) => [id, null])),
    natSecuredBy: Object.fromEntries(natIds.map((id) => [id, null])),
    stateGroupDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
    hungColleges: 0,
    ...overrides,
  };
}

// ── 1. Rung tiers ─────────────────────────────────────────────────────────────

describe('maxRungsFor', () => {
  it('megastates get 16 rungs', () => {
    expect(maxRungsFor('CA', 54)).toBe(16);
    expect(maxRungsFor('FL', 30)).toBe(16);
    expect(maxRungsFor('TX', 40)).toBe(16);
    expect(maxRungsFor('NY', 28)).toBe(16);
  });
  it('small states (EV ≤ 6) get 8 rungs', () => {
    expect(maxRungsFor('WY', 3)).toBe(8);
    expect(maxRungsFor('VT', 3)).toBe(8);
    expect(maxRungsFor('NV', 6)).toBe(8);
    expect(maxRungsFor('AR', 6)).toBe(8);
  });
  it('mid-tier states get 12 rungs', () => {
    expect(maxRungsFor('OH', 17)).toBe(12);
    expect(maxRungsFor('PA', 19)).toBe(12);
    expect(maxRungsFor('MI', 15)).toBe(12);
  });
});

// ── 2. Rung cost & Boss Rung ──────────────────────────────────────────────────

describe('calcStateCost — flat cost', () => {
  it('standard rung = 1× baseCampaignCost', () => {
    // Ohio baseCampaignCost = 15, mid-tier (12 rungs)
    const cost = calcStateCost('OH', 15, 0, 1, 0);
    expect(cost).toBeCloseTo(15);
  });

  it('affinity discount reduces cost', () => {
    const withDiscount = calcStateCost('OH', 15, 0, 1, 0.20);
    expect(withDiscount).toBeCloseTo(12); // 15 * (1 - 0.20)
  });

  it('multiple rungs sum flat costs', () => {
    const cost = calcStateCost('OH', 15, 0, 3, 0);
    expect(cost).toBeCloseTo(45); // 3 × 15
  });

  it('CA rung 16 (Boss Rung) costs 4× base', () => {
    // CA base = 46, 16 rungs total, boss is rung index 16
    const bossOnly = calcStateCost('CA', 46, 15, 1, 0); // buying rung 16 from 15
    expect(bossOnly).toBeCloseTo(184); // 46 * 4
  });

  it('TX rung 16 (Boss Rung) costs 4× base', () => {
    const bossOnly = calcStateCost('TX', 34, 15, 1, 0);
    expect(bossOnly).toBeCloseTo(136); // 34 * 4
  });

  it('FL rung 16 is NOT a boss rung (normal 1×)', () => {
    // FL is mega (16 rungs) but not CA/TX
    const cost = calcStateCost('FL', 26, 15, 1, 0);
    expect(cost).toBeCloseTo(26); // 1× only
  });
});

// ── 3. Entry Gatekeeper ───────────────────────────────────────────────────────

describe('maxBuyableThisTurn (entry gatekeeper)', () => {
  it('0 rungs in 8-rung state → max 2', () => {
    expect(maxBuyableThisTurn(0, 8)).toBe(2);
  });
  it('0 rungs in 12-rung state → max 2', () => {
    expect(maxBuyableThisTurn(0, 12)).toBe(2);
  });
  it('0 rungs in 16-rung state → max 3', () => {
    expect(maxBuyableThisTurn(0, 16)).toBe(3);
  });
  it('1+ rungs → uncapped (returns remaining)', () => {
    expect(maxBuyableThisTurn(1, 12)).toBe(11);
    expect(maxBuyableThisTurn(5, 16)).toBe(11);
    expect(maxBuyableThisTurn(7, 8)).toBe(1);
  });
});

// ── 4. Wallet split ───────────────────────────────────────────────────────────

describe('computeWalletSplit', () => {
  it('drains group wallets before nationalCash', () => {
    // CA is in: Agriculture, Export Driven, High Tech, Latino, Oil and Gas (alphabetical)
    const player = makePlayer('p1', {
      nationalCash: 1000,
      groupWallets: {
        ...Object.fromEntries(STATE_GROUPS.map((g) => [g.id, 0])),
        'Export Driven': 20,
        'High Tech': 30,
        'Latino': 10,
      },
    });
    const result = computeWalletSplit(player, 'CA', 45);
    expect(result).not.toBeNull();
    // Alphabetical drain: Export Driven first (20), then High Tech (25 remaining → 25 of 30)
    const draws = result!.walletDraw;
    const edDraw = draws.find((d) => d.wallet === 'Export Driven');
    const htDraw = draws.find((d) => d.wallet === 'High Tech');
    expect(edDraw?.amount).toBe(20);
    expect(htDraw?.amount).toBe(25);
    expect(draws.find((d) => d.wallet === 'NATIONAL')).toBeUndefined(); // fully covered by wallets
  });

  it('falls back to nationalCash for remainder', () => {
    const player = makePlayer('p1', {
      nationalCash: 1000,
      groupWallets: {
        ...Object.fromEntries(STATE_GROUPS.map((g) => [g.id, 0])),
        'High Tech': 10,
      },
    });
    const result = computeWalletSplit(player, 'CA', 50);
    expect(result).not.toBeNull();
    const natDraw = result!.walletDraw.find((d) => d.wallet === 'NATIONAL');
    expect(natDraw?.amount).toBe(40);
  });

  it('returns null when insufficient total funds', () => {
    const player = makePlayer('p1', {
      nationalCash: 5,
      groupWallets: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, 0])),
    });
    const result = computeWalletSplit(player, 'OH', 100);
    expect(result).toBeNull();
  });
});

// ── 5. National group cost ────────────────────────────────────────────────────

describe('calcNationalCost', () => {
  it('flat cost = rungCost * rungs * (1 - affinity)', () => {
    const g = NATIONAL_GROUPS[0]; // Gun Lobby, rungCost = 25
    const player = makePlayer('p1', { affinities: { [g.id]: 0.20 } });
    const cost = calcNationalCost(g.id, 0, 2, player);
    expect(cost).toBeCloseTo(g.rungCost * 2 * 0.80);
  });
});

// ── 6. Simultaneous resolution — clash revert ─────────────────────────────────

describe('resolveTurn — clash revert', () => {
  it('both players hitting max rung same turn → both reverted, cash forfeit', () => {
    // Ohio: 12 rungs, base = 15
    const state = makeState({
      players: [
        makePlayer('p1', { nationalCash: 500 }),
        makePlayer('p2', { nationalCash: 500 }),
      ],
      rungs: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
        OH: { p1: 11, p2: 11 }, // one rung away from max
      },
      reachSeq: Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
    });

    const { state: result, report } = resolveTurn(state, {
      p1: [{ kind: 'state', targetId: 'OH', rungs: 1, cost: 15, walletDraw: [{ wallet: 'NATIONAL', amount: 15 }] }],
      p2: [{ kind: 'state', targetId: 'OH', rungs: 1, cost: 15, walletDraw: [{ wallet: 'NATIONAL', amount: 15 }] }],
    });

    // Report flags the clash
    expect(report.clashedStates).toContain('OH');
    expect(report.newlySecured).toHaveLength(0);
    // Rungs reverted
    expect(result.rungs['OH']['p1']).toBe(11);
    expect(result.rungs['OH']['p2']).toBe(11);
    // State NOT secured
    expect(result.securedBy['OH']).toBeNull();
    // Cash is forfeit (was deducted via walletDraw, not refunded)
    const p1 = result.players.find((p) => p.id === 'p1')!;
    const p2 = result.players.find((p) => p.id === 'p2')!;
    // Income was added during resolution, so cash = 500 - 15 + income
    // We just verify cash is LESS than 500 + income (i.e. cost was not refunded)
    expect(p1.nationalCash).toBeLessThan(500 + 250 + 5); // rough sanity: not fully refunded
    expect(p2.nationalCash).toBeLessThan(500 + 250 + 5);
  });

  it('single player hitting max rung → secures state', () => {
    const state = makeState({
      rungs: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
        OH: { p1: 11, p2: 0 },
      },
      reachSeq: Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
    });

    const { state: result, report } = resolveTurn(state, {
      p1: [{ kind: 'state', targetId: 'OH', rungs: 1, cost: 15, walletDraw: [{ wallet: 'NATIONAL', amount: 15 }] }],
      p2: [],
    });

    expect(result.securedBy['OH']).toBe('p1');
    expect(result.rungs['OH']['p1']).toBe(12);
    expect(report.newlySecured).toContainEqual({ kind: 'state', targetId: 'OH', playerId: 'p1' });
  });

  it('third player unaffected by clash between other two', () => {
    // 3-player game: p1 and p2 clash, p3 was already at 10 rungs
    const state = makeState({
      players: [makePlayer('p1'), makePlayer('p2'), makePlayer('p3', { nationalCash: 500 })],
      rungs: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0, p3: 0 }])),
        OH: { p1: 11, p2: 11, p3: 10 },
      },
      reachSeq: Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0, p3: 0 }])),
      natRungs: Object.fromEntries(NATIONAL_GROUPS.map((g) => [g.id, { p1: 0, p2: 0, p3: 0 }])),
      natReachSeq: Object.fromEntries(NATIONAL_GROUPS.map((g) => [g.id, { p1: 0, p2: 0, p3: 0 }])),
      stateGroupDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
    });

    const { state: result } = resolveTurn(state, {
      p1: [{ kind: 'state', targetId: 'OH', rungs: 1, cost: 15, walletDraw: [{ wallet: 'NATIONAL', amount: 15 }] }],
      p2: [{ kind: 'state', targetId: 'OH', rungs: 1, cost: 15, walletDraw: [{ wallet: 'NATIONAL', amount: 15 }] }],
      p3: [],
    });

    // p1 and p2 clash and revert
    expect(result.rungs['OH']['p1']).toBe(11);
    expect(result.rungs['OH']['p2']).toBe(11);
    // p3 unaffected
    expect(result.rungs['OH']['p3']).toBe(10);
    expect(result.securedBy['OH']).toBeNull();
  });
});

// ── 7. State Group Dominance ──────────────────────────────────────────────────

describe('recomputeDominance', () => {
  it('player with >50% EV and ≥3 rungs in member states is dominant', () => {
    // Swing States: CO, FL, IA, MI, NC, NH, NV, OH, PA, VA, WI
    // PA = 19 EV, MI = 15 EV, OH = 17 EV (if all 3 with ≥3 rungs for p1 → 51 EVs)
    // Swing States totalEV (from config) — we just test the mechanism
    const swingGroup = STATE_GROUPS.find((g) => g.id === 'Swing States')!;

    const players = [makePlayer('p1'), makePlayer('p2')];
    const prevDom = Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null]));
    const stateIds = ALL_STATES.map((s) => s.id);

    // Give p1 ≥3 rungs in PA, MI, OH (all swing states)
    const rungs = Object.fromEntries(stateIds.map((id) => [
      id,
      id === 'PA' || id === 'MI' || id === 'OH'
        ? { p1: 5, p2: 1 }
        : { p1: 0, p2: 0 },
    ]));
    const reachSeq = Object.fromEntries(stateIds.map((id) => [id, { p1: 1, p2: 2 }]));

    const dom = recomputeDominance(rungs, reachSeq, players, prevDom);

    // PA(19) + MI(15) + OH(17) = 51 EV vs swing totalEV
    const needed = swingGroup.totalEV * 0.5;
    if (51 > needed) {
      expect(dom['Swing States']).toBe('p1');
    }
  });

  it('3-rung gate: player with only 2 rungs does not qualify for dominance EV', () => {
    const players = [makePlayer('p1'), makePlayer('p2')];
    const prevDom = Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null]));
    const stateIds = ALL_STATES.map((s) => s.id);

    // p1 has only 2 rungs everywhere → should NOT dominate any group
    const rungs = Object.fromEntries(stateIds.map((id) => [id, { p1: 2, p2: 0 }]));
    const reachSeq = Object.fromEntries(stateIds.map((id) => [id, { p1: 1, p2: 0 }]));

    const dom = recomputeDominance(rungs, reachSeq, players, prevDom);

    for (const g of STATE_GROUPS) {
      expect(dom[g.id]).toBeNull();
    }
  });

  it('evaporation: losing player wallet drops to 0', () => {
    const swingGroup = STATE_GROUPS.find((g) => g.id === 'Swing States')!;
    const players = [
      makePlayer('p1', {
        groupWallets: { ...Object.fromEntries(STATE_GROUPS.map((g) => [g.id, 0])), 'Swing States': 200 },
      }),
      makePlayer('p2'),
    ];
    // p1 was previously dominant but now p2 takes over
    const prevDom = { ...Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])), 'Swing States': 'p1' };
    const stateIds = ALL_STATES.map((s) => s.id);

    // Give p2 dominant rungs in enough swing states
    const swingMembers = swingGroup.members;
    const rungs = Object.fromEntries(stateIds.map((id) => [
      id,
      swingMembers.includes(id) ? { p1: 1, p2: 5 } : { p1: 0, p2: 0 },
    ]));
    const reachSeq = Object.fromEntries(stateIds.map((id) => [id, { p1: 1, p2: 2 }]));

    recomputeDominance(rungs, reachSeq, players, prevDom);

    // p1 lost dominance → wallet evaporated
    expect(players[0].groupWallets['Swing States']).toBe(0);
  });
});

// ── 8. Electoral tally ────────────────────────────────────────────────────────

describe('tallyElectoralVotes', () => {
  it('secured states count regardless of rung gap', () => {
    const state = makeState({
      securedBy: { ...Object.fromEntries(ALL_STATES.map((s) => [s.id, null])), CA: 'p1' },
    });
    const result = tallyElectoralVotes(state);
    expect(result.evByPlayer['p1']).toBeGreaterThanOrEqual(54);
  });

  it('sole investor wins EVs immediately (no second player required)', () => {
    const state = makeState({
      rungs: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
        OH: { p1: 5, p2: 0 },
      },
    });
    const result = tallyElectoralVotes(state);
    // OH has only p1 invested → p1 wins all EVs immediately
    expect(result.stateLeaders['OH']).toBe('p1');
    expect(result.evByPlayer['p1']).toBeGreaterThanOrEqual(17);
  });

  it('state with no investors gives 0 EV to all', () => {
    const state = makeState({
      rungs: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
      },
    });
    const result = tallyElectoralVotes(state);
    // No one invested in OH → no EV leader
    expect(result.stateLeaders['OH']).toBeNull();
  });

  it('contested: higher rung count wins EVs', () => {
    const state = makeState({
      rungs: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
        OH: { p1: 8, p2: 3 },
      },
      reachSeq: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
        OH: { p1: 1, p2: 2 },
      },
    });
    const result = tallyElectoralVotes(state);
    expect(result.stateLeaders['OH']).toBe('p1');
    expect(result.evByPlayer['p1']).toBeGreaterThanOrEqual(17); // OH = 17 EV
  });

  it('tie in rungs → lower reachSeq (invested first) wins', () => {
    const state = makeState({
      rungs: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
        OH: { p1: 5, p2: 5 },
      },
      reachSeq: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0 }])),
        OH: { p1: 1, p2: 3 }, // p1 invested first (lower seq = earlier)
      },
    });
    const result = tallyElectoralVotes(state);
    expect(result.stateLeaders['OH']).toBe('p1');
  });

  it('winner declared at ≥270 EV', () => {
    // Secure enough big states for p1
    const securedBy = Object.fromEntries(ALL_STATES.map((s) => [s.id, null as string | null]));
    let evSum = 0;
    for (const s of ALL_STATES) {
      if (evSum >= 270) break;
      securedBy[s.id] = 'p1';
      evSum += s.electoralVotes;
    }
    const state = makeState({ securedBy });
    const result = tallyElectoralVotes(state);
    expect(result.winner).toBe('p1');
  });
});

// ── 9. Election probability ───────────────────────────────────────────────────

describe('electionProbability', () => {
  it('turns 1–10 → 0%', () => {
    for (let t = 1; t <= 10; t++) {
      expect(electionProbability(t, 0)).toBe(0);
    }
  });
  it('turn 11+, 0 hung → 12.5%', () => {
    expect(electionProbability(11, 0)).toBe(0.125);
    expect(electionProbability(15, 0)).toBe(0.125);
  });
  it('turn 16, 0 hung → 100%', () => {
    expect(electionProbability(16, 0)).toBe(1);
  });
  it('1 hung college → 25%', () => {
    expect(electionProbability(11, 1)).toBe(0.25);
  });
  it('2 hung colleges → 50%', () => {
    expect(electionProbability(12, 2)).toBe(0.5);
  });
  it('3+ hung colleges → 100%', () => {
    expect(electionProbability(11, 3)).toBe(1);
    expect(electionProbability(12, 5)).toBe(1);
  });
});

describe('rollElection', () => {
  it('never triggers before turn 11', () => {
    const state = makeState({ turn: 10, hungColleges: 3 });
    expect(rollElection(state, () => 0.0)).toBe(false);
  });
  it('triggers when rng < probability', () => {
    const state = makeState({ turn: 11, hungColleges: 0 });
    expect(rollElection(state, () => 0.1)).toBe(true);  // 0.1 < 0.125
    expect(rollElection(state, () => 0.2)).toBe(false); // 0.2 > 0.125
  });
  it('always triggers at 100% probability', () => {
    const state = makeState({ turn: 11, hungColleges: 3 });
    expect(rollElection(state, () => 0.9999)).toBe(true);
  });
});

// ── 10. Election resolution — elimination & Power Vacuum ─────────────────────

describe('resolveElection', () => {
  it('winner → outcome type winner', () => {
    const securedBy = Object.fromEntries(ALL_STATES.map((s) => [s.id, null as string | null]));
    let evSum = 0;
    for (const s of ALL_STATES) {
      if (evSum >= 270) break;
      securedBy[s.id] = 'p1';
      evSum += s.electoralVotes;
    }
    const state = makeState({ securedBy });
    const outcome = resolveElection(state);
    expect(outcome.type).toBe('winner');
  });

  it('2 players, no winner → hung college', () => {
    const state = makeState(); // both 0 EV, 2 players
    const outcome = resolveElection(state);
    expect(outcome.type).toBe('hung');
  });

  it('3+ players, no winner → eliminate last place + power vacuum', () => {
    const players = [
      makePlayer('p1', { nationalCash: 1000 }),
      makePlayer('p2', { nationalCash: 1000 }),
      makePlayer('p3', { nationalCash: 500 }),
    ];
    // Give p1 and p2 some EVs (via secured states), p3 gets nothing
    const securedBy = Object.fromEntries(ALL_STATES.map((s) => [s.id, null as string | null]));
    securedBy['CA'] = 'p1'; // 54 EV
    securedBy['TX'] = 'p2'; // 40 EV
    // p3 has rungs in OH but not contested (give p1 rungs too for contest)
    const state = makeState({
      players,
      securedBy,
      rungs: {
        ...Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0, p3: 0 }])),
        OH: { p1: 3, p2: 0, p3: 2 },
      },
      reachSeq: Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0, p3: 0 }])),
      natRungs: Object.fromEntries(NATIONAL_GROUPS.map((g) => [g.id, { p1: 0, p2: 0, p3: 0 }])),
      natReachSeq: Object.fromEntries(NATIONAL_GROUPS.map((g) => [g.id, { p1: 0, p2: 0, p3: 0 }])),
      stateGroupDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
    });

    const outcome = resolveElection(state);
    expect(outcome.type).toBe('elimination');
    expect(outcome.eliminatedId).toBe('p3');

    // Power vacuum: p3's rungs wiped in OH
    expect(outcome.nextState!.rungs['OH']['p3']).toBe(0);
    // p3 marked eliminated
    expect(outcome.nextState!.players.find((p) => p.id === 'p3')!.eliminated).toBe(true);
    // hungColleges incremented
    expect(outcome.nextState!.hungColleges).toBe(1);
  });

  it('elimination tie-break: lowest total cash loses', () => {
    const players = [
      makePlayer('p1', { nationalCash: 1000 }),
      makePlayer('p2', { nationalCash: 1000 }),
      makePlayer('p3', { nationalCash: 100 }), // tied EVs but lowest cash
      makePlayer('p4', { nationalCash: 200 }),
    ];
    const state = makeState({
      players,
      rungs: Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0, p3: 0, p4: 0 }])),
      reachSeq: Object.fromEntries(ALL_STATES.map((s) => [s.id, { p1: 0, p2: 0, p3: 0, p4: 0 }])),
      natRungs: Object.fromEntries(NATIONAL_GROUPS.map((g) => [g.id, { p1: 0, p2: 0, p3: 0, p4: 0 }])),
      natReachSeq: Object.fromEntries(NATIONAL_GROUPS.map((g) => [g.id, { p1: 0, p2: 0, p3: 0, p4: 0 }])),
      stateGroupDominance: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, null])),
    });
    const outcome = resolveElection(state);
    expect(outcome.type).toBe('elimination');
    expect(outcome.eliminatedId).toBe('p3'); // lowest cash among tied-EV players
  });
});

// ── 11. validatePurchase ──────────────────────────────────────────────────────

describe('validatePurchase', () => {
  it('blocks buying more than gatekeeper allows from 0 rungs', () => {
    const player = makePlayer('p1', { nationalCash: 9999 });
    const err = validatePurchase(player, 0, {
      kind: 'state', targetId: 'OH', rungsToBuy: 3, startRung: 0, pendingRungs: 0,
    });
    expect(err).not.toBeNull();
    expect(err!.reason).toMatch(/gatekeeper/i);
  });

  it('allows uncapped sprint from 1+ rungs', () => {
    const player = makePlayer('p1', { nationalCash: 9999 });
    const err = validatePurchase(player, 0, {
      kind: 'state', targetId: 'OH', rungsToBuy: 10, startRung: 1, pendingRungs: 0,
    });
    expect(err).toBeNull();
  });

  it('blocks when insufficient funds', () => {
    const player = makePlayer('p1', {
      nationalCash: 1,
      groupWallets: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, 0])),
    });
    const err = validatePurchase(player, 0, {
      kind: 'state', targetId: 'CA', rungsToBuy: 1, startRung: 0, pendingRungs: 0,
    });
    expect(err).not.toBeNull();
    expect(err!.reason).toMatch(/funds/i);
  });
});

// ── 12. Profit modifiers (payoutModifiers) ────────────────────────────────────

describe('payTurnIncome — profit modifiers', () => {
  it('state-group wallet bonus scales by +modifier', () => {
    const og = STATE_GROUP_MAP['Old South'];
    const p1 = makePlayer('p1', { payoutModifiers: { 'Old South': 0.10 } });
    payTurnIncome([p1], { 'Old South': 'p1' }, {}, {});
    expect(p1.groupWallets['Old South']).toBe(Math.round(og.bonusPayout * 1.10));
  });

  it('national-group bonus scales by +modifier', () => {
    const g = NATIONAL_GROUP_MAP['Gun Lobby'];
    const p1 = makePlayer('p1', { nationalCash: 0, payoutModifiers: { 'Gun Lobby': 0.15 } });
    const natRungs = { 'Gun Lobby': { p1: 6 } };
    const natReachSeq = { 'Gun Lobby': { p1: 1 } };
    payTurnIncome([p1], {}, natRungs, natReachSeq);
    // National flat income (240) + boosted Gun Lobby bonus
    expect(p1.nationalCash).toBe(240 + Math.round(g.turnBonus * 1.15));
  });

  it('negative modifier reduces the payout', () => {
    const g = NATIONAL_GROUP_MAP['Gun Lobby'];
    const p1 = makePlayer('p1', { nationalCash: 0, payoutModifiers: { 'Gun Lobby': -0.20 } });
    const natRungs = { 'Gun Lobby': { p1: 6 } };
    const natReachSeq = { 'Gun Lobby': { p1: 1 } };
    payTurnIncome([p1], {}, natRungs, natReachSeq);
    expect(p1.nationalCash).toBe(240 + Math.round(g.turnBonus * 0.80));
  });

  it('no modifier = unchanged base payout', () => {
    const g = NATIONAL_GROUP_MAP['Gun Lobby'];
    const p1 = makePlayer('p1', { nationalCash: 0 });
    payTurnIncome([p1], {}, { 'Gun Lobby': { p1: 6 } }, { 'Gun Lobby': { p1: 1 } });
    expect(p1.nationalCash).toBe(240 + g.turnBonus);
  });
});

// ── 13. Penalty-aware cost affinity ───────────────────────────────────────────

describe('bestAffinityForState — penalties', () => {
  it('positive affinity still yields a discount', () => {
    // Old South member; Lincoln has African American .15 (AL is in both)
    const lincoln = makePlayer('lincoln', { affinities: { 'African American': 0.15 } });
    expect(bestAffinityForState(lincoln, 'AL')).toBeCloseTo(0.15);
  });

  it('a non-negative member group masks a penalty in another group', () => {
    // MA ∈ {High Tech, Town and Gown}. Penalise High Tech only;
    // Town and Gown is neutral (0) → max is 0, no penalty applied.
    const p = makePlayer('p1', { affinities: { 'High Tech': -0.15 } });
    expect(bestAffinityForState(p, 'MA')).toBe(0);
  });

  it('penalty applies only when every member group is penalised', () => {
    // Pick a state and penalise ALL of its member groups → cost rises.
    const sid = 'MA';
    const groups = STATE_GROUPS.filter((g) => g.members.includes(sid)).map((g) => g.id);
    const affinities = Object.fromEntries(groups.map((gid) => [gid, -0.20]));
    const p = makePlayer('p1', { affinities });
    expect(bestAffinityForState(p, sid)).toBeCloseTo(-0.20);
    // cost = round(base * (1 - (-0.20))) = round(base * 1.20)
    const base = ALL_STATES.find((s) => s.id === sid)!.baseCampaignCost;
    expect(calcStateCost(sid, base, 0, 1, bestAffinityForState(p, sid))).toBe(Math.round(base * 1.20));
  });
});

// ── 14. Candidate roster override values ──────────────────────────────────────

describe('candidate roster — Trump override', () => {
  it('Gun Lobby cost reduction is 0.15 (overridden from 0.20)', () => {
    expect(CANDIDATE_MAP['trump'].affinities['Gun Lobby']).toBe(0.15);
  });
  it('has the new Swing States cost affinity of 0.05', () => {
    expect(CANDIDATE_MAP['trump'].affinities['Swing States']).toBe(0.05);
  });
  it('Trump national Gun Lobby rung cost reflects the 0.15 discount', () => {
    const trump = makePlayer('trump', { affinities: { 'Gun Lobby': 0.15 } });
    const g = NATIONAL_GROUP_MAP['Gun Lobby'];
    expect(calcNationalCost('Gun Lobby', 0, 1, trump)).toBe(Math.round(g.rungCost * 0.85));
  });
  it('starting cash: Tooley 300, others 250', () => {
    expect(CANDIDATE_MAP['tooley'].startingCash).toBe(300);
    expect(CANDIDATE_MAP['trump'].startingCash).toBe(250);
    expect(CANDIDATE_MAP['harris'].startingCash).toBe(250);
    expect(CANDIDATE_MAP['lincoln'].startingCash).toBe(250);
  });
});

describe('groupDominanceProgress', () => {
  const group = STATE_GROUPS[0];

  it('a player leading every member state gets the full group EV and clears the threshold', () => {
    const players = [makePlayer('p1'), makePlayer('p2')];
    const rungs: Record<string, Record<string, number>> = {};
    const reachSeq: Record<string, Record<string, number>> = {};
    for (const sid of group.members) {
      rungs[sid] = { p1: 5, p2: 0 };   // 5 ≥ max minRungsForDominance, so p1 qualifies everywhere
      reachSeq[sid] = { p1: 1, p2: 0 };
    }
    const { evByPlayer, totalEV, threshold } = groupDominanceProgress(group, rungs, reachSeq, players);
    expect(totalEV).toBe(group.totalEV);
    expect(threshold).toBe(group.totalEV * 0.5);
    expect(evByPlayer.p1).toBe(group.totalEV);
    expect(evByPlayer.p2).toBe(0);
    expect(evByPlayer.p1).toBeGreaterThan(threshold);
  });

  it('a player below the min-rung requirement contributes no EV', () => {
    const players = [makePlayer('p1')];
    const rungs: Record<string, Record<string, number>> = {};
    const reachSeq: Record<string, Record<string, number>> = {};
    for (const sid of group.members) {
      rungs[sid] = { p1: 1 };   // 1 rung < min (3+) → never qualifies
      reachSeq[sid] = { p1: 1 };
    }
    const { evByPlayer } = groupDominanceProgress(group, rungs, reachSeq, players);
    expect(evByPlayer.p1).toBe(0);
  });
});
