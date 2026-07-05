/**
 * MasteryMeter — legible Candidate Mastery UI.
 *
 *   MasteryBadge — a compact "Lv N" pill with star pips for roster cards.
 *   MasteryPanel — level, an XP bar toward the next level, and a preview of exactly
 *                  which stats improve at the next level (diffing candidateAtLevel).
 *
 * All data already exists in the profile store; this just makes the per-candidate
 * level 1–5 progression visible so training (the Shop Funds sink) has meaning.
 */

import { type CandidateDef } from '../game/candidates';
import {
  masteryProgress,
  masteryLevelUpPreview,
  normalizeCandidateMasteryEntry,
  type CandidateLevel,
} from '../game/candidateMastery';
import { useProfile } from '../hooks/useProfile';

function pctLabel(v: number): string {
  return `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
}

export function MasteryBadge({ level, className }: { level: CandidateLevel; className?: string }) {
  return (
    <span className={`mastery-badge${className ? ` ${className}` : ''}`} title={`Mastery level ${level}`}>
      <span className="mastery-badge__lv">Lv {level}</span>
      <span className="mastery-badge__pips" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`mastery-badge__pip${n <= level ? ' is-on' : ''}`} />
        ))}
      </span>
    </span>
  );
}

/** Full mastery readout for the stats modal: level, XP bar, next-level benefits. */
export function MasteryPanel({ candidate }: { candidate: CandidateDef }) {
  const mastery = useProfile((s) => s.profile.candidateMastery);
  const entry = normalizeCandidateMasteryEntry(mastery[candidate.id], candidate);
  const prog = masteryProgress(candidate, mastery);
  const benefits = masteryLevelUpPreview(candidate, entry.level);

  return (
    <div className="mastery-panel">
      <div className="mastery-panel__head">
        <MasteryBadge level={entry.level} />
        <span className="mastery-panel__xp">
          {prog.isMax ? 'Max level' : `${prog.xpIntoLevel} / ${prog.xpForSpan} XP`}
        </span>
      </div>
      <div className="mastery-panel__bar" role="progressbar" aria-valuenow={prog.pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="mastery-panel__fill" style={{ width: `${prog.pct}%` }} />
      </div>
      {benefits ? (
        <div className="mastery-panel__next">
          <div className="mastery-panel__next-title">At Level {benefits.toLevel}</div>
          <ul className="mastery-panel__benefits">
            {benefits.cashDelta > 0 && (
              <li><span>Starting cash</span><span className="is-up">+${benefits.cashDelta}k</span></li>
            )}
            {benefits.changes.map((c) => (
              <li key={`${c.kind}:${c.key}`}>
                <span>{c.key} {c.kind === 'cost' ? 'cost' : 'payout'}</span>
                <span className="is-up">{pctLabel(c.from)} → {pctLabel(c.to)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mastery-panel__maxed">
          {prog.isMax ? 'Mastery complete — fully trained.' : 'This candidate’s kit stays constant across levels.'}
        </div>
      )}
    </div>
  );
}
