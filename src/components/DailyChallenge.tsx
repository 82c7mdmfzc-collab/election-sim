/**
 * DailyChallenge — today's fixed-opposition challenge.
 *
 * The UTC-date seed fixes the opposition (opponent count, difficulty, turn timer,
 * and the opponents themselves); the player brings their OWN candidate (from the
 * roster they own). Everyone playing today faces the same matchup, so results
 * (win / EV / speed) are comparable and shareable.
 *
 * Completion + a consecutive-day streak are tracked device-locally (localPrefs)
 * so guests get the loop too; the Funds reward rides the normal game-end path.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  CANDIDATES,
  CANDIDATE_MAP,
  isCandidateAvailable,
} from '../game/candidates';
import { playerColorHex } from '../game/playerColors';
import { useGameStore } from '../game/store';
import { useProfile } from '../hooks/useProfile';
import { getDailyStatusRemote } from '../game/profile';
import { getDailyLeaderboardRemote } from '../game/profile';
import type { DailyLeaderboardResult } from '../game/dailyRankings';
import { AudioManager } from '../utils/audioManager';
import { track } from '../utils/analytics';
import {
  dailyDateKey,
  getDailyChallengeConfig,
  resolveDailyOpponents,
  getDailyRival,
} from '../game/dailyChallenge';
import { normalizeCandidateMasteryEntry } from '../game/candidateMastery';
import { getDailyChallengeLocal, type DailyChallengeLocal } from '../utils/localPrefs';
import { Portrait } from './Portrait';
import { MasteryBadge } from './MasteryMeter';
import { CandidateStatsModal } from './CandidateStatsModal';
import { FlameIcon } from './icons';

interface DailyChallengeProps {
  onBack: () => void;
}

function difficultyLabel(d: 'medium' | 'hard'): string {
  return d === 'hard' ? 'Hard' : 'Medium';
}

function timerLabel(seconds: number | null): string {
  if (seconds == null) return 'No timer';
  return `${seconds}s turns`;
}

export function DailyChallenge({ onBack }: DailyChallengeProps) {
  const startDailyChallenge = useGameStore((s) => s.startDailyChallenge);
  const unlocked = useProfile((s) => s.profile.unlockedCharacters);
  const mastery = useProfile((s) => s.profile.candidateMastery);
  const userId = useProfile((s) => s.userId);

  const dateKey = useMemo(() => dailyDateKey(), []);
  const config = useMemo(() => getDailyChallengeConfig(dateKey), [dateKey]);
  const local = useMemo(() => getDailyChallengeLocal(), []);
  const [serverStatus, setServerStatus] = useState<DailyChallengeLocal | null>(null);
  const [dailyBoard, setDailyBoard] = useState<DailyLeaderboardResult | null>(null);

  // Cross-device: prefer the server-synced status when signed in (falls back to local).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void getDailyStatusRemote().then((s) => { if (!cancelled && s) setServerStatus(s); });
    void getDailyLeaderboardRemote(dateKey, 5).then((b) => { if (!cancelled && b) setDailyBoard(b); });
    return () => { cancelled = true; };
  }, [dateKey, userId]);

  const status = serverStatus ?? local;
  const streak = status.streak;

  // Today's fixed rival is barred from the player's roster (Part 4 rule). It can
  // be any candidate — including ones the player hasn't unlocked.
  const rival = useMemo(() => getDailyRival(dateKey), [dateKey]);
  const ownedCandidates = useMemo(
    () => CANDIDATES.filter((c) => isCandidateAvailable(c, unlocked) && c.id !== rival.id),
    [unlocked, rival.id],
  );

  // ownedCandidates already excludes the rival, so the first pick is always a
  // valid non-rival candidate; `unlocked` only ever grows, so it stays valid.
  const [myId, setMyId] = useState(
    () => ownedCandidates[0]?.id ?? CANDIDATES.find((c) => c.id !== rival.id)!.id,
  );
  const [statsModalId, setStatsModalId] = useState<string | null>(null);
  const statsCandidate = statsModalId ? CANDIDATE_MAP[statsModalId] ?? null : null;
  const me = CANDIDATE_MAP[myId] ?? ownedCandidates[0] ?? CANDIDATES[0];
  const opponents = useMemo(() => resolveDailyOpponents(dateKey, myId), [dateKey, myId]);

  const playedToday = status.lastPlayedDate === dateKey;
  const wonToday = status.lastWonDate === dateKey;
  const statusText = playedToday
    ? `Today: ${wonToday ? 'Won 🏆' : 'Played'} · ${status.lastEv} EV`
    : 'New challenge — set the bar';

  function renderStatsModal() {
    if (!statsCandidate) return null;
    const close = () => setStatsModalId(null);
    const chosen = statsCandidate.id === myId;
    return (
      <CandidateStatsModal
        candidate={statsCandidate}
        actionLabel={chosen ? 'Your pick ✓' : 'Choose'}
        actionDisabled={chosen}
        onAction={() => { AudioManager.play('confirm'); setMyId(statsCandidate.id); close(); }}
        onClose={close}
      />
    );
  }

  function start() {
    AudioManager.play('confirm');
    track('daily_challenge_started', {
      date_key: dateKey,
      candidate_id: myId,
      opponent_count: config.opponentCount,
      bot_difficulty: config.difficulty,
      replayed: playedToday,
    });
    startDailyChallenge(me, dateKey);
  }

  return (
    <div className="setup native-screen setup--daily">
      <div className="setup__header">
        <h1 className="setup__title">Daily Race</h1>
        <p className="setup__sub">
          One map, one bracket, one day. Everyone runs the same opposition — bring your best operation and post your score.
        </p>

        <div className="daily__scenario">
          <div className="daily__chips">
            {streak > 0 && (
              <span className="daily__chip daily__chip--streak"><FlameIcon size={13} /> {streak}-day streak</span>
            )}
            <span className="daily__chip">
              {config.opponentCount} opponent{config.opponentCount === 1 ? '' : 's'}
            </span>
            <span className="daily__chip">{difficultyLabel(config.difficulty)}</span>
            <span className="daily__chip">{timerLabel(config.turnTimeLimit)}</span>
          </div>
          <div className="daily__opponents" aria-label="Today's opponents">
            {opponents.map((o) => {
              const isRival = o.id === rival.id;
              return (
                <div
                  key={o.id}
                  className={`daily__opponent${isRival ? ' daily__opponent--rival' : ''}`}
                  style={{ ['--p-color' as string]: playerColorHex(o.color) }}
                  title={isRival ? `${o.name} — today's rival, 2× positive stats` : o.name}
                >
                  <Portrait className="daily__opponent-portrait" src={o.portraitUrl} initials={o.portrait} name={o.name} />
                  <span className="daily__opponent-name">{o.name}</span>
                  {isRival && <span className="daily__rival-badge">Daily Rival · 2× stats</span>}
                </div>
              );
            })}
          </div>
          <div className="daily__status">{statusText}</div>
          {dailyBoard && dailyBoard.rows.length > 0 && (
            <div className="daily__leaderboard" aria-label="Today's Daily Race leaders">
              <div className="daily__leaderboard-title">Today’s pace</div>
              {dailyBoard.rows.slice(0, 3).map((row) => (
                <div key={`${row.rank}-${row.name}`} className={`daily__leaderboard-row${row.isMe ? ' is-me' : ''}`}>
                  <span>#{row.rank} {row.name}</span>
                  <strong>{row.ev} EV · T{row.turns}</strong>
                </div>
              ))}
              {dailyBoard.me && !dailyBoard.rows.some((row) => row.isMe) && (
                <div className="daily__leaderboard-row is-me">
                  <span>#{dailyBoard.me.rank} You</span>
                  <strong>{dailyBoard.me.ev} EV · T{dailyBoard.me.turns}</strong>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="cand-select-body">
        <p className="shop__sub cand-select-body__hint daily__rival-hint">
          Unavailable: today’s rival <strong>{rival.name}</strong> (2× positive stats). Tap a candidate to review their bonuses, then choose.
        </p>
        <div className="shop__grid shop-rail">
          {ownedCandidates.map((c) => {
            const chosen = c.id === myId;
            return (
              <button
                key={c.id}
                type="button"
                className={`shop-card${chosen ? ' is-owned' : ''}`}
                style={{ ['--p-color' as string]: playerColorHex(c.color) }}
                onClick={() => { AudioManager.play('click'); setStatsModalId(c.id); }}
              >
                <div className="shop-card__top">
                  <Portrait className="shop-card__portrait" src={c.portraitUrl} initials={c.portrait} name={c.name} />
                  <div>
                    <span className="shop-card__name">{c.name}</span>
                    <span className="shop-card__tag">{c.tagline}</span>
                  </div>
                </div>
                <div className="shop-card__foot">
                  <MasteryBadge level={normalizeCandidateMasteryEntry(mastery[c.id], c).level} className="shop-card__level" />
                  {chosen && <div className="shop-card__owned">Your pick ✓</div>}
                  <span className="shop-card__stats-hint">View stats ›</span>
                </div>
              </button>
            );
          })}
        </div>
        {ownedCandidates.length === 1 && (
          <p className="shop__sub daily__unlock-hint">
            Unlock more candidates in the Shop to bring different strengths to the daily.
          </p>
        )}
      </div>

      <div className="setup__foot">
        <button type="button" className="setup__start" onClick={start}>
          {playedToday ? 'Play Again →' : 'Start Challenge →'}
        </button>
        <button type="button" className="mp-back" onClick={onBack} style={{ marginTop: '0.5rem' }}>
          ← Back
        </button>
      </div>

      {renderStatsModal()}
    </div>
  );
}
