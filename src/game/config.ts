/**
 * Static configuration: State Groups, National Groups, economy constants.
 *
 * State Groups are the 8 wallet-bearing demographic/regional coalitions.
 * Membership is explicit (state IDs). A state may belong to multiple groups —
 * the wallet-drain order for multi-group states is alphabetical by group ID.
 *
 * National Groups are 10-rung side-battles distinct from the electoral map.
 * rungCost = turnBonus * 0.5 per the spec.
 *
 * Economy ($1k units):
 *   nationalCash income:  250/turn flat
 *   group wallet income:  bonusPayout/turn while dominant
 *   national-group bonus: turnBonus/turn while rung≥5 and leading
 */

import type { NationalGroup, StateGroup } from './types';

// ── Economy constants ─────────────────────────────────────────────────────────

export const NATIONAL_INCOME = 250;     // per turn, all active players
export const WIN_THRESHOLD = 270;
export const ELECTION_START_TURN = 11;
export const MEGASTATE_IDS = new Set(['CA', 'FL', 'TX', 'NY']);
export const BOSS_RUNG_IDS = new Set(['CA', 'TX']); // only these have 4× boss rung
export const BOSS_RUNG_MULTIPLIER = 4.0;

// ── State Groups ──────────────────────────────────────────────────────────────
// bonusPayout = Math.round(totalEV / 2) — tunable, computed below once totalEV is known.

const RAW_STATE_GROUPS: Array<Omit<StateGroup, 'totalEV' | 'bonusPayout'>> = [
  {
    id: 'African American',
    members: ['AL','AZ','DE','DC','FL','GA','IL','LA','MD','MI','MS','NY','NC','SC','TN','VA'],
  },
  {
    id: 'Latino',
    members: ['AZ','CA','CO','FL','IL','NV','NJ','NM','NY','TX'],
  },
  {
    id: 'Oil and Gas',
    members: ['AK','CA','CO','LA','NM','ND','OK','SD','TX','WV','WY'],
  },
  {
    id: 'High Tech',
    members: ['CA','CT','DE','MD','MA','MI','NH','NY','PA','UT','VA','WA'],
  },
  {
    id: 'Agriculture',
    members: ['CA','FL','HI','ID','IL','IA','KS','MN','NE','NC','TX','WI'],
  },
  {
    id: 'Manufacturing Base',
    members: ['IL','IN','KY','MI','NC','OH','PA','TX','WI'],
  },
  {
    id: 'Old South',
    members: ['AL','AR','GA','LA','MD','MS','NC','SC','VA'],
  },
  {
    id: 'Swing States',
    members: ['AZ','CO','FL','IA','NH','NM','NC','OH','PA','VA','WI'],
  },
  {
    id: 'Town and Gown',
    members: ['AZ','DC','IA','ME','MA','MN','MO','NE','NH','NY','ND','RI','UT','VT'],
  },
  {
    id: 'Export Driven',
    members: ['LA','CA','TX','FL','NY','WA'],
  },
];

// EV values for states referenced in groups (must stay in sync with statesData.ts).
// Keyed by state ID. Source: 2020-Census apportionment = identical to statesData.ts.
const EV: Record<string, number> = {
  AK:3, AL:9, AR:6, AZ:11, CA:54, CO:10, CT:7, DC:3, DE:3,
  FL:30, GA:16, HI:4, IA:6, ID:4, IL:19, IN:11, KS:6,
  KY:8, LA:8, MA:11, MD:10, ME:4, MI:15, MN:10, MO:10,
  MS:6, MT:4, NC:16, ND:3, NE:5, NH:4, NJ:14, NM:5,
  NV:6, NY:28, OH:17, OK:7, OR:8, PA:19, RI:4, SC:9,
  SD:3, TN:11, TX:40, UT:6, VA:13, VT:3, WA:12, WI:10,
  WV:4, WY:3,
};

export const STATE_GROUPS: StateGroup[] = RAW_STATE_GROUPS.map((g) => {
  const totalEV = g.members.reduce((sum, id) => sum + (EV[id] ?? 0), 0);
  return { ...g, totalEV, bonusPayout: Math.round(totalEV / 2) };
});

// Reverse index: stateId → alphabetically-sorted list of StateGroupIds it belongs to.
export const STATE_GROUPS_BY_STATE: Record<string, string[]> = {};
for (const g of STATE_GROUPS) {
  for (const sid of g.members) {
    if (!STATE_GROUPS_BY_STATE[sid]) STATE_GROUPS_BY_STATE[sid] = [];
    STATE_GROUPS_BY_STATE[sid].push(g.id);
  }
}
for (const sid of Object.keys(STATE_GROUPS_BY_STATE)) {
  STATE_GROUPS_BY_STATE[sid].sort();
}

// ── National Groups ───────────────────────────────────────────────────────────

const RAW_NATIONAL: Array<{ id: string; turnBonus: number }> = [
  { id: 'Gun Lobby',       turnBonus: 50 },
  { id: 'Youth Vote',      turnBonus: 40 },
  { id: 'Big Conservative',turnBonus: 50 },
  { id: 'Environmental',   turnBonus: 40 },
  { id: "Women's Vote",    turnBonus: 60 },
];

export const NATIONAL_GROUPS: NationalGroup[] = RAW_NATIONAL.map((g) => ({
  ...g,
  maxRungs: 10 as const,
  rungCost: g.turnBonus * 0.5,
}));

// Quick lookup by id
export const NATIONAL_GROUP_MAP: Record<string, NationalGroup> =
  Object.fromEntries(NATIONAL_GROUPS.map((g) => [g.id, g]));

export const STATE_GROUP_MAP: Record<string, StateGroup> =
  Object.fromEntries(STATE_GROUPS.map((g) => [g.id, g]));

// ── Rung-tier helpers ─────────────────────────────────────────────────────────

export function maxRungsFor(stateId: string, ev: number): 8 | 12 | 16 {
  if (MEGASTATE_IDS.has(stateId)) return 16;
  if (ev <= 6) return 8;
  return 12;
}

/** Minimum rungs a player needs in a state to contribute EVs toward State Group dominance. */
export function minRungsForDominance(stateId: string, ev: number): 3 | 4 | 5 {
  if (MEGASTATE_IDS.has(stateId)) return 5;
  if (ev <= 6) return 3;
  return 4;
}

export function rungCostFor(
  stateId: string,
  baseCampaignCost: number,
  rungIndex: number, // 1-based index of the rung being purchased
  affinityDiscount: number, // 0–<1
): number {
  const isBoss = BOSS_RUNG_IDS.has(stateId) && rungIndex === maxRungsFor(stateId, 0);
  const multiplier = isBoss ? BOSS_RUNG_MULTIPLIER : 1.0;
  // Round to whole $1k units so discounts (e.g. ×0.85) never leak floating-point
  // dust into wallet/nationalCash balances (the 249999.999999997 bug).
  return Math.round(baseCampaignCost * multiplier * (1 - affinityDiscount));
}

// ── Election probability ──────────────────────────────────────────────────────

export function electionProbability(turn: number, hungColleges: number): number {
  if (turn < ELECTION_START_TURN) return 0;
  if (hungColleges >= 3) return 1;
  if (hungColleges === 2) return 0.5;
  if (hungColleges === 1) return 0.25;
  // 0 prior hung colleges
  if (turn >= 16) return 1; // round-16 exception
  return 0.125;
}
