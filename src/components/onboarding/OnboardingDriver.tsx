/**
 * OnboardingDriver — runs the guided first game.
 *
 * Advances through ONBOARDING_STEPS by watching the real game state (and the
 * current anchor's presence) on a light poll, re-measuring the spotlight rect on
 * resize / orientation change. It never blocks input: `done` predicates fire off
 * the player's own taps. Mounted by GameShell only while the Opening Campaign is
 * running and the guide hasn't been completed; marks it done on finish or skip.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../../game/store';
import { markGuidedOnboardingDone } from '../../utils/localPrefs';
import { track } from '../../utils/analytics';
import { AudioManager } from '../../utils/audioManager';
import { ONBOARDING_STEPS } from './steps';
import { SpotlightOverlay, type Rect } from './SpotlightOverlay';

function measure(anchor: string | null): Rect | null {
  if (!anchor || typeof document === 'undefined') return null;
  const el = document.querySelector(`[data-tut="${anchor}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function OnboardingDriver() {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const finished = useRef(false);
  const startedTracked = useRef(false);

  const step = ONBOARDING_STEPS[index];
  const total = ONBOARDING_STEPS.length;

  useEffect(() => {
    if (!startedTracked.current) {
      startedTracked.current = true;
      track('guided_onboarding_started', {});
    }
  }, []);

  function finish(reason: 'completed' | 'skipped') {
    if (finished.current) return;
    finished.current = true;
    markGuidedOnboardingDone();
    track('guided_onboarding_finished', { reason, last_step: step?.id ?? 'unknown', step_index: index });
    setIndex(total); // unmounts overlay (index out of range)
  }

  function advance() {
    AudioManager.play('click');
    if (index >= total - 1) { finish('completed'); return; }
    setIndex((i) => i + 1);
  }

  // Poll: re-measure the anchor and auto-advance when the step's predicate is met.
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const tick = () => {
      setRect(measure(step.anchor));
      if (step.done && !step.cta) {
        try { if (step.done(useGameStore.getState())) { advance(); return; } } catch { /* ignore */ }
      }
      // For cta+done steps, the button drives; done only gates enabling — here we
      // still auto-advance if the game moved on (e.g. recap after resolution).
      if (step.done && step.cta && step.id === 'recap') {
        try { if (step.done(useGameStore.getState())) setRect(null); } catch { /* ignore */ }
      }
      raf = window.setTimeout(tick, 320);
    };
    tick();
    const onResize = () => setRect(measure(step.anchor));
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.clearTimeout(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  if (!step || finished.current) return null;

  return createPortal(
    <SpotlightOverlay
      step={step}
      rect={rect}
      index={index}
      total={total}
      onContinue={advance}
      onSkip={() => finish('skipped')}
    />,
    document.body,
  );
}
