/**
 * Top bar: each candidate's live cash and projected electoral votes, plus the
 * 270 win banner. Reads the derived tally once and the cash via narrow
 * selectors, so it updates on any spend but holds no game logic itself.
 */

import { memo } from 'react';
import { WIN_THRESHOLD } from '../game/engine';
import { MOCK_CANDIDATES } from '../game/mockData';
import { useCandidateCash, useElectoralResult } from '../game/store';
import type { Candidate } from '../game/types';

function CandidateCard({
  candidate,
  electoralVotes,
  isLeader,
}: {
  candidate: Candidate;
  electoralVotes: number;
  isLeader: boolean;
}) {
  // Cash via its own selector → only this card re-renders when this cash changes.
  const cash = useCandidateCash(candidate.id);
  return (
    <div className={`candidate-card${isLeader ? ' candidate-card--leader' : ''}`}>
      <div className="candidate-card__name">{candidate.name}</div>
      <div className="candidate-card__stat">
        <span className="candidate-card__ev">{electoralVotes}</span> EV
      </div>
      <div className="candidate-card__cash">${cash.toFixed(0)}</div>
    </div>
  );
}

function CandidateBarComponent() {
  const result = useElectoralResult();

  const leaderId = MOCK_CANDIDATES.reduce((best, c) =>
    result.evByCandidate[c.id] > (result.evByCandidate[best.id] ?? 0) ? c : best,
  ).id;

  return (
    <header className="candidate-bar">
      <div className="candidate-bar__cards">
        {MOCK_CANDIDATES.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            electoralVotes={result.evByCandidate[candidate.id] ?? 0}
            isLeader={candidate.id === leaderId}
          />
        ))}
      </div>
      {result.winner !== null ? (
        <div className="win-banner">
          🏆 {MOCK_CANDIDATES.find((c) => c.id === result.winner)?.name} wins —
          reached {WIN_THRESHOLD} electoral votes!
        </div>
      ) : (
        <div className="candidate-bar__hint">
          First to {WIN_THRESHOLD} electoral votes wins.
        </div>
      )}
    </header>
  );
}

export const CandidateBar = memo(CandidateBarComponent);
