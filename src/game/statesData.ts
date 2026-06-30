/**
 * Static data: all 50 US states + DC, and candidate seed profiles.
 *
 * maxRungs is DERIVED via maxRungsFor() in config.ts:
 *   Megastates (CA, FL, TX, NY) → 16 rungs
 *   Small states (EV ≤ 6)      →  8 rungs
 *   Mid-tier (everything else)  → 12 rungs
 *
 * baseCampaignCost ≈ EVs × 0.85, floor 3. Used as the flat per-rung cost ($1k units).
 *
 * Coalition membership is defined entirely in config.ts (STATE_GROUPS).
 * Candidate affinities are keyed to StateGroupId / NationalGroupId.
 */

import { maxRungsFor, MEGASTATE_IDS, STATE_GROUPS, NATIONAL_GROUPS, NATIONAL_INCOME } from './config';
import { CANDIDATES, type CandidateDef } from './candidates';
import type { GameState, NatRungMap, NatReachSeq, PlayerState, RungMap, ReachSeq, US_State } from './types';

// ── 51 territory definitions ──────────────────────────────────────────────────

const RAW_STATES: Array<Omit<US_State, 'maxRungs'>> = [
  { id:'AL', name:'Alabama',              electoralVotes:9,  baseCampaignCost:42  },
  { id:'AK', name:'Alaska',               electoralVotes:3,  baseCampaignCost:10  },
  { id:'AZ', name:'Arizona',              electoralVotes:11, baseCampaignCost:46  },
  { id:'AR', name:'Arkansas',             electoralVotes:6,  baseCampaignCost:36  },
  { id:'CA', name:'California',           electoralVotes:54, baseCampaignCost:150 },
  { id:'CO', name:'Colorado',             electoralVotes:10, baseCampaignCost:44  },
  { id:'CT', name:'Connecticut',          electoralVotes:7,  baseCampaignCost:30  },
  { id:'DE', name:'Delaware',             electoralVotes:3,  baseCampaignCost:14  },
  { id:'DC', name:'District of Columbia', electoralVotes:3,  baseCampaignCost:22  },
  { id:'FL', name:'Florida',              electoralVotes:30, baseCampaignCost:100 },
  { id:'GA', name:'Georgia',              electoralVotes:16, baseCampaignCost:72  },
  { id:'HI', name:'Hawaii',               electoralVotes:4,  baseCampaignCost:13  },
  { id:'ID', name:'Idaho',                electoralVotes:4,  baseCampaignCost:13  },
  { id:'IL', name:'Illinois',             electoralVotes:19, baseCampaignCost:70  },
  { id:'IN', name:'Indiana',              electoralVotes:11, baseCampaignCost:30  },
  { id:'IA', name:'Iowa',                 electoralVotes:6,  baseCampaignCost:28  },
  { id:'KS', name:'Kansas',               electoralVotes:6,  baseCampaignCost:20  },
  { id:'KY', name:'Kentucky',             electoralVotes:8,  baseCampaignCost:24  },
  { id:'LA', name:'Louisiana',            electoralVotes:8,  baseCampaignCost:40  },
  { id:'ME', name:'Maine',                electoralVotes:4,  baseCampaignCost:13  },
  { id:'MD', name:'Maryland',             electoralVotes:10, baseCampaignCost:44  },
  { id:'MA', name:'Massachusetts',        electoralVotes:11, baseCampaignCost:38  },
  { id:'MI', name:'Michigan',             electoralVotes:15, baseCampaignCost:78  },
  { id:'MN', name:'Minnesota',            electoralVotes:10, baseCampaignCost:28  },
  { id:'MS', name:'Mississippi',          electoralVotes:6,  baseCampaignCost:28  },
  { id:'MO', name:'Missouri',             electoralVotes:10, baseCampaignCost:28  },
  { id:'MT', name:'Montana',              electoralVotes:4,  baseCampaignCost:13  },
  { id:'NE', name:'Nebraska',             electoralVotes:5,  baseCampaignCost:17  },
  { id:'NV', name:'Nevada',               electoralVotes:6,  baseCampaignCost:28  },
  { id:'NH', name:'New Hampshire',        electoralVotes:4,  baseCampaignCost:16  },
  { id:'NJ', name:'New Jersey',           electoralVotes:14, baseCampaignCost:60  },
  { id:'NM', name:'New Mexico',           electoralVotes:5,  baseCampaignCost:18  },
  { id:'NY', name:'New York',             electoralVotes:28, baseCampaignCost:100 },
  { id:'NC', name:'North Carolina',       electoralVotes:16, baseCampaignCost:80  },
  { id:'ND', name:'North Dakota',         electoralVotes:3,  baseCampaignCost:10  },
  { id:'OH', name:'Ohio',                 electoralVotes:17, baseCampaignCost:66  },
  { id:'OK', name:'Oklahoma',             electoralVotes:7,  baseCampaignCost:14  },
  { id:'OR', name:'Oregon',               electoralVotes:8,  baseCampaignCost:16  },
  { id:'PA', name:'Pennsylvania',         electoralVotes:19, baseCampaignCost:78  },
  { id:'RI', name:'Rhode Island',         electoralVotes:4,  baseCampaignCost:13  },
  { id:'SC', name:'South Carolina',       electoralVotes:9,  baseCampaignCost:42  },
  { id:'SD', name:'South Dakota',         electoralVotes:3,  baseCampaignCost:10  },
  { id:'TN', name:'Tennessee',            electoralVotes:11, baseCampaignCost:46  },
  { id:'TX', name:'Texas',                electoralVotes:40, baseCampaignCost:150 },
  { id:'UT', name:'Utah',                 electoralVotes:6,  baseCampaignCost:28  },
  { id:'VT', name:'Vermont',              electoralVotes:3,  baseCampaignCost:10  },
  { id:'VA', name:'Virginia',             electoralVotes:13, baseCampaignCost:66  },
  { id:'WA', name:'Washington',           electoralVotes:12, baseCampaignCost:48  },
  { id:'WV', name:'West Virginia',        electoralVotes:4,  baseCampaignCost:13  },
  { id:'WI', name:'Wisconsin',            electoralVotes:10, baseCampaignCost:36  },
  { id:'WY', name:'Wyoming',              electoralVotes:3,  baseCampaignCost:10  },
];

