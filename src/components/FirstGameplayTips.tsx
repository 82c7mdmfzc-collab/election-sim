/**
 * FirstGameplayTips — a one-time, dismissible welcome overlay shown the very
 * first time a player reaches the gameplay board. Three short tips, then it
 * never shows again (persisted via localPrefs). Intentionally lightweight — the
 * full walkthrough lives in the tutorial; the live coach handles strategy.
 *
 * Gated to a local/solo first turn so it never blocks a timed online turn.
 */

import { useState } from 'react';
import { useGameStore } from '../game/store';
import { isFirstGameplayTipsSeen, markFirstGameplayTipsSeen } from '../utils/localPrefs';
import { AudioManager } from '../utils/audioManager';

const TIPS: readonly { lead: string; rest: string }[] = [
  { lead: 'Reach 270 electoral votes', rest: 'to win the election — that’s your Victory Target.' },
  { lead: 'Spend in states', rest: 'to build Campaign Influence and lead the map.' },
  { lead: 'Watch your funds', rest: '— every move costs, so spend your War Chest where it counts.' },
];

export function FirstGameplayTips() {
  const turn = useGameStore((s) => s.turn);
  const phase = useGameStore((s) => s.phase);
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const [dismissed, setDismissed] = useState(() => isFirstGameplayTipsSeen());

  // First planning turn of a local game only, once per device.
  if (dismissed || multiplayerMode === 'online' || phase !== 'PLANNING' || turn !== 1) {
    return null;
  }

  const dismiss = () => {
    AudioManager.play('click');
    markFirstGameplayTipsSeen();
    setDismissed(true);
  };

  return (
    <div className="first-tips" role="dialog" aria-modal="true" aria-label="How to play Elector">
      <div className="first-tips__backdrop" onClick={dismiss} />
      <div className="first-tips__card">
        <span className="first-tips__kicker">Welcome, Candidate</span>
        <h3 className="first-tips__title">Three things to know</h3>
        <ol className="first-tips__list">
          {TIPS.map((t, i) => (
            <li key={i} className="first-tips__item">
              <span className="first-tips__num">{i + 1}</span>
              <span className="first-tips__text"><strong>{t.lead}</strong> {t.rest}</span>
            </li>
          ))}
        </ol>
        <button type="button" className="first-tips__btn" onClick={dismiss}>
          Got it &rarr;
        </button>
      </div>
    </div>
  );
}
