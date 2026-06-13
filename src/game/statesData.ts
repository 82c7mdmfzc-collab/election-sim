/**
 * Production static data layer: all 50 US states + Washington D.C.
 *
 * ─── Electoral Vote apportionment ────────────────────────────────────────────
 * Uses the 2020-Census reapportionment (in effect from 2024 onward).
 * Total must equal exactly 538. A module-level assertion throws at startup if
 * the sum drifts — catching data-entry errors before the user ever sees the UI.
 *
 * ─── baseCampaignCost scaling ────────────────────────────────────────────────
 * Cost ≈ EVs × 0.85, rounded, floor of 3. This means:
 *   • Small states (3 EVs, cost 3): $10 action → ~3.3 % support swing
 *   • Mid states  (15 EVs, cost 13): $10 action → ~0.77 % swing
 *   • Large states (54 EVs, cost 46): $10 action → ~0.22 % swing
 *
 * Crucially, large states are still more *EV-efficient* per dollar — you just
 * need a larger absolute investment to move them. This mirrors real campaign
 * economics and forces genuine strategic trade-offs.
 *
 * ─── Interest group assignment ───────────────────────────────────────────────
 * 1–3 tags per state. Geographic tags describe where the state sits; economic
 * tags describe which industries dominate its voter base. Candidates with
 * matching affinities receive a spending-efficiency bonus in those states.
 *
 * ─── Candidate profiles ──────────────────────────────────────────────────────
 * Two candidates with distinct strategic profiles and starting cash:
 *
 *   D. Avery  — Labor coalition (Rust Belt + unions + factories)
 *               Affinity: Labor +25%, Rust Belt +20%, Manufacturing +15%
 *               Strongholds: MI, OH, PA, WI, IL, IN, MN, MO
 *               Neutral zones: Sun Belt, Bible Belt, Pacific states
 *
 *   R. Chen   — Tech-coastal coalition (Pacific + knowledge economy + finance)
 *               Affinity: High Tech +25%, Pacific +20%, Wall Street +15%
 *               Strongholds: CA, WA, OR, NY, MA, TX (Austin), VA
 *               Neutral zones: Rust Belt, Bible Belt, Farm Belt states
 *
 * States where neither candidate has a native tag bonus form the true
 * "neutral ground" where raw cash superiority decides the outcome:
 *   AR, FL, IA, ID, KS, LA, ME, MS, MT, NE, NM, ND, NV, OK, SD, VT, WY
 */

import type { Candidate, GameState, SupportMap, US_State } from './types';

// ─── 51 State definitions ─────────────────────────────────────────────────────