// Balance pass: every state EXCEPT the four megastates (CA, FL, TX, NY) is 20%
// cheaper per rung — the non-megastates were too strong for their price. The
// megastates keep their full `baseCampaignCost`. Applied here at the single
// source so the value flows to both the app and the vendored edge engine.
export const ALL_STATES: readonly US_State[] = RAW_STATES.map((s) => ({
  ...s,
  baseCampaignCost: MEGASTATE_IDS.has(s.id)
    ? s.baseCampaignCost
    : Math.round(s.baseCampaignCost * 0.8),
  maxRungs: maxRungsFor(s.id, s.electoralVotes),
}));

// ── EV integrity guard ────────────────────────────────────────────────────────
const _evTotal = ALL_STATES.reduce((sum, s) => sum + s.electoralVotes, 0);
if (_evTotal !== 538) {
  throw new Error(`[statesData] EV total is ${_evTotal}, expected 538.`);
}

// ── Candidate → PlayerState ───────────────────────────────────────────────────

/** Build a fresh PlayerState from a candidate preset (zeroed wallets). */
export function playerFromCandidate(
  c: CandidateDef,
  overrides?: { id?: string; name?: string }
): PlayerState {
  return {
    id: overrides?.id ?? c.id,
    candidateId: c.id,
    name: overrides?.name ?? c.name,
    affinities: { ...c.affinities },
    payoutModifiers: { ...c.payoutModifiers },
    baseIncome: c.baseIncome ?? NATIONAL_INCOME,
    nationalCash: c.startingCash,
    groupWallets: Object.fromEntries(STATE_GROUPS.map((g) => [g.id, 0])),
    eliminated: false,
  };
}

// ── Game-state factory ────────────────────────────────────────────────────────

/**
 * Build a fresh game. Pass the chosen roster (2–4 candidates); defaults to the
 * first two presets so existing callers/tests keep working.
 */
export function createInitialGameState(
  chosen: readonly CandidateDef[] = CANDIDATES.slice(0, 2),
): GameState {
  const players: PlayerState[] = chosen.map((c) => playerFromCandidate(c));

  const rungs: RungMap = {};
  const reachSeq: ReachSeq = {};
  const securedBy: Record<string, string | null> = {};

  for (const s of ALL_STATES) {
    rungs[s.id] = Object.fromEntries(players.map((p) => [p.id, 0]));
    reachSeq[s.id] = Object.fromEntries(players.map((p) => [p.id, 0]));
    securedBy[s.id] = null;
  }

  const natRungs: NatRungMap = {};
  const natReachSeq: NatReachSeq = {};
  const natSecuredBy: Record<string, string | null> = {};

  for (const g of NATIONAL_GROUPS) {
    natRungs[g.id] = Object.fromEntries(players.map((p) => [p.id, 0]));
    natReachSeq[g.id] = Object.fromEntries(players.map((p) => [p.id, 0]));
    natSecuredBy[g.id] = null;
  }

  const stateGroupDominance: Record<string, string | null> = {};
  for (const g of STATE_GROUPS) {
    stateGroupDominance[g.id] = null;
  }

  return {
    turn: 1,
    seqCounter: 0,
    players,
    rungs,
    natRungs,
    reachSeq,
    natReachSeq,
    securedBy,
    natSecuredBy,
    stateGroupDominance,
    hungColleges: 0,
    electionScheduled: false,
  };
}

/**
 * Build a fresh game from a pre-built player list (online mode).
 * Use this instead of createInitialGameState when player UUIDs are already
 * assigned (e.g., from the waiting-room flow) and candidates may be duplicated.
 */
export function createInitialGameStateFromPlayers(players: PlayerState[]): GameState {
  const rungs: RungMap = {};
  const reachSeq: ReachSeq = {};
  const securedBy: Record<string, string | null> = {};

  for (const s of ALL_STATES) {
    rungs[s.id] = Object.fromEntries(players.map((p) => [p.id, 0]));
    reachSeq[s.id] = Object.fromEntries(players.map((p) => [p.id, 0]));
    securedBy[s.id] = null;
  }

  const natRungs: NatRungMap = {};
  const natReachSeq: NatReachSeq = {};
  const natSecuredBy: Record<string, string | null> = {};

  for (const g of NATIONAL_GROUPS) {
    natRungs[g.id] = Object.fromEntries(players.map((p) => [p.id, 0]));
    natReachSeq[g.id] = Object.fromEntries(players.map((p) => [p.id, 0]));
    natSecuredBy[g.id] = null;
  }

  const stateGroupDominance: Record<string, string | null> = {};
  for (const g of STATE_GROUPS) {
    stateGroupDominance[g.id] = null;
  }

  return {
    turn: 1,
    seqCounter: 0,
    players,
    rungs,
    natRungs,
    reachSeq,
    natReachSeq,
    securedBy,
    natSecuredBy,
    stateGroupDominance,
    hungColleges: 0,
    electionScheduled: false,
  };
}
