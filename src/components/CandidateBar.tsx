/**
 * Sticky header: live EV projection, cash, secured EVs, active-player indicator.
 *
 * 270+ during play is an indicator only — NOT a win. The win banner is gone;
 * game over only happens after an election is called and resolved.
 */

import { memo } from 'react';
import { WIN_THRESHOLD } from '../game/engine';
import { ALL_CANDIDATES } from '../game/statesData';
import {
  ELECTION_START_TURN,
  useCandidateCash,
  useElectoralResult,
  useGameStore,
  useSecuredEVs,
} from '../game/store';
import type { Candidate } from '../game/types';

function CandidateCard({
  candidate,
  electoralVotes,
  securedEVs,
  isActive,
  isEliminated,
}: {
  candidate: Candidate;
  electoralVotes: number;
  securedEVs: number;
  isActive: boolean;
  isEliminated: boolean;
}) {
  const cash = useCandidateCash(candidate.id);
  const projected270 = electoralVotes >= WIN_THRESHOLD;

  return (
    <div
      className={[
        'candidate-card',
        isActive ? 'candidate-card--active' : '',
        isEliminated ? 'candidate-card--eliminated' : '',
        projected270 ? 'candidate-card--over270' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isActive && !isEliminated && (
        <div className="candidate-card__active-badge">YOUR TURN</div>
      )}
      {isEliminated && <div className="candidate-card__elim-badge">ELIMINATED</div>}
      <div className="candidate-card__name">{candidate.name}</div>
      <div className="candidate-card__stat">
        <span className="candidate-card__ev">{electoralVotes}</span> EV projected
        {projected270 && <span className="candidate-card__270"> 270+</span>}
      </div>
      {securedEVs > 0 && (
        <div className="candidate-card__secured">🔒 {securedEVs} EV secured</div>
      )}
      {!isEliminated && (
        <div className="candidate-card__cash">${cash.toFixed(0)}</div>
      )}
    </div>
  );
}

function P1SecuredEVs() {
  return <>{useSecuredEVs(ALL_CANDIDATES[0].id)}</>;
}
function P2SecuredEVs() {
  return <>{useSecuredEVs(ALL_CANDIDATES[1].id)}</>;
}

function CandidateCardWrapper({ candidate, electoralVotes, isActive, isEliminated }: {
  candidate: Candidate;
  electoralVotes: number;
  isActive: boolean;
  isEliminated: boolean;
}) {
  const securedEVs = useSecuredEVs(candidate.id);
  return (
    <CandidateCard
      candidate={candidate}
      electoralVotes={electoralVotes}
      securedEVs={securedEVs}
      isActive={isActive}
      isEliminated={isEliminated}
    />
  );
}

// suppress unused import warning — hooks are used via memo'd components above
void P1SecuredEVs;
void P2SecuredEVs;

function CandidateBarComponent() {
  const result = useElectoralResult();
  const phase = useGameStore((s) => s.phase);
  const activePlayerId = useGameStore((s) => s.activePlayerId);
  const turn = useGameStore((s) => s.turn);
  const eliminatedCandidates = useGameStore((s) => s.eliminatedCandidates);

  const phaseLabel =
    phase === 'P1_TURN'
      ? `${ALL_CANDIDATES[0].name}'s turn`
      : phase === 'P2_TURN'
        ? `${ALL_CANDIDATES[1].name}'s turn`
        : phase === 'ELECTION'
          ? 'Election called!'
          : phase === 'GAME_OVER'
            ? 'Game over'
            : 'Resolving…';

  return (
    <header className="candidate-bar">
      <div className="candidate-bar__phase">
        Turn {turn} · {phaseLabel}
      </div>
      <div className="candidate-bar__cards">
        {ALL_CANDIDATES.map((candidate) => (
          <CandidateCardWrapper
            key={candidate.id}
            candidate={candidate}
            electoralVotes={result.evByCandidate[candidate.id] ?? 0}
            isActive={phase !== 'RESOLUTION' && phase !== 'ELECTION' && candidate.id === activePlayerId}
            isEliminated={eliminatedCandidates.includes(candidate.id)}
          />
        ))}
      </div>
      <div className="candidate-bar__hint">
        {turn < ELECTION_START_TURN
          ? `Election possible from turn ${ELECTION_START_TURN} · 270 is a projection, not a win`
          : '12.5% chance of election each turn · 270 projected is not a win'}
      </div>
    </header>
  );
}

export const CandidateBar = memo(CandidateBarComponent);
