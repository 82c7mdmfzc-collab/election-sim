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
  PLAYER_COLORS,
  isCandidateAvailable,
} from '../game/candidates';
import { useGameStore } from '../game/store';
import { useProfile } from '../hooks/useProfile';
import { getDailyStatusRemote } from '../game/profile';
import { AudioManager } from '../utils/audioManager';
import { track } from '../utils/analytics';
import {
  dailyDateKey,
  getDailyChallengeConfig,
  resolveDailyOpponents,
} from '../game/dailyChallenge';
import { getDailyChallengeLocal, type DailyChallengeLocal } from '../utils/localPrefs';
import { Portrait } from './Portrait';
import { PartyBadge } from './PartyBadge';
import { ModifierSheet } from './ModifierSheet';

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
  const userId = useProfile((s) => s.userId);

  const dateKey = useMemo(() => dailyDateKey(), []);
  const config = useMemo(() => getDailyChallengeConfig(dateKey), [dateKey]);
  const local = useMemo(() => getDailyChallengeLocal(), []);
  const [serverStatus, setServerStatus] = useState<DailyChallengeLocal | null>(null);

  // Cross-device: prefer the server-synced status when signed in (falls back to local).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void getDailyStatusRemote().then((s) => { if (!cancelled && s) setServerStatus(s); });
    return () => { cancelled = true; };
  }, [userId]);

  const status = serverStatus ?? local;
  const streak = status.streak;

  const ownedCandidates = useMemo(
    () => CANDIDATES.filter((c) => isCandidateAvailable(c, unlocked)),
    [unlocked],
  );

  const [myId, setMyId] = useState(ownedCandidates[0]?.id ?? CANDIDATES[0].id);
  const me = CANDIDATE_MAP[myId];
  const opponents = useMemo(() => resolveDailyOpponents(dateKey, myId), [dateKey, myId]);

  const playedToday = status.lastPlayedDate === dateKey;
  const wonToday = status.lastWonDate === dateKey;
  const statusText = playedToday
    ? `Today: ${wonToday ? 'Won 🏆' : 'Played'} · ${status.lastEv} EV`
    : 'New challenge — set the bar';

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
              <span className="daily__chip daily__chip--streak">🔥 {streak}-day streak</span>
            )}
            <span className="daily__chip">
              {config.opponentCount} opponent{config.opponentCount === 1 ? '' : 's'}
            </span>
            <span className="daily__chip">{difficultyLabel(config.difficulty)}</span>
            <span className="daily__chip">{timerLabel(config.turnTimeLimit)}</span>
          </div>
          <div className="daily__opponents" aria-label="Today's opponents">
            {opponents.map((o) => (
              <div
                key={o.id}
                className="daily__opponent"
                style={{ ['--p-color' as string]: PLAYER_COLORS[o.color] }}
              >
                <Portrait className="daily__opponent-portrait" src={o.portraitUrl} initials={o.portrait} name={o.name} />
                <span className="daily__opponent-name">{o.name}</span>
              </div>
            ))}
          </div>
          <div className="daily__status">{statusText}</div>
        </div>
      </div>

      <div className="native-select">
        <div className="native-select__spotlight native-only">
          <div className="native-candidate" style={{ ['--p-color' as string]: PLAYER_COLORS[me.color] }}>
            <div className="native-candidate__portrait">
              <Portrait className="cand-portrait" src={me.portraitUrl} initials={me.portrait} name={me.name} />
            </div>
            <div className="native-candidate__body">
              <div className="native-candidate__name">{me.name}</div>
              <div className="native-candidate__tag">{me.tagline}</div>
              <div className="native-candidate__meta">
                <PartyBadge party={me.party} />
                <span>${me.startingCash}k starting cash</span>
              </div>
              <ModifierSheet affinities={me.affinities} payoutModifiers={me.payoutModifiers} compact />
            </div>
          </div>
        </div>

        <p className="mp-hint">Your Candidate</p>
        <div className="setup__roster candidate-rail">
          {ownedCandidates.map((c) => {
            const chosen = c.id === myId;
            return (
              <button
                key={c.id}
                type="button"
                className={`cand-card${chosen ? ' is-assigned is-active' : ''}`}
                style={{ ['--p-color' as string]: PLAYER_COLORS[c.color] }}
                onClick={() => { AudioManager.play('click'); setMyId(c.id); }}
              >
                <div className="cand-card__top">
                  <div className="cand-portrait-wrap">
                    <Portrait className="cand-portrait" src={c.portraitUrl} initials={c.portrait} name={c.name} />
                  </div>
                  <div className="cand-card__id">
                    <span className="cand-card__name">{c.name}</span>
                    <span className="cand-card__tag">{c.tagline}</span>
                    <PartyBadge party={c.party} className="cand-card__party" />
                  </div>
                  {chosen && <span className="cand-card__seat">You</span>}
                </div>
                <div className="cand-card__cash">${c.startingCash}k starting cash</div>
              </button>
            );
          })}
        </div>
        {ownedCandidates.length === 1 && (
          <p className="mp-hint daily__unlock-hint">
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
    </div>
  );
}
