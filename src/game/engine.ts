/**
 * Pure game-engine math.
 *
 * Every function here is pure: it takes state in and returns new values with no
 * side effects, no React, no DOM, no I/O. This is what lets the heavy game loop
 * (mutating support across many states) run independently of rendering, and it
 * is the ONLY place balances and percentages are allowed to change.
 *
 * Inputs are validated and outputs are clamped so a tampered call from the
 * console cannot push the game into an impossible state through this path.
 */

import type {
  Candidate,
  CandidateId,
  ElectoralResult,
  GameState,
  InterestGroup,
  SpendResult,
  StateId,
  SupportMap,
  US_State,
} from './types';

/** Total electoral votes in the (real) college; states should sum to this. */
export const TOTAL_ELECTORAL_VOTES = 538;
/** Electoral votes required to win. */
export const WIN_THRESHOLD = 270;
/** Maximum support-percentage swing a single spend action may produce. */
export const SUPPORT_CAP = 5;

/** Clamp a number into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Deep-copy the per-state support record. We only ever copy the maps we touch,
 * but copying the whole structure keeps the function referentially honest
 * (callers get a fresh object they can commit immutably).
 */
function cloneSupport(support: SupportMap): SupportMap {
  const next: SupportMap = {};
  for (const stateId of Object.keys(support)) {
    next[stateId] = { ...support[stateId] };
  }
  return next;
}

/**
 * Attempt to spend `amount` on `candidateId` in `stateId`, optionally targeting
 * an interest `group` for an affinity bonus.
 *
 * Support-gain formula (the requested model):
 *   affinityBonus  = group ? (candidate.affinities[group] ?? 0) : 0   // e.g. 0.10
 *   effectiveSpend = amount * (1 + affinityBonus)
 *   rawGain        = effectiveSpend / state.baseCampaignCost          // cost as divisor
 *   gain           = min(rawGain, SUPPORT_CAP)                        // clamp the swing
 *
 * The gain is added to the candidate's share in that state, then the other
 * candidates are scaled down proportionally so the state still sums to 100.
 *
 * Returns ok:false (with unchanged copies) on any validation failure rather
 * than throwing, so the UI never has to wrap calls in try/catch.
 */
export function spendFunds(
  state: GameState,
  candidateId: CandidateId,
  stateId: StateId,
  amount: number,
  group?: InterestGroup,
): SpendResult {
  const candidates = state.candidates;
  const candidate = candidates.find((c) => c.id === candidateId);
  const usState = state.states.find((s) => s.id === stateId);

  // --- Validation (centralized; the console cannot bypass these checks) ---
  if (!candidate) {
    return { ok: false, reason: 'unknown candidate', candidates, support: state.support };
  }
  if (!usState) {
    return { ok: false, reason: 'unknown state', candidates, support: state.support };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'amount must be positive', candidates, support: state.support };
  }
  if (candidate.cash < amount) {
    return { ok: false, reason: 'insufficient funds', candidates, support: state.support };
  }
  // Only allow an affinity bonus for a group the state actually exposes.
  const groupIsTargetable = group !== undefined && usState.interestGroups.includes(group);

  // --- Effectiveness formula ---
  const affinityBonus = groupIsTargetable ? candidate.affinities[group] ?? 0 : 0;
  const effectiveSpend = amount * (1 + affinityBonus);
  const rawGain = effectiveSpend / usState.baseCampaignCost;
  const gain = Math.min(rawGain, SUPPORT_CAP);

  // --- Apply as a normalized share within the state ---
  const stateSupport = { ...state.support[stateId] };
  const current = stateSupport[candidateId] ?? 0;
  const desired = clamp(current + gain, 0, 100);
  const actualGain = desired - current; // may be < gain if we hit the 100 ceiling

  // Pull the gained share proportionally from the rivals' existing support.
  const rivals = candidates.filter((c) => c.id !== candidateId);
  const rivalTotal = rivals.reduce((sum, r) => sum + (stateSupport[r.id] ?? 0), 0);

  if (rivalTotal > 0 && actualGain > 0) {
    for (const rival of rivals) {
      const rivalShare = stateSupport[rival.id] ?? 0;
      const reduction = actualGain * (rivalShare / rivalTotal);
      stateSupport[rival.id] = clamp(rivalShare - reduction, 0, 100);
    }
  }
  stateSupport[candidateId] = desired;

  // --- Commit: fresh copies so the store can replace state immutably ---
  const nextSupport = cloneSupport(state.support);
  nextSupport[stateId] = stateSupport;

  const nextCandidates: Candidate[] = candidates.map((c) =>
    c.id === candidateId ? { ...c, cash: c.cash - amount } : c,
  );

  return { ok: true, candidates: nextCandidates, support: nextSupport };
}

/**
 * Evaluate every state, award its electoral votes to the current leader, and
 * report whether anyone has reached the win threshold. Pure read — used both
 * for the live EV projection and the win check.
 *
 * Ties (equal top support) are awarded deterministically to the first
 * candidate in declaration order, so the projection never flickers.
 */
export function tallyElectoralVotes(state: GameState): ElectoralResult {
  const evByCandidate: Record<CandidateId, number> = {};
  const stateLeaders: Record<StateId, CandidateId> = {};

  for (const candidate of state.candidates) {
    evByCandidate[candidate.id] = 0;
  }

  for (const usState of state.states) {
    const leaderId = findStateLeader(usState, state.candidates, state.support);
    if (leaderId === null) continue; // no support data for this state yet
    stateLeaders[usState.id] = leaderId;
    evByCandidate[leaderId] += usState.electoralVotes;
  }

  let winner: CandidateId | null = null;
  for (const candidate of state.candidates) {
    if (evByCandidate[candidate.id] >= WIN_THRESHOLD) {
      winner = candidate.id;
      break;
    }
  }

  return { evByCandidate, stateLeaders, winner };
}

/** Returns the leading candidate's id in a state, or null if no data exists. */
function findStateLeader(
  usState: US_State,
  candidates: Candidate[],
  support: SupportMap,
): CandidateId | null {
  const stateSupport = support[usState.id];
  if (!stateSupport) return null;

  let leaderId: CandidateId | null = null;
  let best = -Infinity;
  // Iterate candidates (not support keys) for deterministic tie-breaking.
  for (const candidate of candidates) {
    const value = stateSupport[candidate.id] ?? 0;
    if (value > best) {
      best = value;
      leaderId = candidate.id;
    }
  }
  return leaderId;
}
