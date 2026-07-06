/**
 * appReview — request the native "rate this app" prompt at a happy moment.
 *
 * Mirrors rewardedAds.ts / notifications.ts: no-ops on web/desktop, dynamic-imports
 * the Tauri bridge so it never lands in the web bundle, and swallows every error (a
 * review nudge is a nicety, never load-bearing). Backed by the elector-review native
 * plugin (SKStoreReviewController on iOS, Play In-App Review on Android).
 *
 * The OS owns the actual policy: iOS shows the sheet at most ~3×/365 days and never
 * to a user who already rated; Play similarly quota-limits. So we can safely re-ask
 * on each new unlock — the platform decides whether anything is shown.
 */
import { isNativeRuntime } from './platform';
import { premiumUnlockCount } from '../game/achievements';
import { getLastReviewUnlockCount, setLastReviewUnlockCount } from './localPrefs';

/** Ask the OS to (maybe) show its in-app review prompt. No-op off-native. */
export async function requestAppReview(): Promise<void> {
  if (!isNativeRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('plugin:elector-review|request_review');
  } catch {
    /* plugin unavailable / desktop stub — never surface an error */
  }
}

/**
 * Trigger a review request when the player has just unlocked a NEW premium
 * character. `premiumUnlockCount` is monotonic, so `count > lastAsked` is true
 * exactly once per new unlock: the first ever (0→1) and each subsequent one — which
 * is precisely the requested cadence. Advancing the stored count first keeps a
 * rapid multi-buy from firing more than once per actual unlock.
 */
export function maybeRequestReviewAfterUnlock(unlocked: readonly string[]): void {
  const count = premiumUnlockCount(unlocked);
  if (count > getLastReviewUnlockCount()) {
    setLastReviewUnlockCount(count);
    void requestAppReview();
  }
}
