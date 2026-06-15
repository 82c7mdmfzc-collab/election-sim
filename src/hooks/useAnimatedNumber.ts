/**
 * useAnimatedNumber — tweens a displayed number toward a target value.
 *
 * Used to make cash/wallet balances visibly count up or down when a purchase is
 * queued or retracted (instead of snapping). Honours prefers-reduced-motion by
 * returning the target value immediately.
 *
 * Returns the current (rounded) display value to render.
 */

import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useAnimatedNumber(target: number, durationMs = 400): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // No animation when reduced motion is requested or duration is zero — the
    // render below returns `target` directly, so no state update is needed.
    if (prefersReducedMotion() || durationMs <= 0) {
      fromRef.current = target;
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic for a snappy settle
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      if (t < 1) {
        setDisplay(value);
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        setDisplay(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      fromRef.current = target; // resume from wherever we land if interrupted
    };
  }, [target, durationMs]);

  if (prefersReducedMotion() || durationMs <= 0) return target;
  return Math.round(display);
}
