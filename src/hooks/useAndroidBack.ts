/**
 * useAndroidBack — wire a component's dismiss action to the Android hardware /
 * gesture back button. Pass the same function the on-screen ← or ✕ button
 * calls; pass null when there is nothing to dismiss (e.g. sitting on Home).
 *
 * The registration is held stable while `onBack` stays non-null — the latest
 * callback is read through a ref — so re-renders and screen-to-screen
 * transitions don't churn the history sentinel. No-op on iOS/web/desktop.
 */
import { useEffect, useRef } from 'react';
import { pushBackHandler } from '../utils/androidBackStack';

export function useAndroidBack(onBack: (() => void) | null): void {
  const ref = useRef(onBack);
  useEffect(() => { ref.current = onBack; });
  const active = onBack != null;
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => { ref.current?.(); });
  }, [active]);
}
