/**
 * BotSetup — the Solo pre-game screen.
 *
 * The human picks their candidate (from the roster they own), a difficulty, and
 * 1–3 computer opponents. Opponents are auto-assigned distinct candidates and
 * all share the chosen difficulty.
 * Seat 0 is always the human, so progression/rewards track their result.
 *
 * The candidate picker mirrors the Shop's Recruit tab: a rail of cards; tapping
 * one opens CandidateStatsModal with a "Choose" action.
 */

import { useMemo, useState } from 'react';
import {
  CANDIDATES,
  CANDIDATE_MAP,
  PLAYER_COLORS,
  isCandidateAvailable,
} from '../game/candidates';
import { useGameStore } from '../game/store';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import type { BotDifficulty } from '../game/types';
import { Portrait } from './Portrait';
import { NextChallengeHint } from './ProgressPanel';
import { CandidateStatsModal } from './CandidateStatsModal';

const DIFFICULTIES: { id: BotDifficulty; label: string; blurb: string }[] = [
  { id: 'easy',   label: 'Easy',   blurb: 'Loose, low-pressure decisions.' },
  { id: 'medium', label: 'Medium', blurb: 'Balanced map control and steady pressure.' },
  { id: 'hard',   label: 'Hard',   blurb: 'Sharper denial, coalition pushes, attacks, and secure finishes.' },
  { id: 'impossible', label: 'Impossible', blurb: 'Legal-only expert pressure: ruthless EV denial and perk exploitation.' },
];

const TIME_OPTIONS: { label: string; value: number | null }[] = [
  { label: '60s', value: 60 },
  { label: '90s', value: 90 },
  { label: '2:00', value: 120 },
  { label: 'Unlimited', value: null },
];

interface BotSetupProps {
  onBack: () => void;
}

export function BotSetup({ onBack }: BotSetupProps) {
  const startGame = useGameStore((s) => s.startGame);
  const unlocked = useProfile((s) => s.profile.unlockedCharacters);

  const ownedCandidates = useMemo(
    () => CANDIDATES.filter((c) => isCandidateAvailable(c, unlocked)),
    [unlocked],
  );

  const [myId, setMyId] = useState(ownedCandidates[0]?.id ?? CANDIDATES[0].id);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('medium');
  const [botDifficulties, setBotDifficulties] = useState<Record<string, BotDifficulty>>({});
  const [opponents, setOpponents] = useState(1);
  const [turnTimeLimit, setTurnTimeLimit] = useState<number | null>(null);
  const [statsModalId, setStatsModalId] = useState<string | null>(null);

  const me = CANDIDATE_MAP[myId];
  const statsCandidate = statsModalId ? CANDIDATE_MAP[statsModalId] ?? null : null;
  const botRoster = useMemo(
    () => CANDIDATES.filter((c) => c.id !== myId).slice(0, opponents),
    [myId, opponents],
  );

  function start() {
    const chosen = [me, ...botRoster];
    const botSeats = Object.fromEntries(botRoster.map((b) => [b.id, botDifficulties[b.id] ?? difficulty]));
    AudioManager.play('confirm');
    startGame(chosen, turnTimeLimit, botSeats);
  }

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

  return (
    <div className="setup native-screen setup--bot">
      <div className="setup__header">
        <h1 className="setup__title">Solo Campaign</h1>

        <div className="setup__count">
          <span>Opponents:</span>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className={`setup__count-btn${opponents === n ? ' is-active' : ''}`}
              onClick={() => { AudioManager.play('click'); setOpponents(n); }}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="setup__count">
          <span>Default AI:</span>
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`setup__count-btn${difficulty === d.id ? ' is-active' : ''}`}
              onClick={() => { AudioManager.play('click'); setDifficulty(d.id); }}
              title={d.blurb}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="setup__count setup__timelimit">
          <span>Turn Timer:</span>
          {TIME_OPTIONS.map((o) => (
            <button
              key={o.label}
              type="button"
              className={`setup__count-btn${turnTimeLimit === o.value ? ' is-active' : ''}`}
              onClick={() => { AudioManager.play('click'); setTurnTimeLimit(o.value); }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="setup__sub" style={{ marginTop: '0.5rem' }}>
          {DIFFICULTIES.find((d) => d.id === difficulty)?.blurb}
        </p>
        <NextChallengeHint context="solo" />
      </div>

      <div className="cand-select-body">
        <p className="shop__sub cand-select-body__hint">Tap a candidate to review their bonuses, then choose.</p>
        <div className="shop__grid shop-rail">
          {ownedCandidates.map((c) => {
            const chosen = c.id === myId;
            return (
              <button
                key={c.id}
                type="button"
                className={`shop-card${chosen ? ' is-owned' : ''}`}
                style={{ ['--p-color' as string]: PLAYER_COLORS[c.color] }}
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
                  {chosen && <div className="shop-card__owned">Your pick ✓</div>}
                  <span className="shop-card__stats-hint">View stats ›</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="setup__seats">
          {botRoster.map((b, idx) => {
            const diff = botDifficulties[b.id] ?? difficulty;
            return (
              <span key={b.id} className="setup__seat is-filled" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <span>
                  Bot {idx + 1}: <strong>{b.name}</strong> <em>({diff})</em>
                </span>
                <span className="setup__count" style={{ margin: '0.35rem 0 0', justifyContent: 'flex-start' }}>
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`setup__count-btn${diff === d.id ? ' is-active' : ''}`}
                      onClick={() => {
                        AudioManager.play('click');
                        setBotDifficulties((cur) => ({ ...cur, [b.id]: d.id }));
                      }}
                      title={d.blurb}
                    >
                      {d.label}
                    </button>
                  ))}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="setup__foot">
        <button type="button" className="setup__start" onClick={start}>
          Start Campaign →
        </button>
        <button type="button" className="mp-back" onClick={onBack} style={{ marginTop: '0.5rem' }}>
          ← Back
        </button>
      </div>

      {renderStatsModal()}
    </div>
  );
}