export const ALL_STATES: readonly US_State[] = [
  // ── Alabama ───────────────────────────────────────────────────────────────
  {
    id: 'AL',
    name: 'Alabama',
    electoralVotes: 9,
    baseCampaignCost: 8,
    interestGroups: ['Bible Belt', 'Manufacturing'],
  },
  // ── Alaska ────────────────────────────────────────────────────────────────
  {
    id: 'AK',
    name: 'Alaska',
    electoralVotes: 3,
    baseCampaignCost: 3,
    interestGroups: ['Pacific', 'Energy'],
  },
  // ── Arizona ───────────────────────────────────────────────────────────────
  {
    id: 'AZ',
    name: 'Arizona',
    electoralVotes: 11,
    baseCampaignCost: 9,
    interestGroups: ['Sun Belt', 'High Tech'],
  },
  // ── Arkansas ──────────────────────────────────────────────────────────────
  {
    id: 'AR',
    name: 'Arkansas',
    electoralVotes: 6,
    baseCampaignCost: 5,
    interestGroups: ['Bible Belt', 'Agribusiness'],
  },
  // ── California ────────────────────────────────────────────────────────────
  // Most expensive state — 54 EVs, sprawling media market.
  // B (High Tech/Pacific) gets 25% efficiency here; still costly to move.
  {
    id: 'CA',
    name: 'California',
    electoralVotes: 54,
    baseCampaignCost: 46,
    interestGroups: ['Pacific', 'High Tech', 'Agribusiness'],
  },
  // ── Colorado ──────────────────────────────────────────────────────────────
  {
    id: 'CO',
    name: 'Colorado',
    electoralVotes: 10,
    baseCampaignCost: 9,
    interestGroups: ['Sun Belt', 'Energy', 'High Tech'],
  },
  // ── Connecticut ───────────────────────────────────────────────────────────
  // Hartford is the US insurance/financial-services capital outside New York.
  {
    id: 'CT',
    name: 'Connecticut',
    electoralVotes: 7,
    baseCampaignCost: 6,
    interestGroups: ['New England', 'Wall Street', 'Manufacturing'],
  },
  // ── Delaware ──────────────────────────────────────────────────────────────
  // More US corporations are incorporated here than any other state.
  {
    id: 'DE',
    name: 'Delaware',
    electoralVotes: 3,
    baseCampaignCost: 3,
    interestGroups: ['Wall Street'],
  },
  // ── Washington D.C. ───────────────────────────────────────────────────────
  // Government/finance/policy nexus; Wall Street represents the establishment.
  {
    id: 'DC',
    name: 'District of Columbia',
    electoralVotes: 3,
    baseCampaignCost: 3,
    interestGroups: ['Wall Street'],
  },
  // ── Florida ───────────────────────────────────────────────────────────────
  // Second-most expensive Sun Belt prize; no native advantage for either candidate.
  {
    id: 'FL',
    name: 'Florida',
    electoralVotes: 30,
    baseCampaignCost: 26,
    interestGroups: ['Sun Belt', 'Agribusiness'],
  },
  // ── Georgia ───────────────────────────────────────────────────────────────
  // Fast-growing Sun Belt + deep religious tradition + expanding manufacturing.
  {
    id: 'GA',
    name: 'Georgia',
    electoralVotes: 16,
    baseCampaignCost: 14,
    interestGroups: ['Sun Belt', 'Bible Belt', 'Manufacturing'],
  },
  // ── Hawaii ────────────────────────────────────────────────────────────────
  {
    id: 'HI',
    name: 'Hawaii',
    electoralVotes: 4,
    baseCampaignCost: 4,
    interestGroups: ['Pacific', 'Agribusiness'],
  },
  // ── Idaho ─────────────────────────────────────────────────────────────────
  {
    id: 'ID',
    name: 'Idaho',
    electoralVotes: 4,
    baseCampaignCost: 4,
    interestGroups: ['Farm Belt', 'Agribusiness'],
  },
  // ── Illinois ──────────────────────────────────────────────────────────────
  // Chicago Board of Trade = Wall Street tier; also heavy industrial base.
  // A gets Rust Belt (20%), B gets Wall Street (15%) — A has edge here.
  {
    id: 'IL',
    name: 'Illinois',
    electoralVotes: 19,
    baseCampaignCost: 16,
    interestGroups: ['Rust Belt', 'Manufacturing', 'Wall Street'],
  },
  // ── Indiana ───────────────────────────────────────────────────────────────
  // Steel, auto parts, Subaru; historically strong steelworker unions.
  {
    id: 'IN',
    name: 'Indiana',
    electoralVotes: 11,
    baseCampaignCost: 9,
    interestGroups: ['Rust Belt', 'Manufacturing', 'Labor'],
  },
  // ── Iowa ──────────────────────────────────────────────────────────────────
  // Corn/soy heartland; no affinity bonus for either candidate — pure cash.
  {
    id: 'IA',
    name: 'Iowa',
    electoralVotes: 6,
    baseCampaignCost: 5,
    interestGroups: ['Farm Belt', 'Agribusiness'],
  },
  // ── Kansas ────────────────────────────────────────────────────────────────
  // "Breadbasket" wheat state; crude oil production in the south.
  {
    id: 'KS',
    name: 'Kansas',
    electoralVotes: 6,
    baseCampaignCost: 5,
    interestGroups: ['Farm Belt', 'Agribusiness', 'Energy'],
  },
  // ── Kentucky ──────────────────────────────────────────────────────────────
  // Coal country + Toyota manufacturing (Georgetown); A gets Manufacturing.
  {
    id: 'KY',
    name: 'Kentucky',
    electoralVotes: 8,
    baseCampaignCost: 7,
    interestGroups: ['Bible Belt', 'Energy', 'Manufacturing'],
  },
  // ── Louisiana ─────────────────────────────────────────────────────────────
  // Offshore Gulf oil/gas, major petrochem corridor; neither candidate has tags.
  {
    id: 'LA',
    name: 'Louisiana',
    electoralVotes: 8,
    baseCampaignCost: 7,
    interestGroups: ['Bible Belt', 'Energy', 'Agribusiness'],
  },
  // ── Maine ─────────────────────────────────────────────────────────────────
  {
    id: 'ME',
    name: 'Maine',
    electoralVotes: 4,
    baseCampaignCost: 4,
    interestGroups: ['New England', 'Agribusiness'],
  },
  // ── Maryland ──────────────────────────────────────────────────────────────
  // NSA / defense contractors + biotech; B gets High Tech (25%).
  {
    id: 'MD',
    name: 'Maryland',
    electoralVotes: 10,
    baseCampaignCost: 9,
    interestGroups: ['Wall Street', 'High Tech'],
  },
  // ── Massachusetts ─────────────────────────────────────────────────────────
  // Route 128 / MIT biotech corridor + Fidelity / State Street finance.
  {
    id: 'MA',
    name: 'Massachusetts',
    electoralVotes: 11,
    baseCampaignCost: 9,
    interestGroups: ['New England', 'High Tech', 'Wall Street'],
  },
  // ── Michigan ──────────────────────────────────────────────────────────────
  // GM, Ford, Stellantis HQs; UAW birthplace — A's three tags all apply.
  // A picks Labor (25% > Rust Belt 20% > Manufacturing 15%) here.
  {
    id: 'MI',
    name: 'Michigan',
    electoralVotes: 15,
    baseCampaignCost: 13,
    interestGroups: ['Rust Belt', 'Manufacturing', 'Labor'],
  },
  // ── Minnesota ─────────────────────────────────────────────────────────────
  // Medical devices, Cargill/General Mills + Iron Range union tradition.
  {
    id: 'MN',
    name: 'Minnesota',
    electoralVotes: 10,
    baseCampaignCost: 9,
    interestGroups: ['Farm Belt', 'Manufacturing', 'Labor'],
  },
  // ── Mississippi ───────────────────────────────────────────────────────────
  {
    id: 'MS',
    name: 'Mississippi',
    electoralVotes: 6,
    baseCampaignCost: 5,
    interestGroups: ['Bible Belt', 'Agribusiness'],
  },
  // ── Missouri ──────────────────────────────────────────────────────────────
  // St. Louis + Kansas City industrial mix; A gets Rust Belt (20%).
  {
    id: 'MO',
    name: 'Missouri',
    electoralVotes: 10,
    baseCampaignCost: 9,
    interestGroups: ['Rust Belt', 'Farm Belt', 'Manufacturing'],
  },
  // ── Montana ───────────────────────────────────────────────────────────────
  {
    id: 'MT',
    name: 'Montana',
    electoralVotes: 4,
    baseCampaignCost: 4,
    interestGroups: ['Farm Belt', 'Energy'],
  },
  // ── Nebraska ──────────────────────────────────────────────────────────────
  // Top cattle + corn state; no candidate bonus — pure spend competition.
  {
    id: 'NE',
    name: 'Nebraska',
    electoralVotes: 5,
    baseCampaignCost: 4,
    interestGroups: ['Farm Belt', 'Agribusiness'],
  },
  // ── Nevada ────────────────────────────────────────────────────────────────
  // Mining (gold, silver, lithium) + geothermal; no candidate tag overlap.
  {
    id: 'NV',
    name: 'Nevada',
    electoralVotes: 6,
    baseCampaignCost: 5,
    interestGroups: ['Sun Belt', 'Energy'],
  },
  // ── New Hampshire ─────────────────────────────────────────────────────────
  {
    id: 'NH',
    name: 'New Hampshire',
    electoralVotes: 4,
    baseCampaignCost: 4,
    interestGroups: ['New England', 'High Tech'],
  },
  // ── New Jersey ────────────────────────────────────────────────────────────
  // NYC orbit finance + pharma (J&J, Merck, Pfizer NJ presence).
  // A gets Manufacturing (15%), B gets Wall Street (15%) — dead even.
  {
    id: 'NJ',
    name: 'New Jersey',
    electoralVotes: 14,
    baseCampaignCost: 12,
    interestGroups: ['Wall Street', 'Manufacturing'],
  },
  // ── New Mexico ────────────────────────────────────────────────────────────
  {
    id: 'NM',
    name: 'New Mexico',
    electoralVotes: 5,
    baseCampaignCost: 4,
    interestGroups: ['Sun Belt', 'Energy'],
  },
  // ── New York ──────────────────────────────────────────────────────────────
  // Global finance capital. B gets High Tech (25%) > Wall Street (15%).
  // A gets Manufacturing (15%) for upstate NY.
  {
    id: 'NY',
    name: 'New York',
    electoralVotes: 28,
    baseCampaignCost: 24,
    interestGroups: ['Wall Street', 'High Tech', 'Manufacturing'],
  },
  // ── North Carolina ────────────────────────────────────────────────────────
  // Research Triangle Park (biotech/pharma) + BMW / Toyota plant growth.
  {
    id: 'NC',
    name: 'North Carolina',
    electoralVotes: 16,
    baseCampaignCost: 14,
    interestGroups: ['Bible Belt', 'Manufacturing', 'High Tech'],
  },
  // ── North Dakota ──────────────────────────────────────────────────────────
  // Bakken Formation oil + wheat/sunflower; no candidate affinity overlap.
  {
    id: 'ND',
    name: 'North Dakota',
    electoralVotes: 3,
    baseCampaignCost: 3,
    interestGroups: ['Farm Belt', 'Energy', 'Agribusiness'],
  },
  // ── Ohio ──────────────────────────────────────────────────────────────────
  // Steel + auto + chemicals; A picks Labor (25%) — one of A's top targets.
  {
    id: 'OH',
    name: 'Ohio',
    electoralVotes: 17,
    baseCampaignCost: 15,
    interestGroups: ['Rust Belt', 'Manufacturing', 'Labor'],
  },
  // ── Oklahoma ──────────────────────────────────────────────────────────────
  // Tulsa "Oil Capital of the World"; neither candidate has tags here.
  {
    id: 'OK',
    name: 'Oklahoma',
    electoralVotes: 7,
    baseCampaignCost: 6,
    interestGroups: ['Bible Belt', 'Energy'],
  },
  // ── Oregon ────────────────────────────────────────────────────────────────
  // Intel Hillsboro fab + Nike HQ; B gets High Tech (25%) over Pacific (20%).
  {
    id: 'OR',
    name: 'Oregon',
    electoralVotes: 8,
    baseCampaignCost: 7,
    interestGroups: ['Pacific', 'High Tech', 'Agribusiness'],
  },
  // ── Pennsylvania ──────────────────────────────────────────────────────────
  // Classic Rust Belt swing state — A's highest-EV native stronghold.
  {
    id: 'PA',
    name: 'Pennsylvania',
    electoralVotes: 19,
    baseCampaignCost: 16,
    interestGroups: ['Rust Belt', 'Manufacturing', 'Labor'],
  },
  // ── Rhode Island ──────────────────────────────────────────────────────────
  {
    id: 'RI',
    name: 'Rhode Island',
    electoralVotes: 4,
    baseCampaignCost: 4,
    interestGroups: ['New England', 'Manufacturing'],
  },
  // ── South Carolina ────────────────────────────────────────────────────────
  // BMW Spartanburg, Boeing North Charleston, Volvo, Michelin US HQ.
  {
    id: 'SC',
    name: 'South Carolina',
    electoralVotes: 9,
    baseCampaignCost: 8,
    interestGroups: ['Bible Belt', 'Manufacturing'],
  },
  // ── South Dakota ──────────────────────────────────────────────────────────
  {
    id: 'SD',
    name: 'South Dakota',
    electoralVotes: 3,
    baseCampaignCost: 3,
    interestGroups: ['Farm Belt', 'Agribusiness'],
  },
  // ── Tennessee ─────────────────────────────────────────────────────────────
  // VW Chattanooga, Nissan Smyrna, GM Spring Hill; TVA nuclear.
  {
    id: 'TN',
    name: 'Tennessee',
    electoralVotes: 11,
    baseCampaignCost: 9,
    interestGroups: ['Bible Belt', 'Manufacturing', 'Energy'],
  },
  // ── Texas ─────────────────────────────────────────────────────────────────
  // Permian Basin oil + Austin/Dallas tech scene = both candidates compete.
  // B picks High Tech (25%), A has no native tags here — contested ground.
  {
    id: 'TX',
    name: 'Texas',
    electoralVotes: 40,
    baseCampaignCost: 34,
    interestGroups: ['Sun Belt', 'Energy', 'High Tech'],
  },
  // ── Utah ──────────────────────────────────────────────────────────────────
  // "Silicon Slopes" (Adobe, Qualtrics, Domo, Overstock) = B bonus.
  {
    id: 'UT',
    name: 'Utah',
    electoralVotes: 6,
    baseCampaignCost: 5,
    interestGroups: ['Farm Belt', 'High Tech'],
  },
  // ── Vermont ───────────────────────────────────────────────────────────────
  {
    id: 'VT',
    name: 'Vermont',
    electoralVotes: 3,
    baseCampaignCost: 3,
    interestGroups: ['New England', 'Agribusiness'],
  },
  // ── Virginia ──────────────────────────────────────────────────────────────
  // Northern Virginia = world's largest data-center cluster (Amazon HQ2).
  // B picks High Tech (25%) > Wall Street (15%) here.
  {
    id: 'VA',
    name: 'Virginia',
    electoralVotes: 13,
    baseCampaignCost: 11,
    interestGroups: ['Wall Street', 'High Tech'],
  },
  // ── Washington ────────────────────────────────────────────────────────────
  // Microsoft + Amazon HQs; B picks High Tech (25%) > Pacific (20%).
  {
    id: 'WA',
    name: 'Washington',
    electoralVotes: 12,
    baseCampaignCost: 10,
    interestGroups: ['Pacific', 'High Tech', 'Agribusiness'],
  },
  // ── West Virginia ─────────────────────────────────────────────────────────
  // Coal heartland; A gets Rust Belt (20%).
  {
    id: 'WV',
    name: 'West Virginia',
    electoralVotes: 4,
    baseCampaignCost: 4,
    interestGroups: ['Rust Belt', 'Energy'],
  },
  // ── Wisconsin ─────────────────────────────────────────────────────────────
  // America's Dairyland + Milwaukee industrial base; A gets Rust Belt (20%).
  {
    id: 'WI',
    name: 'Wisconsin',
    electoralVotes: 10,
    baseCampaignCost: 9,
    interestGroups: ['Rust Belt', 'Agribusiness', 'Manufacturing'],
  },
  // ── Wyoming ───────────────────────────────────────────────────────────────
  // Cheapest state in the union — 3 EVs, easy to move, low strategic value.
  {
    id: 'WY',
    name: 'Wyoming',
    electoralVotes: 3,
    baseCampaignCost: 3,
    interestGroups: ['Farm Belt', 'Energy'],
  },
] as const satisfies US_State[];

