/**
 * Core data structures for the US Election Simulator.
 *
 * Investment model (replaces the old vote-share/percentage model):
 *   - Each candidate accumulates independent investment per state (dollars, not %)
 *   - States start at 0 investment for everyone
 *   - First to reach baseCampaignCost × 100 secures the state permanently
 *   - At election: secured → guaranteed EVs; contested → highest investor wins; uncontested → 0 EVs
 */

export type InterestGroup =
  | 'Rust Belt'
  | 'Sun Belt'
  | 'Bible Belt'
  | 'Farm Belt'
  | 'Pacific'
  | 'New England'
  | 'Labor'
  | 'Agribusiness'
  | 'High Tech'
  | 'Energy'
  | 'Manufacturing'
  | 'Wall Street';

export type CandidateId = string;
export type StateId = string;

export interface Candidate {
  readonly id: CandidateId;
  readonly name: string;
  cash: number;
  readonly affinities: Partial<Record<InterestGroup, number>>;
}

export interface US_State {
  readonly id: StateId;
  readonly name: string;
  readonly electoralVotes: number;
  /**
   * Scales the base cost of a single rung.
   * Higher = more expensive to campaign in this state.
   */
  readonly baseCampaignCost: number;
  readonly interestGroups: readonly InterestGroup[];
  readonly maxRungs: 5 | 10 | 15;
}

/**
 * investment[stateId][candidateId] = current number of rungs secured.
 * Each candidate's total is independent — spending does NOT reduce rivals.
 */
export type InvestmentMap = Record<StateId, Record<CandidateId, number>>;

export interface GameState {
  turn: number;
  candidates: Candidate[];
  states: US_State[];
  investment: InvestmentMap;
  /** null = contested/unsecured; candidateId = permanently secured by that player. */
  securedBy: Record<StateId, CandidateId | null>;
  /**
   * Order in which candidates FIRST invested in each state.
   * investmentOrder[stateId][0] = the candidate who invested first → wins ties at election.
   */
  investmentOrder: Record<StateId, CandidateId[]>;
}

export interface ElectoralResult {
  /** EVs each candidate is currently projected to win. */
  readonly evByCandidate: Record<CandidateId, number>;
  /**
   * The candidate who wins each state under current rules.
   * null for uncontested states (0 or 1 investors, not secured).
   */
  readonly stateLeaders: Record<StateId, CandidateId | null>;
  /** Non-null when a candidate reaches WIN_THRESHOLD (≥ 270). */
  readonly winner: CandidateId | null;
}

export interface InvestmentResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly candidates: Candidate[];
  readonly investment: InvestmentMap;
  readonly securedBy: Record<StateId, CandidateId | null>;
  readonly investmentOrder: Record<StateId, CandidateId[]>;
}
