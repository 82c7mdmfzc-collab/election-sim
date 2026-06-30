/**
 * ElectionApproachBanner — a one-round heads-up so Election Night is never sprung.
 *
 * When a planning round is pre-rolled as election-scheduled, this banner appears
 * during that round. The election then fires after the round resolves.
 * Mounted once in GameShell so it survives across turns; dismiss on tap or after a
 * few seconds.
 */

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../game/store';
import { AudioManager } from '../utils/audioManager';

const AUTO_DISMISS_MS = 6000;

export function ElectionApproachBanner() {
  const phase = useGameStore((s) => s.phase);
  const turn = useGameStore((s) => s.turn);
  const electionScheduled = useGameStore((s) => s.electionScheduled);

  const setElectionAlertOpen = useGameStore((s) => s.setElectionAlertOpen);

  const [active, setActive] = useState(false);
  const shownRef = useRef<Set<number>>(new Set());

  // While the modal is up, freeze the turn clock (it covers the board); clearing on
  // dismiss AND unmount so a phase change can't leave the timer stuck paused.
  useEffect(() => {
    setElectionAlertOpen(active);
    return () => setElectionAlertOpen(false);
  }, [active, setElectionAlertOpen]);

  useEffect(() => {
    if (phase !== 'PLANNING') return;
    if (electionScheduled && !shownRef.current.has(turn)) {
      shownRef.current.add(turn);
      setActive(true);
      AudioManager.play('election_warning');
    }
  }, [phase, turn, electionScheduled]);

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setActive(false), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;

  return (
    <div className="election-approach" role="alertdialog" aria-label="Election Night approaching">
      <button
        type="button"
        className="election-approach__backdrop"
        aria-label="Dismiss"
        onClick={() => setActive(false)}
      />
      <div className="election-approach__card">
        <div className="election-approach__glow" aria-hidden />
        <div className="election-approach__icon" aria-hidden>🗳️</div>
        <div className="election-approach__kicker">
          Election After This Round
        </div>
        <h2 className="election-approach__title">
          Final moves before the vote
        </h2>
        <p className="election-approach__body">
          The election will be called when <strong>Round {turn}</strong> resolves.
          Shift to EVs now and lock in your battleground states.
        </p>
        <button
          type="button"
          className="election-approach__btn"
          onClick={() => { AudioManager.play('confirm'); setActive(false); }}
        >
          Bring it on →
        </button>
      </div>
    </div>
  );
}
