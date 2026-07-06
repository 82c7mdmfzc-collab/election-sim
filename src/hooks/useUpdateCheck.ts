/**
 * useUpdateCheck — drive the forced-update gate on launch and on app resume.
 *
 * On mount: seed the gate from the cached config (instant paint for a returning
 * user), then fetch fresh config and re-evaluate. On resume (tab/app returns to
 * the foreground) re-fetch so a force update published while the app was
 * backgrounded takes effect the moment the player comes back — a briefly-cached
 * config can never bypass a force for more than one foreground.
 *
 * Native only in effect: fetchAppConfig() returns null on web/desktop, so the
 * gate stays 'ok' there (the website auto-updates).
 */

import { useEffect, useRef } from 'react';
import { fetchAppConfig, getCachedConfig } from '../game/appConfig';
import { useUpdateGate } from '../utils/updateGate';
import { isNativeRuntime } from '../utils/platform';

// Don't hammer the network if visibility toggles rapidly.
const MIN_RECHECK_MS = 10_000;
// Never hold the app waiting on the first check longer than this.
const FIRST_CHECK_TIMEOUT_MS = 2_500;

export function useUpdateCheck(): void {
  const lastCheck = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const runCheck = async () => {
      lastCheck.current = Date.now();
      const cfg = await fetchAppConfig();
      if (!cancelled) useUpdateGate.getState().evaluate(cfg);
    };

    // Instant paint from cache, then refine from the network.
    const cached = getCachedConfig();
    if (cached) useUpdateGate.getState().evaluate(cached);
    void runCheck();

    // Release the "checked" latch even if the network hangs.
    const timer = window.setTimeout(() => {
      if (!cancelled && !useUpdateGate.getState().checked) {
        useUpdateGate.setState({ checked: true });
      }
    }, FIRST_CHECK_TIMEOUT_MS);

    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastCheck.current < MIN_RECHECK_MS) return;
      void runCheck();
    };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);

    // Tauri native focus (belt-and-suspenders; visibilitychange covers most cases).
    let unlisten: (() => void) | undefined;
    if (isNativeRuntime()) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (focused) onResume();
          }),
        )
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
      unlisten?.();
    };
  }, []);
}
