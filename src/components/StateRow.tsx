/**
 * One row per state. Subscribes ONLY to its own state's support slice, so
 * spending in state X re-renders just that row (+ the candidate bar) — not the
 * other rows. Wrapped in React.memo since its props (the US_State) are static.
 */

import { memo } from 'react';
import { MOCK_CANDIDATES } from '../game/mockData';
import { useGameStore, useStateSupport } from '../game/store';
import type { InterestGroup, US_State } from '../game/types';

/** Fixed amount spent per button click in the prototype. */
const SPEND_AMOUNT = 10;

function StateRowComponent({ state }: { state: US_State }) {
  const support = useStateSupport(state.id);
  // Selecting the action (stable reference) does not cause re-renders.
  const spend = useGameStore((s) => s.spend);

  // Leader within this state, for highlighting.
  const leaderId = MOCK_CANDIDATES.reduce((best, c) =>
    (support[c.id] ?? 0) > (support[best.id] ?? 0) ? c : best,
  ).id;

  return (
    <div className="state-row">
      <div className="state-row__header">
        <span className="state-row__name">{state.name}</span>
        <span className="state-row__ev">{state.electoralVotes} EV</span>
        <span className="state-row__cost">cost ${state.baseCampaignCost}/u</span>
      </div>

      <div className="state-row__candidates">
        {MOCK_CANDIDATES.map((candidate) => {
          const pct = support[candidate.id] ?? 0;
          // Pick the candidate's best affinity group that this state exposes.
          const targetGroup = pickTargetGroup(candidate.affinities, state.interestGroups);
          return (
            <div
              key={candidate.id}
              className={`cand-cell${candidate.id === leaderId ? ' cand-cell--leader' : ''}`}
            >
              <span className="cand-cell__pct">{pct.toFixed(1)}%</span>
              <button
                type="button"
                className="cand-cell__spend"
                onClick={() => spend(candidate.id, state.id, SPEND_AMOUNT, targetGroup)}
              >
                Spend ${SPEND_AMOUNT}
                {targetGroup ? <small> ·{targetGroup}</small> : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Choose the affinity group with the highest bonus that the state exposes. */
function pickTargetGroup(
  affinities: Partial<Record<InterestGroup, number>>,
  available: readonly InterestGroup[],
): InterestGroup | undefined {
  let best: InterestGroup | undefined;
  let bestBonus = 0;
  for (const group of available) {
    const bonus = affinities[group] ?? 0;
    if (bonus > bestBonus) {
      bestBonus = bonus;
      best = group;
    }
  }
  return best;
}

export const StateRow = memo(StateRowComponent);
