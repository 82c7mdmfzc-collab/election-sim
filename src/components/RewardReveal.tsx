/**
 * RewardReveal — the animated "+N Campaign Funds" payout shown on the victory
 * screen. Reads the breakdown the profile store stashed in applyGameResult and
 * counts the total up for a satisfying reward moment.
 */

import { useEffect, useRef, useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { ACHIEVEMENT_BY_ID } from '../game/achievements';
import { CANDIDATE_MAP } from '../game/candidates';
import { masteryProgressForXp, type CandidateMasteryAward } from '../game/candidateMastery';
import { AudioManager } from '../utils/audioManager';

export function RewardReveal() {
  const lastReward = useProfile((s) => s.lastReward);
  const [shown, setShown] = useState(0);
  const raf = useRef<number | undefined>(undefined);

  const total = lastReward?.total ?? 0;

  useEffect(() => {
    if (!total) return;
    AudioManager.play('confirm');
    const start = performance.now();
    const dur = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setShown(Math.round(eased * total));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [total]);

  if (!lastReward || total === 0) return null;

  const lines: [string, number][] = [
    ['Finished campaign', lastReward.base],
    ['Won the presidency', lastReward.winBonus],
    ['States secured', lastReward.securedBonus],
    ['Coalitions dominated', lastReward.dominanceBonus],
    ['Win streak', lastReward.streakBonus],
    [
      lastReward.dailyStreakDay > 0
        ? `Daily streak day ${lastReward.dailyStreakDay}`
        : 'Daily streak',
      lastReward.dailyStreakBonus,
    ],
  ];

  return (
    <div className="reward-reveal">
      <div className="reward-reveal__amount">+{shown.toLocaleString()}</div>
      <div className="reward-reveal__label">Campaign Funds Earned</div>
      <ul className="reward-reveal__lines">
        {lines.filter(([, v]) => v > 0).map(([label, v]) => (
          <li key={label} className="reward-reveal__line">
            <span>{label}</span>
            <span>+{v}</span>
          </li>
        ))}
      </ul>
      {lastReward.newlyCompletedAchievements.length > 0 && (
        <div className="reward-reveal__achievements">
          {lastReward.newlyCompletedAchievements.map((id) => (
            <span key={id}>
              {ACHIEVEMENT_BY_ID[id]?.title ?? 'Achievement complete'}
            </span>
          ))}
        </div>
      )}
      {lastReward.masteryAward.xpGained > 0 && (
        <MasteryReveal award={lastReward.masteryAward} />
      )}
    </div>
  );
}

/** Animated per-candidate mastery XP bar + level-up celebration. Fills from where
 *  the candidate started this game to its new XP within the current level band. */
function MasteryReveal({ award }: { award: CandidateMasteryAward }) {
  const mastery = useProfile((s) => s.profile.candidateMastery);
  const [fill, setFill] = useState(0);
  const raf = useRef<number | undefined>(undefined);

  const candidate = CANDIDATE_MAP[award.candidateId ?? ''];
  const entry = candidate ? mastery[candidate.id] : undefined;
  const newXp = entry?.xp ?? 0;
  const prog = candidate ? masteryProgressForXp(candidate, newXp) : null;
  // Fill target within the current level band; if this game crossed a level, the
  // start clamps to 0 so the bar reads as a fresh band under the "Level up!" banner.
  const startXp = Math.max(0, newXp - award.xpGained);
  const startPct = candidate && prog
    ? (award.leveledUp ? 0 : masteryProgressForXp(candidate, startXp).pct)
    : 0;
  const targetPct = prog?.pct ?? 0;

  useEffect(() => {
    if (!candidate) return;
    const begin = performance.now();
    const dur = 900;
    const from = startPct;
    const to = award.leveledUp ? 100 : targetPct;
    const tick = (now: number) => {
      const t = Math.min(1, (now - begin) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setFill(from + (to - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [candidate, startPct, targetPct, award.leveledUp]);

  if (!candidate || !prog) return null;

  return (
    <div className={`reward-reveal__mastery${award.leveledUp ? ' is-levelup' : ''}`}>
      <div className="reward-reveal__mastery-top">
        <span>{candidate.name} mastery</span>
        <strong>+{award.xpGained} XP</strong>
      </div>
      <div className="reward-reveal__mastery-bar">
        <div className="reward-reveal__mastery-fill" style={{ width: `${fill}%` }} />
      </div>
      {award.leveledUp ? (
        <div className="reward-reveal__levelup">Level up! Now Level {award.newLevel}</div>
      ) : (
        <div className="reward-reveal__mastery-foot">
          {prog.isMax ? 'Max level' : `Level ${prog.level} · ${prog.xpIntoLevel}/${prog.xpForSpan} XP`}
        </div>
      )}
    </div>
  );
}
