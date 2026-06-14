/**
 * CandidateSelect — the SETUP screen (2–4 players).
 *
 * Pick a player count, then assign a candidate to each seat. Every candidate
 * card surfaces the asymmetric setup (starting cash + ModifierSheet) so players
 * understand the trade-offs before the game begins.
 */

import { useMemo, useState } from 'react';
import { CANDIDATES, PLAYER_COLORS, isCandidateAvailable, type CandidateDef } from '../game/candidates';
import { useGameStore } from '../game/store';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { ModifierSheet } from './ModifierSheet';
import { Portrait } from './Portrait';

const TIME_OPTIONS: { label: string; value: number | null }[] = [
  { label: '60s', value: 60 },
  { label: '90s', value: 90 },
  { label: '2:00', value: 120 },
  { label: 'Unlimited', value: null },
];

interface CandidateSelectProps {
  onBack?: () => void;
  onOpenShop?: () => void;
}

export function CandidateSelect({ onBack, onOpenShop }: CandidateSelectProps) {
  const startGame = useGameStore((s) => s.startGame);
  const unlocked = useProfile((s) => s.profile.unlockedCharacters);
  const [count, setCount] = useState(2);
  // seats[i] = candidateId | null
  const [seats, setSeats] = useState<(string | null)[]>([null, null]);
  const [turnTimeLimit, setTurnTimeLimit] = useState<number | null>(null);

  function setPlayerCount(n: number) {
    setCount(n);
    setSeats((cur) => {
      const next = cur.slice(0, n);
      while (next.length < n) next.push(null);
      return next;
    });
  }

  const assignedSeat = useMemo(() => {
    const map: Record<string, number> = {};
    seats.forEach((id, i) => { if (id) map[id] = i; });
    return map;
  }, [seats]);

  const filled = seats.filter(Boolean).length;

  function toggleCandidate(id: string) {
    setSeats((cur) => {
      const idx = cur.indexOf(id);
      if (idx >= 0) {
        const next = [...cur];
        next[idx] = null;
        return next;
      }
      const empty = cur.indexOf(null);
      if (empty === -1) return cur; // all seats full
      const next = [...cur];
      next[empty] = id;
      return next;
    });
  }

  function start() {
    const chosen = seats
      .map((id) => (id ? CANDIDATES.find((c) => c.id === id) : null))
      .filter((c): c is CandidateDef => !!c);
    if (chosen.length === count) { AudioManager.play('confirm'); startGame(chosen, turnTimeLimit); }
  }

  return (
    <div className="setup">
      <div className="setup__header">
        <h1 className="setup__title">270 — Choose Your Coalition</h1>
        <div className="setup__count">
          <span>Players:</span>
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className={`setup__count-btn${count === n ? ' is-active' : ''}`}
              onClick={() => { AudioManager.play('click'); setPlayerCount(n); }}
            >
              {n}
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
      </div>

      <div className="setup__seats">
        {seats.map((id, i) => (
          <span key={i} className={`setup__seat${id ? ' is-filled' : ''}`}>
            Player {i + 1}: <strong>{id ? CANDIDATES.find((c) => c.id === id)?.name : '—'}</strong>
          </span>
        ))}
      </div>

      <div className="setup__roster">
        {CANDIDATES.map((c) => {
          const seat = assignedSeat[c.id];
          const isAssigned = seat !== undefined;
          const locked = !isCandidateAvailable(c, unlocked);
          return (
            <button
              key={c.id}
              type="button"
              className={`cand-card${isAssigned ? ' is-assigned' : ''}${locked ? ' is-locked' : ''}`}
              style={{ ['--p-color' as string]: PLAYER_COLORS[c.color] }}
              onClick={() => {
                if (locked) { AudioManager.play('click'); onOpenShop?.(); return; }
                toggleCandidate(c.id);
              }}
            >
              <div className="cand-card__top">
                <div className="cand-portrait-wrap">
                  <Portrait
                    className="cand-portrait"
                    src={c.portraitUrl}
                    initials={c.portrait}
                    name={c.name}
                  />
                </div>
                <div className="cand-card__id">
                  <span className="cand-card__name">{c.name}</span>
                  <span className="cand-card__tag">{c.tagline}</span>
                </div>
                {isAssigned && <span className="cand-card__seat">P{seat + 1}</span>}
                {locked && <span className="cand-card__lock">🔒</span>}
              </div>
              <div className="cand-card__cash">${c.startingCash}k starting cash</div>
              <ModifierSheet affinities={c.affinities} payoutModifiers={c.payoutModifiers} compact />
              {locked && <div className="cand-card__unlock-hint">Unlock in Shop →</div>}
            </button>
          );
        })}
      </div>

      <div className="setup__foot">
        <button
          type="button"
          className="setup__start"
          disabled={filled !== count}
          onClick={start}
        >
          {filled === count ? 'Start Campaign →' : `Assign ${count - filled} more`}
        </button>
        {onBack && (
          <button type="button" className="mp-back" onClick={onBack} style={{ marginTop: '0.5rem' }}>
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}
