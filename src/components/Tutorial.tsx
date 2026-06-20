/**
 * Tutorial — the first-run walkthrough overlay.
 *
 * Renders TUTORIAL_STEPS as a paged, illustrated explainer with progress dots,
 * Back / Next / Skip, and a closing "Start a Game" CTA. Self-contained: it does
 * not drive the live board, so it's robust regardless of game state. The "?" help
 * (HowToPlayPanel) covers the same rules for quick mid-game reference.
 *
 * On dismissal (finish or skip) it marks the tutorial seen so it won't auto-open
 * again; the parent decides where to route next.
 */

import { useEffect, useState } from 'react';
import { TUTORIAL_STEPS } from '../game/tutorial';
import { markTutorialSeen } from '../utils/localPrefs';
import { AudioManager } from '../utils/audioManager';
import { track } from '../utils/analytics';

interface TutorialProps {
  source: 'menu' | 'onboarding';
  /** Called when the user finishes via the final CTA (e.g. route to candidate select). */
  onFinish: () => void;
  /** Called when the user skips/exits without finishing (e.g. back to menu). */
  onSkip: () => void;
}

export function Tutorial({ source, onFinish, onSkip }: TutorialProps) {
  const [i, setI] = useState(0);
  const step = TUTORIAL_STEPS[i];
  const isLast = i === TUTORIAL_STEPS.length - 1;

  useEffect(() => {
    track('tutorial_started', { source, step_count: TUTORIAL_STEPS.length });
  }, [source]);

  function next() {
    AudioManager.play('click');
    if (isLast) {
      markTutorialSeen();
      track('tutorial_completed', { source, step_count: TUTORIAL_STEPS.length });
      onFinish();
    } else {
      setI((n) => n + 1);
    }
  }

  function back() {
    AudioManager.play('click');
    setI((n) => Math.max(0, n - 1));
  }

  function skip() {
    AudioManager.play('quit');
    markTutorialSeen();
    track('tutorial_skipped', { source, step_index: i + 1, step_count: TUTORIAL_STEPS.length });
    onSkip();
  }

  return (
    <div className="tutorial">
      <div className="tutorial__panel">
        <button type="button" className="tutorial__skip" onClick={skip}>
          Skip ✕
        </button>

        <div key={step.id} className="tutorial__art" aria-hidden>{step.art}</div>
        <h2 className="tutorial__title">{step.title}</h2>
        <p className="tutorial__body">{step.body}</p>

        <div className="tutorial__dots" role="tablist" aria-label="Tutorial progress">
          {TUTORIAL_STEPS.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              className={`tutorial__dot${idx === i ? ' is-active' : ''}`}
              aria-label={`Step ${idx + 1}`}
              aria-selected={idx === i}
              role="tab"
              onClick={() => { AudioManager.play('click'); setI(idx); }}
            />
          ))}
        </div>

        <div className="tutorial__nav">
          <button
            type="button"
            className="tutorial__btn tutorial__btn--ghost"
            onClick={back}
            disabled={i === 0}
          >
            ← Back
          </button>
          <button type="button" className="tutorial__btn" onClick={next}>
            {isLast ? 'Start a Game →' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
