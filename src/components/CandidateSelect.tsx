/**
 * CandidateSelect — the SETUP screen (2–4 players).
 *
 * Pick a player count, then assign a candidate to each seat. Every candidate
 * card surfaces the asymmetric setup (starting cash + ModifierSheet) so players
 * understand the trade-offs before the game begins.
 */

import { useMemo, useState } from 'react';
import { CANDIDATES, PLAYER_COLORS, isCandidateAvailable, type CandidateDef } from '../game/candidates';
import { LockIcon } from './icons';
import { PartyBadge } from './PartyBadge';
import { useGameStore } from '../game/store';
import { useProfile } from '../hooks/useProfile';
import { AudioManager } from '../utils/audioManager';
import { ModifierSheet } from './ModifierSheet';
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
  const [activeCandidateId, setActiveCandidateId] = useState(CANDIDATES[0].id);
  const activeCandidate = CANDIDATES.find((c) => c.id === activeCandidateId) ?? CANDIDATES[0];
  // Candidate whose "click to see stats" popup is open (null = closed).
  const [statsModalId, setStatsModalId] = useState<string | null>(null);
  const statsCandidate = statsModalId ? CANDIDATES.find((c) => c.id === statsModalId) ?? null : null;

  function toggleCandidate(id: string) {
    setActiveCandidateId(id);
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

      <div className="native-select">
        <div className="native-select__spotlight native-only">
          <div
            className="native-candidate"
            style={{ ['--p-color' as string]: PLAYER_COLORS[activeCandidate.color] }}
          >
            <div className="native-candidate__portrait">
              <Portrait
                className="cand-portrait"
                src={activeCandidate.portraitUrl}
                initials={activeCandidate.portrait}
                name={activeCandidate.name}
              />
            </div>
            <div className="native-candidate__body">
              <div className="native-candidate__name">{activeCandidate.name}</div>
              <div className="native-candidate__tag">{activeCandidate.tagline}</div>
              <div className="native-candidate__meta">
                <PartyBadge party={activeCandidate.party} />
                <span>${activeCandidate.startingCash}k starting cash</span>
              </div>
              <ModifierSheet
                affinities={activeCandidate.affinities}
                payoutModifiers={activeCandidate.payoutModifiers}
                compact
              />
            </div>
          </div>
          <div className="native-select__summary">
            <div className="native-select__summary-card">
              <p className="native-select__summary-title">Seats</p>
              <div className="setup__seats">
                {seats.map((id, i) => (
                  <span key={i} className={`setup__seat${id ? ' is-filled' : ''}`}>
                    P{i + 1}: <strong>{id ? CANDIDATES.find((c) => c.id === id)?.name : 'Open'}</strong>
                  </span>
                ))}
              </div>
            </div>
            <div className="native-select__summary-card">
              <p className="native-select__summary-title">Selection</p>
              <p className="mp-hint">{filled === count ? 'Ready to start' : `Assign ${count - filled} more candidate(s)`}</p>
            </div>
          </div>
        </div>

        <div className="setup__seats">
          {seats.map((id, i) => (
            <span key={i} className={`setup__seat${id ? ' is-filled' : ''}`}>
              Player {i + 1}: <strong>{id ? CANDIDATES.find((c) => c.id === id)?.name : '—'}</strong>
            </span>
          ))}
        </div>

        <div className="native-select__rail-label native-only">Swipe candidates</div>
        <div className="setup__roster candidate-rail">
          {CANDIDATES.map((c) => {
            const seat = assignedSeat[c.id];
            const isAssigned = seat !== undefined;
            const locked = !isCandidateAvailable(c, unlocked);
            return (
              <button
                key={c.id}
                type="button"
                className={`cand-card${isAssigned ? ' is-assigned' : ''}${activeCandidateId === c.id ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
                style={{ ['--p-color' as string]: PLAYER_COLORS[c.color] }}
                onClick={() => {
                  AudioManager.play('click');
                  setActiveCandidateId(c.id);
                  setStatsModalId(c.id);
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
                    <PartyBadge party={c.party} className="cand-card__party" />
                  </div>
                  {isAssigned && <span className="cand-card__seat">P{seat + 1}</span>}
                  {locked && <span className="cand-card__lock"><LockIcon size={14} /></span>}
                </div>
                {locked
                  ? <div className="cand-card__unlock-hint">Unlock in Shop →</div>
                  : <div className="cand-card__hint">{isAssigned ? `Assigned to P${seat + 1}` : 'Tap for stats ›'}</div>}
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
