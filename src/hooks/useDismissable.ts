/**
 * useDismissable — shared exit-animation state for dismissable overlays.
 *
 * Native surfaces animate out; web SPAs hard-unmount. requestClose() flips
 * `closing` (the caller renders its `--closing` CSS modifier off it), lets the
 * exit keyframes play, then runs the close callback. Under reduced motion it
 * closes immediately. Repeat calls while an exit is in flight are ignored, and
 * an unmount mid-exit drops the pending timer so a re-opened instance can't be
 * closed by a stale one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motionReduced } from '../utils/appearance';

/** Slightly past the 120ms (--dur-fast) exit keyframes, so the `forwards`
 *  fill holds the final frame briefly instead of unmounting mid-animation. */
export const DISMISS_MS = 160;

export function useDismissable(onClose: () => void, ms: number = DISMISS_MS) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const requestClose = useCallback((after?: () => void) => {
    if (closing) return;
    const finish = after ?? onClose;
    if (motionReduced()) { finish(); return; }
    setClosing(true);
    timer.current = window.setTimeout(finish, ms);
  }, [closing, onClose, ms]);

  return { closing, requestClose };
}
