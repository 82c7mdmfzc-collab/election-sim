/**
 * Core data structures for the US Election Simulator.
 *
 * Design notes:
 * - `readonly` marks fields that must never mutate after construction. The
 *   only legitimately mutable runtime field is `Candidate.cash`, and even that
 *   is mutated exclusively by the pure engine functions in `engine.ts`.
 * - No `any`. Ids are nominal-ish string aliases so call sites read clearly.
 */

/**
 * Interest groups a candidate can have affinity with and a state can expose.
 *
 * Two dimensions:
 *   Geographic macro-regions — enable region-sweep strategies
 *   Economic interest groups  — enable sector-specific targeting
 *
 * Every string here must appear verbatim in statesData.ts and in any candidate
 * affinities map. TypeScript enforces this at compile time, so a typo anywhere
 * in the dataset produces a build error rather than a silent runtime miss.
 */
export type InterestGroup =
  // ── Geographic macro-regions ────────────────────────────────────────────────
  | 'Rust Belt'   // OH, PA, MI, WI, IL, IN, MO, WV
  | 'Sun Belt'    // FL, TX, AZ, GA, NV, CO, NM, NC (parts)
  | 'Bible Belt'  // AL, AR, GA, KY, LA, MS, NC, SC, TN, OK, TX (parts)
  | 'Farm Belt'   // IA, KS, MN, MO, NE, ND, SD, ID, UT, WY, MT, IN (parts)
  | 'Pacific'     // CA, OR, WA, HI, AK
  | 'New England' // CT, ME, MA, NH, RI, VT
  // ── Economic interest groups ─────────────────────────────────────────────────
  | 'Labor'        // heavy-union states: MI, OH, PA, WI, IN, MN
  | 'Agribusiness' // commodity-crop states: IA, KS, NE, AR, LA, CA (Central Valley)
  | 'High Tech'    // tech clusters: CA, WA, TX (Austin), MA, CO, AZ, OR, VA, NC
  | 'Energy'       // fossil-fuel states: TX, OK, LA, WV, WY, AK, ND, KS, CO
  | 'Manufacturing'// industrial states: MI, OH, PA, IL, TN, SC, AL, GA, IN, NY
  | 'Wall Street'; // finance hubs: NY, CT, NJ, IL (Chicago), MA, MD, DE, DC

/** USPS-style identifiers, kept as string aliases for readability at call sites. */
export type CandidateId = string;
export type StateId = string; // e.g. "PA"

export interface Candidate {
  readonly id: CandidateId;
  readonly name: string;
  /** Spendable balance. Mutated ONLY through the engine's spendFunds. */
  cash: number;
  /**
   * Efficiency multipliers per interest group, expressed as a fraction.
   * e.g. { Labor: 0.10 } means +10% support-per-dollar when targeting Labor.
   */
  readonly affinities: Partial<Record<InterestGroup, number>>;
}

export interface US_State {
  readonly id: StateId;
  readonly name: string;
  readonly electoralVotes: number;
  /**
   * Dollars per "unit" of campaign action. Higher = harder to move support,
   * acting as the divisor in the support-gain formula.
   */
  readonly baseCampaignCost: number;
  /** Interest groups that can be targeted for an affinity bonus in this state. */
  readonly interestGroups: readonly InterestGroup[];
}

/**
 * support[stateId][candidateId] = percentage in [0, 100].
 * Per state, every candidate's percentage sums to ~100 (normalized share).
 */
export type SupportMap = Record<StateId, Record<CandidateId, number>>;

export interface GameState {
  turn: number;
  candidates: Candidate[];
  states: US_State[];
  support: SupportMap;
}

/** Result of a single electoral-vote tally pass. */
export interface ElectoralResult {
  /** Total electoral votes currently projected to each candidate. */
  readonly evByCandidate: Record<CandidateId, number>;
  /** The candidate leading each state (the one who would win its EVs today). */
  readonly stateLeaders: Record<StateId, CandidateId>;
  /** Non-null only when a candidate has reached the win threshold (>= 270). */
  readonly winner: CandidateId | null;
}

/**
 * Outcome of an attempted spend. `ok: false` means validation failed and the
 * returned candidates/support are unchanged copies of the inputs.
 */
export interface SpendResult {
  readonly ok: boolean;
  /** Human-readable reason when ok === false (e.g. "insufficient funds"). */
  readonly reason?: string;
  readonly candidates: Candidate[];
  readonly support: SupportMap;
}
