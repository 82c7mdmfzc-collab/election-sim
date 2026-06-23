/**
 * notifications.ts — local (on-device) re-engagement notifications via the
 * official Tauri notification plugin.
 *
 * Mirrors haptics.ts: it no-ops on web/desktop, dynamic-imports the plugin so it
 * never lands in the web bundle's main chunk and never module-evals off-native,
 * and swallows every error (notifications are a nicety, never load-bearing).
 *
 * Two scheduled nudges, re-armed every time a game finishes:
 *   • daily streak bonus ready — next day, for signed-in accounts only (the daily
 *     streak is account-only; see complete_game_result in supabase/rewards.sql).
 *   • come-back — a few days after the last game, for everyone.
 * Because they are re-armed on every finish, an active daily player is never
 * actually buzzed (the nudge keeps sliding to tomorrow); only a lapse fires it.
 *
 * Foreground "your turn" timers stay in-app — iOS suppresses local banners while
 * the app is active. Remote push for multiplayer turns while the app is closed is
 * a separate layer (Supabase + APNs).
 */
import { isNativeRuntime } from './platform';
import { getPrefs, setPrefs } from './localPrefs';

type NotificationModule = typeof import('@tauri-apps/plugin-notification');
let modulePromise: Promise<NotificationModule | null> | null = null;

function loadModule(): Promise<NotificationModule | null> {
  if (!isNativeRuntime()) return Promise.resolve(null);
  if (!modulePromise) {
    modulePromise = import('@tauri-apps/plugin-notification').catch(() => null);
  }
  return modulePromise;
}

// Stable 32-bit ids so each nudge is cancel-and-replace-able (never stacks up).
const DAILY_REWARD_ID = 4101;
const COMEBACK_ID = 4102;
const COMEBACK_AFTER_DAYS = 3;
const NUDGE_HOUR = 18; // 6pm local — a civil hour to surface a banner.

/** A future Date `days` from now, pinned to a pleasant local hour. */
function atLocalHour(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * Wrap the plugin's `Schedule.at()` static factory. The project lint rule bans
 * `.at(` because Array/String.prototype.at is missing on the iOS <15.4 WKWebView
 * — but this is the notification plugin's own static factory (it returns a
 * Schedule), not that runtime method, so it is safe to call.
 */
function scheduleAt(m: NotificationModule, date: Date) {
  // eslint-disable-next-line no-restricted-syntax -- plugin static factory, not Array/String.prototype.at
  return m.Schedule.at(date);
}

/**
 * Ask for notification permission at most once, ever. Callers invoke this only
 * from the game-end hook, so the system prompt appears after the player's first
 * finished game — never on launch. No-op on web. Returns whether granted.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const m = await loadModule();
  if (!m) return false;
  try {
    if (await m.isPermissionGranted()) return true;
    if (getPrefs().notifPermissionAsked) return false; // already declined — don't nag
    setPrefs({ notifPermissionAsked: true });
    return (await m.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Re-arm the re-engagement nudges. Cancels the previous pair first so an active
 * player's daily nudge keeps sliding to tomorrow instead of stacking up. No-op
 * without permission (or off-native).
 */
export async function scheduleReengagement({ signedIn }: { signedIn: boolean }): Promise<void> {
  const m = await loadModule();
  if (!m) return;
  try {
    if (!(await m.isPermissionGranted())) return;
    await m.cancel([DAILY_REWARD_ID, COMEBACK_ID]);

    if (signedIn) {
      m.sendNotification({
        id: DAILY_REWARD_ID,
        title: 'Your daily bonus is ready',
        body: 'Finish a game today to claim your streak bonus and keep the run alive.',
        schedule: scheduleAt(m, atLocalHour(1, NUDGE_HOUR)),
      });
    }
    m.sendNotification({
      id: COMEBACK_ID,
      title: 'The campaign needs you',
      body: 'Your rivals are pulling ahead. Jump back in and build influence before Election Night.',
      schedule: scheduleAt(m, atLocalHour(COMEBACK_AFTER_DAYS, NUDGE_HOUR)),
    });
  } catch {
    /* notifications are non-essential — never surface an error */
  }
}

/**
 * Single entry point for the game-end hook (useProfile.applyGameResult): prompt
 * for permission after the first finished game, then (re)schedule the nudges.
 * Fire-and-forget; no-op on web.
 */
export async function onGameFinishedNotifications(args: { signedIn: boolean }): Promise<void> {
  if (!isNativeRuntime()) return;
  try {
    await ensureNotificationPermission(); // prompts at most once, ever
    await scheduleReengagement({ signedIn: args.signedIn });
  } catch {
    /* never let notifications affect the game flow */
  }
}
