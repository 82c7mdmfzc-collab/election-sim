/**
 * ElectionApproachBanner — a one-time heads-up so Election Night is never sprung.
 *
 * Two beats, each shown once per game at the start of PLANNING:
 *   • 'pre'  (the round before elections open): a final-stretch warning.
 *   • 'live' (the first round an election can actually be called): "it's live now",
 *            with the current per-round chance.
 *
 * After these, the persistent HUD election pill keeps players informed each round.
 * Mounted once in GameShell so it survives across turns; dismiss on tap or after a
 * few seconds.
 */

import { useEffect, useRef, useState } from 'react';
import { ELECTION_START_TURN, electionProbability } from '../game/config';
import { useGameStore } from '../game/store';
import { AudioManager } from '../utils/audioManager';

type Beat = 'pre' | 'live';

const AUTO_DISMISS_MS = 6000;

export function ElectionApproachBanner() {
  const phase = useGameStore((s) => s.phase);
  const turn = useGameStore((s) => s.turn);
  const hungColleges = useGameStore((s) => s.hungColleges);

  const setElectionAlertOpen = useGameStore((s) => s.setElectionAlertOpen);

  const [active, setActive] = useState<Beat | null>(null);
  const shownRef = useRef<Set<Beat>>(new Set());

  // While the modal is up, freeze the turn clock (it covers the board); clearing on
  // dismiss AND unmount so a phase change can't leave the timer stuck paused.
  useEffect(() => {
    setElectionAlertOpen(active !== null);
    return () => setElectionAlertOpen(false);
  }, [active, setElectionAlertOpen]);

  useEffect(() => {
    if (phase !== 'PLANNING') return;

    // The round before Election Night can be called.
    if (turn === ELECTION_START_TURN - 1 && !shownRef.current.has('pre')) {
      shownRef.current.add('pre');
      setActive('pre');
      AudioManager.play('election_warning');
      return;
    }

    // The first round an election can actually be called (chance > 0).
    if (
      turn >= ELECTION_START_TURN &&
      electionProbability(turn, hungColleges) > 0 &&
      !shownRef.current.has('live')
    ) {
      shownRef.current.add('live');
      setActive('live');
      AudioManager.play('election_warning');
    }
  }, [phase, turn, hungColleges]);

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setActive(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;

  const chance = Math.round(electionProbability(turn, hungColleges) * 100);
  const isPre = active === 'pre';

  return (
    <div className="election-approach" role="alertdialog" aria-label="Election Night approaching">
      <button
        type="button"
        className="election-approach__backdrop"
        aria-label="Dismiss"
        onClick={() => setActive(null)}
      />
      <div className="election-approach__card">
        <div className="election-approach__glow" aria-hidden />
        <div className="election-approach__icon" aria-hidden>🗳️</div>
        <div className="election-approach__kicker">
          {isPre ? 'Election Next Turn' : 'Election Night'}
        </div>
        <h2 className="election-approach__title">
          {isPre ? 'Election next turn' : 'The Vote Is Live'}
        </h2>
        <p className="election-approach__body">
          {isPre ? (
            <>The election can be called from <strong>next turn</strong>.
            Shift to EVs now and lock in your battleground states.</>
          ) : (
            <>Any round can now trigger the national vote — <strong>{chance}% chance</strong> when
            this round resolves. Make every move count.</>
          )}
        </p>
        <button
          type="button"
          className="election-approach__btn"
          onClick={() => { AudioManager.play('confirm'); setActive(null); }}
        >
          {isPre ? 'Bring it on →' : 'Understood →'}
        </button>
      </div>
    </div>
  );
}
