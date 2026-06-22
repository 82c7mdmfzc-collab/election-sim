/**
 * BotSetup — the Solo pre-game screen.
 *
 * The human picks their candidate (from the roster they own), a difficulty, and
 * 1–3 computer opponents. Opponents are auto-assigned distinct candidates and
 * all share the chosen difficulty.
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
import type { CandidateDef } from '../game/candidates';
import { Portrait } from './Portrait';
import { PartyBadge } from './PartyBadge';
import { NextChallengeHint } from './ProgressPanel';

const DIFFICULTIES: { id: BotDifficulty; label: string; blurb: string }[] = [
  { id: 'easy',   label: 'Easy',   blurb: 'Loose, low-pressure decisions.' },
  { id: 'medium', label: 'Medium', blurb: 'Balanced map control and steady pressure.' },
  { id: 'hard',   label: 'Hard',   blurb: 'Sharper denial, coalition pushes, and secure finishes.' },
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

function perkSummary(candidate: CandidateDef): { label: string; tone: 'good' | 'mixed' | 'flat' }[] {
  const cost = Object.values(candidate.affinities);
  const income = Object.values(candidate.payoutModifiers);
  const costUpside = cost.filter((v) => v > 0).length;
  const incomeUpside = income.filter((v) => v > 0).length;
  const tradeoffs = [...cost, ...income].filter((v) => v < 0).length;
  const chips: { label: string; tone: 'good' | 'mixed' | 'flat' }[] = [];

  if (costUpside > 0) chips.push({ label: `${costUpside} cost perk${costUpside === 1 ? '' : 's'}`, tone: 'good' });
  if (incomeUpside > 0) chips.push({ label: `${incomeUpside} income perk${incomeUpside === 1 ? '' : 's'}`, tone: 'good' });
  if (tradeoffs > 0) chips.push({ label: `${tradeoffs} tradeoff${tradeoffs === 1 ? '' : 's'}`, tone: 'mixed' });
  if (chips.length === 0) chips.push({ label: 'Neutral build', tone: 'flat' });

  return chips;
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
        <NextChallengeHint context="solo" />
      </div>

      <div className="native-select">
        <div className="native-select__spotlight native-only">
          <div
            className="native-candidate"
            style={{ ['--p-color' as string]: PLAYER_COLORS[me.color] }}
          >
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
              <div className="cand-card__perks" aria-label={`${me.name} perk summary`}>
                {perkSummary(me).map((chip) => (
                  <span key={chip.label} className={`perk-chip perk-chip--${chip.tone}`}>
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="native-select__summary">
            <div className="native-select__summary-card">
              <p className="native-select__summary-title">Opposition</p>
              <div className="setup__seats">
                <span className="setup__seat is-filled">
                  <strong>{botRoster.map((b) => b.name).join(', ')}</strong>
                </span>
              </div>
            </div>
            <div className="native-select__summary-card">
              <p className="native-select__summary-title">Difficulty</p>
              <p className="mp-hint">{DIFFICULTIES.find((d) => d.id === difficulty)?.blurb}</p>
            </div>
          </div>
        </div>

        <p className="mp-hint">Candidate</p>
        <div className="setup__roster candidate-rail">
          {ownedCandidates.map((c) => {
            const chosen = c.id === myId;
            const chips = perkSummary(c);
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
                <div className="cand-card__perks" aria-label={`${c.name} perk summary`}>
                  {chips.map((chip) => (
                    <span key={chip.label} className={`perk-chip perk-chip--${chip.tone}`}>
                      {chip.label}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <div className="setup__seats" style={{ marginTop: '0.75rem' }}>
          <span className="setup__seat is-filled">
            Opposition: <strong>{botRoster.map((b) => `${b.name} (${difficulty})`).join(', ')}</strong>
          </span>
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
    </div>
  );
}
