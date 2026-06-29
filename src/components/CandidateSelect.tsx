/**
 * CandidateSelect — the local pass-and-play SETUP screen (2–4 players).
 *
 * Pick a player count, then assign a candidate to each seat. The picker mirrors
 * the Shop's Recruit tab: a rail of cards; tapping one opens CandidateStatsModal
 * (full bonus/penalty breakdown) with a Choose / Remove / Unlock action.
 */

import { useMemo, useState } from 'react';
import { CANDIDATES, isCandidateAvailable, type CandidateDef } from '../game/candidates';
import { playerColorHex } from '../game/playerColors';
import { useGameStore } from '../game/store';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { CandidateStatsModal } from './CandidateStatsModal';
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
  // Candidate whose "click to see stats" popup is open (null = closed).
  const [statsModalId, setStatsModalId] = useState<string | null>(null);
  const statsCandidate = statsModalId ? CANDIDATES.find((c) => c.id === statsModalId) ?? null : null;

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

  // Build the stats-popup action from the candidate's state (locked / assigned / open seat).
  function renderStatsModal() {
    if (!statsCandidate) return null;
    const close = () => setStatsModalId(null);
    const locked = !isCandidateAvailable(statsCandidate, unlocked);
    const seat = assignedSeat[statsCandidate.id];
    const isAssigned = seat !== undefined;
    const hasOpenSeat = seats.includes(null);

    let actionLabel: string;
    let actionDisabled = false;
    let onAction = close;
    let subtext: string | undefined;
    if (locked) {
      actionLabel = 'Unlock in Shop';
      onAction = () => { AudioManager.play('click'); close(); onOpenShop?.(); };
      subtext = 'Recruit this candidate with Campaign Funds.';
    } else if (isAssigned) {
      actionLabel = `Remove from Player ${seat + 1}`;
      onAction = () => { AudioManager.play('click'); toggleCandidate(statsCandidate.id); close(); };
    } else if (hasOpenSeat) {
      actionLabel = 'Choose';
      onAction = () => { AudioManager.play('confirm'); toggleCandidate(statsCandidate.id); close(); };
    } else {
      actionLabel = 'All seats full';
      actionDisabled = true;
    }

    return (
      <CandidateStatsModal
        candidate={statsCandidate}
        actionLabel={actionLabel}
        actionDisabled={actionDisabled}
        onAction={onAction}
        onClose={close}
        subtext={subtext}
      />
    );
  }

  return (
    <div className="setup native-screen setup--candidate-select">
      <div className="setup__header">
        <h1 className="setup__title">Choose Your Coalition</h1>
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

      <div className="cand-select-body">
        <div className="setup__seats">
          {seats.map((id, i) => (
            <span key={i} className={`setup__seat${id ? ' is-filled' : ''}`}>
              Player {i + 1}: <strong>{id ? CANDIDATES.find((c) => c.id === id)?.name : '—'}</strong>
            </span>
          ))}
        </div>

        <div className="shop__grid shop-rail">
          {CANDIDATES.map((c) => {
            const seat = assignedSeat[c.id];
            const isAssigned = seat !== undefined;
            const locked = !isCandidateAvailable(c, unlocked);
            return (
              <button
                key={c.id}
                type="button"
                className={`shop-card${isAssigned ? ' is-owned' : ''}${locked ? ' is-locked' : ''}`}
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
                  {locked
                    ? <span className="shop-card__price">🔒 Unlock in Shop</span>
                    : isAssigned
                      ? <div className="shop-card__owned">Player {seat + 1}</div>
                      : null}
                  <span className="shop-card__stats-hint">View stats ›</span>
                </div>
              </button>
            );
          })}
        </div>
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

      {renderStatsModal()}
    </div>
  );
}
