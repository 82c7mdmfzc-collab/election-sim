import { useState } from 'react';
import {
  ACHIEVEMENT_TREES,
  ACHIEVEMENTS,
  achievementPct,
  achievementValue,
  claimableAchievements,
  nextAchievement,
  streakRewardForDay,
} from '../game/achievements';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { track } from '../utils/analytics';

interface ProgressPanelProps {
  compact?: boolean;
  showAll?: boolean;
  /** When provided, the Daily Race strip shows a "Play today's race" CTA. */
  onDailyStart?: () => void;
}

export function DailyStreakStrip({ compact = false, onStart }: { compact?: boolean; onStart?: () => void }) {
  const streak = useProfile((s) => s.profile.dailyStreak);
  const count = Math.min(streak.count, 14);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const completedToday = streak.lastDate === today;
  const nextDay = completedToday ? Math.min(streak.count + 1, 14) : Math.min((streak.count || 0) + 1, 14);
  const nextReward = streakRewardForDay(nextDay);
  const todayReward = streakRewardForDay(Math.max(1, Math.min(streak.count, 14)));
  // Hours until the streak window rolls over (next UTC midnight, matching `today`).
  const hoursToReset = Math.max(
    1,
    Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 3_600_000),
  );

  return (
    <div className={`streak-strip${compact ? ' streak-strip--compact' : ''}`}>
      <div className="streak-strip__head">
        <span className="streak-strip__title">Daily Race</span>
        <strong>{completedToday ? `🔥 Day ${Math.max(streak.count, 1)}` : `Next +${nextReward}`}</strong>
      </div>
      <p className="streak-strip__blurb">
        {completedToday
          ? `Today's race is done — +${todayReward} banked. Come back in ~${hoursToReset}h to keep the streak alive.`
          : `Finish one game today to extend your streak and bank +${nextReward} Campaign Funds.`}
      </p>
      <div className="streak-strip__days" aria-label={`${streak.count} day completion streak`}>
        {Array.from({ length: 14 }, (_, i) => {
          const day = i + 1;
          return (
            <span
              key={day}
              className={[
                'streak-strip__day',
                day <= count ? 'is-filled' : '',
                day === 14 ? 'is-cap' : '',
              ].filter(Boolean).join(' ')}
              title={`Day ${day}: +${streakRewardForDay(day)} Campaign Funds`}
            >
              {day}
            </span>
          );
        })}
      </div>
      {onStart && !completedToday && (
        <button
          type="button"
          className="streak-strip__cta"
          onClick={() => { AudioManager.play('click'); onStart(); }}
        >
          Play today's race &rarr;
        </button>
      )}
    </div>
  );
}

export function ProgressPanel({ compact = false, showAll = true, onDailyStart }: ProgressPanelProps) {
  const profile = useProfile((s) => s.profile);
  const claimAchievement = useProfile((s) => s.claimAchievement);
  const [busy, setBusy] = useState<string | null>(null);
  const counters = profile.achievementCounters;
  const claimed = new Set(profile.claimedAchievements);
  const claimable = claimableAchievements(counters, profile.claimedAchievements);

  async function claim(id: string) {
    const achievement = ACHIEVEMENTS.find((a) => a.id === id);
    setBusy(id);
    AudioManager.play('click');
    const ok = await claimAchievement(id);
    if (ok) {
      AudioManager.play('confirm');
      track('achievement_claimed', {
        achievement_id: id,
        achievement_tree: achievement?.tree ?? 'unknown',
        reward_amount: achievement?.reward ?? 0,
      });
      if ((achievement?.reward ?? 0) > 0) {
        track('funds_earned', {
          amount: achievement?.reward ?? 0,
          source: 'achievement',
        });
      }
    }
    setBusy(null);
  }

  const visibleTrees = compact ? ACHIEVEMENT_TREES.slice(0, 2) : ACHIEVEMENT_TREES;

  return (
    <div className={`progress-panel${compact ? ' progress-panel--compact' : ''}`}>
      <DailyStreakStrip compact={compact} onStart={onDailyStart} />

      {claimable.length > 0 && (
        <div className="achievement-claim-row">
          {claimable.slice(0, compact ? 2 : 4).map((a) => (
            <button
              key={a.id}
              type="button"
              className="achievement-claim"
              disabled={busy === a.id}
              onClick={() => claim(a.id)}
            >
              <span>{a.title}</span>
              <strong>+{a.reward}</strong>
            </button>
          ))}
        </div>
      )}

      {showAll && visibleTrees.map((tree) => {
        const items = ACHIEVEMENTS.filter((a) => a.tree === tree);
        return (
          <div key={tree} className="achievement-tree">
            <div className="achievement-tree__title">{tree}</div>
            <div className="achievement-list">
              {items.map((a) => {
                const pct = achievementPct(a, counters);
                const value = achievementValue(a, counters);
                const done = pct >= 100;
                const isClaimed = claimed.has(a.id);
                const canClaim = done && !isClaimed;
                return (
                  <div key={a.id} className={`achievement-row${done ? ' is-done' : ''}${isClaimed ? ' is-claimed' : ''}`}>
                    <div className="achievement-row__main">
                      <div className="achievement-row__top">
                        <span>{a.title}</span>
                        <strong>{isClaimed ? 'Claimed' : `+${a.reward}`}</strong>
                      </div>
                      <div className="achievement-row__desc">{a.description}</div>
                      <div className="achievement-row__bar">
                        <span style={{ width: `${pct}%` }} />
                      </div>
                      <div className="achievement-row__progress">
                        {Math.min(value, a.target).toLocaleString()} / {a.target.toLocaleString()}
                      </div>
                    </div>
                    {canClaim && (
                      <button
                        type="button"
                        className="achievement-row__claim"
                        disabled={busy === a.id}
                        onClick={() => claim(a.id)}
                      >
                        Claim
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NextChallengeHint({ context = 'general' }: { context?: 'general' | 'solo' | 'victory' }) {
  const profile = useProfile((s) => s.profile);
  const counters = profile.achievementCounters;
  const claimable = claimableAchievements(counters, profile.claimedAchievements)[0];
  const next = claimable ?? nextAchievement(counters, profile.claimedAchievements);
  if (!next) return null;

  const value = achievementValue(next, counters);

  return (
    <div className={`next-challenge next-challenge--${context}`}>
      <span>{claimable ? 'Ready to claim' : 'Next challenge'}</span>
      <strong>{next.title}</strong>
      <em>{next.description} {claimable ? `+${next.reward} Campaign Funds waiting.` : `${Math.min(value, next.target)} / ${next.target}.`}</em>
    </div>
  );
}