// ─── Electoral-vote integrity guard ──────────────────────────────────────────
// This runs at module initialization time in every environment (dev, prod,
// test). A bad data edit causes an immediate loud failure rather than a silent
// wrong game. The `as unknown[]` cast is intentional: we want the check to run
// even if someone widens the array type.
const _evTotal = (ALL_STATES as unknown as { electoralVotes: number }[]).reduce(
  (sum, s) => sum + s.electoralVotes,
  0,
);
if (_evTotal !== 538) {
  throw new Error(
    `[statesData] Electoral vote total is ${_evTotal}, expected 538. ` +
      `Fix the entries in ALL_STATES so they sum correctly.`,
  );
}

// ─── Candidate profiles ───────────────────────────────────────────────────────

export const ALL_CANDIDATES: Candidate[] = [
  // ── Candidate A: Labor coalition ──────────────────────────────────────────
  // Strategic identity: dominate the Rust Belt + manufacturing heartland.
  //
  // Best states (all three tags present):
  //   MI (Rust Belt + Manufacturing + Labor → picks Labor +25%)
  //   OH (Rust Belt + Manufacturing + Labor → picks Labor +25%)
  //   PA (Rust Belt + Manufacturing + Labor → picks Labor +25%)
  //   IN (Rust Belt + Manufacturing + Labor → picks Labor +25%)
  //
  // Good states (one or two tags):
  //   IL (Rust Belt +20%), WI (Rust Belt +20%), MO (Rust Belt +20%), WV (Rust Belt +20%)
  //   MN (Manufacturing +15%), TN (Manufacturing +15%), SC (Manufacturing +15%)
  //   AL (Manufacturing +15%), GA (Manufacturing +15%), NC (Manufacturing +15%)
  //   CT (Manufacturing +15%), NJ (Manufacturing +15%), NY (Manufacturing +15%)
  //   KY (Manufacturing +15%), RI (Manufacturing +15%)
  //
  // Neutral (no bonus — relies on cash):
  //   All Sun Belt, Farm Belt, Bible Belt, Pacific, New England, Energy-only states
  {
    id: 'avery',
    name: 'D. Avery',
    cash: 2000,
    affinities: {
      Labor: 0.25,
      'Rust Belt': 0.20,
      Manufacturing: 0.15,
    },
  },

  // ── Candidate B: Tech-coastal coalition ───────────────────────────────────
  // Strategic identity: sweep the Pacific coast and knowledge-economy hubs.
  // Starts with a $200 cash advantage, offset by A's wider geographic reach
  // across the mid-tier manufacturing belt.
  //
  // Best states (highest tag overlap):
  //   CA (Pacific + High Tech → picks High Tech +25%) — 54 EVs, game-changing
  //   WA (Pacific + High Tech → picks High Tech +25%) — 12 EVs
  //   OR (Pacific + High Tech → picks High Tech +25%) — 8 EVs
  //   MA (New England + High Tech + Wall Street → High Tech +25%) — 11 EVs
  //   CO (Sun Belt + Energy + High Tech → High Tech +25%) — 10 EVs
  //   TX (Sun Belt + Energy + High Tech → High Tech +25%) — 40 EVs, contested
  //   NC (Bible Belt + Manufacturing + High Tech → High Tech +25%) — 16 EVs
  //   AZ (Sun Belt + High Tech → High Tech +25%) — 11 EVs
  //   MD (Wall Street + High Tech → High Tech +25%) — 10 EVs
  //   VA (Wall Street + High Tech → High Tech +25%) — 13 EVs
  //   NH (New England + High Tech → High Tech +25%) — 4 EVs
  //   UT (Farm Belt + High Tech → High Tech +25%) — 6 EVs
  //
  // Good states (Wall Street only):
  //   NY (Wall Street +15% — High Tech also present → actually picks High Tech +25%)
  //   IL (Wall Street +15%)
  //   CT (Wall Street +15%)
  //   NJ (Wall Street +15%)
  //   DE (Wall Street +15%), DC (Wall Street +15%)
  //
  // Good states (Pacific only):
  //   AK (Pacific +20%), HI (Pacific +20%)
  //
  // Neutral (no bonus — relies on cash):
  //   All Rust Belt, Farm Belt, Bible Belt, Energy-only, Agribusiness-only states
  {
    id: 'chen',
    name: 'R. Chen',
    cash: 2200,
    affinities: {
      'High Tech': 0.25,
      Pacific: 0.20,
      'Wall Street': 0.15,
    },
  },
];

// ─── Game-state factory ───────────────────────────────────────────────────────

function buildInitialSupport(
  candidates: Candidate[],
  states: readonly US_State[],
): SupportMap {
  const support: SupportMap = {};
  const evenShare = 100 / candidates.length;
  for (const state of states) {
    support[state.id] = {};
    for (const candidate of candidates) {
      support[state.id][candidate.id] = evenShare;
    }
  }
  return support;
}

/** Returns a fresh game state with all 51 territories and both candidates. */
export function createInitialGameState(): GameState {
  // Defensive copy of candidates so mutations (cash) don't touch the constants.
  const candidates = ALL_CANDIDATES.map((c) => ({ ...c }));
  return {
    turn: 1,
    candidates,
    states: ALL_STATES as unknown as US_State[], // readonly → mutable widening is safe here
    support: buildInitialSupport(candidates, ALL_STATES),
  };
}
