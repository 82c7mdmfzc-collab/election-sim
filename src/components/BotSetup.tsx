/**
 * BotSetup — the "vs Bot" pre-game screen (single-player).
 *
 * The human picks their candidate (from the roster they own), a difficulty, and
 * 1–3 AI opponents. Bots are auto-assigned distinct candidates (they may use
 * premium characters — a nice preview) and all share the chosen difficulty.
 * Seat 0 is always the human, so progression/rewards track their result.
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
import { ModifierSheet } from './ModifierSheet';
import { Portrait } from './Portrait';
import { PartyBadge } from './PartyBadge';

const DIFFICULTIES: { id: BotDifficulty; label: string; blurb: string }[] = [
  { id: 'easy',   label: 'Easy',   blurb: 'Campaigns at random. A gentle warm-up.' },
  { id: 'medium', label: 'Medium', blurb: 'Plays for value and builds real leads.' },
  { id: 'hard',   label: 'Hard',   blurb: 'Contests coalitions, denies, and secures.' },
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
  const [opponents, setOpponents] = useState(1);
  const [turnTimeLimit, setTurnTimeLimit] = useState<number | null>(null);

  const me = CANDIDATE_MAP[myId];
  const botRoster = useMemo(
    () => CANDIDATES.filter((c) => c.id !== myId).slice(0, opponents),
    [myId, opponents],
  );

  function start() {
    const chosen = [me, ...botRoster];
    const botSeats = Object.fromEntries(botRoster.map((b) => [b.id, difficulty]));
    AudioManager.play('confirm');
    startGame(chosen, turnTimeLimit, botSeats);
  }

  return (
    <div className="setup">
      <div className="setup__header">
        <h1 className="setup__title">Play vs the Machine</h1>

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
          <span>Difficulty:</span>
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
      </div>

      <p className="mp-hint">Choose your candidate:</p>
      <div className="setup__roster">
        {ownedCandidates.map((c) => {
          const chosen = c.id === myId;
          return (
            <button
              key={c.id}
              type="button"
              className={`cand-card${chosen ? ' is-assigned' : ''}`}
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
              <ModifierSheet affinities={c.affinities} payoutModifiers={c.payoutModifiers} compact />
            </button>
          );
        })}
      </div>

      <div className="setup__seats" style={{ marginTop: '0.75rem' }}>
        <span className="setup__seat is-filled">
          Facing: <strong>{botRoster.map((b) => `${b.name} (${difficulty})`).join(', ')}</strong>
        </span>
      </div>

      <div className="setup__foot">
        <button type="button" className="setup__start" onClick={start}>
          Start Game →
        </button>
        <button type="button" className="mp-back" onClick={onBack} style={{ marginTop: '0.5rem' }}>
          ← Back
        </button>
      </div>
    </div>
  );
}
