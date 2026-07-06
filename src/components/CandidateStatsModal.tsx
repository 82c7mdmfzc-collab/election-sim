/**
 * CandidateStatsModal — "click to see stats" popup for a single candidate.
 *
 * Replaces the cramped inline ModifierSheet on the candidate cards (setup screen +
 * Shop recruit grid). Shows the full Bonus / Penalty breakdown with room to breathe
 * and a single caller-supplied primary action ("Choose", "Unlock in Shop", etc.),
 * mirroring the competitor's tap-to-review flow.
 *
 * Reuses the .profile-overlay / .profile-modal shell from PlayerProfileModal.
 */

import { useState } from 'react';
import { type CandidateDef } from '../game/candidates';
import { candidateAtMastery, normalizeCandidateMasteryEntry } from '../game/candidateMastery';
import { useProfile } from '../hooks/useProfile';
import { playerColorHex } from '../game/playerColors';
import { ModifierSheet } from './ModifierSheet';
import { MasteryPanel, MasteryBadge } from './MasteryMeter';
import { PartyBadge } from './PartyBadge';
import { Portrait } from './Portrait';
import { ChevronDownIcon } from './icons';

interface Props {
  candidate: CandidateDef;
  /** Label for the single primary action button. */
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: () => void;
  onClose: () => void;
  /** Optional line under the CTA, e.g. Shop affordability ("Need 1,200 more"). */
  subtext?: string;
  secondaryActionLabel?: string;
  secondaryActionDisabled?: boolean;
  onSecondaryAction?: () => void;
  secondarySubtext?: string;
}

export function CandidateStatsModal({
  candidate,
  actionLabel,
  actionDisabled,
  onAction,
  onClose,
  subtext,
  secondaryActionLabel,
  secondaryActionDisabled,
  onSecondaryAction,
  secondarySubtext,
}: Props) {
  const mastery = useProfile((s) => s.profile.candidateMastery);
  const leveledCandidate = candidateAtMastery(candidate, mastery);
  const level = normalizeCandidateMasteryEntry(mastery[candidate.id], candidate).level;
  // Level/XP progression is secondary to the gameplay stats — collapsed by default.
  const [showLevel, setShowLevel] = useState(false);

  return (
    <div
      className="profile-overlay cand-stats-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${candidate.name} stats`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="profile-modal cand-stats-modal"
        style={{ ['--p-color' as string]: playerColorHex(candidate.color) }}
      >
        <div className="profile-modal__head">
          <div className="profile-modal__portrait">
            <Portrait
              className="cand-portrait"
              src={candidate.portraitUrl}
              initials={candidate.portrait}
              name={candidate.name}
            />
          </div>
          <div className="profile-modal__info">
            <div className="profile-modal__name">{candidate.name}</div>
            {candidate.tagline && <div className="profile-modal__tagline">{candidate.tagline}</div>}
            <div className="cand-stats-modal__meta">
              <PartyBadge party={candidate.party} />
              <span>Level {level}</span>
              <span>${leveledCandidate.startingCash}k starting cash</span>
            </div>
          </div>
          <button
            type="button"
            className="profile-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="profile-modal__section">
          <ModifierSheet
            affinities={leveledCandidate.affinities}
            payoutModifiers={leveledCandidate.payoutModifiers}
            layout="columns"
          />
        </div>

        <div className="profile-modal__section cand-stats-modal__level">
          <button
            type="button"
            className="cand-stats-modal__level-toggle"
            onClick={() => setShowLevel((v) => !v)}
            aria-expanded={showLevel}
          >
            <span className="cand-stats-modal__level-toggle-label">Level progress</span>
            <MasteryBadge level={level} />
            <span className={`cand-stats-modal__level-chevron${showLevel ? ' is-open' : ''}`} aria-hidden>
              <ChevronDownIcon size={16} />
            </span>
          </button>
          {showLevel && <MasteryPanel candidate={candidate} />}
        </div>

        <button
          type="button"
          className="btn-cta btn-cta--block cand-stats-modal__cta"
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </button>
        {subtext && <div className="cand-stats-modal__subtext">{subtext}</div>}
        {secondaryActionLabel && onSecondaryAction && (
          <>
            <button
              type="button"
              className="cand-stats-modal__secondary"
              disabled={secondaryActionDisabled}
              onClick={onSecondaryAction}
            >
              {secondaryActionLabel}
            </button>
            {secondarySubtext && <div className="cand-stats-modal__subtext">{secondarySubtext}</div>}
          </>
        )}
      </div>
    </div>
  );
}
