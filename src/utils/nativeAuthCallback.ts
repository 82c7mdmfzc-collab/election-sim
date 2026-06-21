/**
 * nativeAuthCallback — completes OAuth sign-in inside the Tauri (native) app.
 *
 * On web, supabase.auth.signInWithOAuth does a full-page redirect and
 * detectSessionInUrl parses the returned tokens automatically. Native has no such
 * redirect: authClient.startOAuth opens the provider's authorize URL in the system
 * browser, and the provider returns to the registered deep link
 *   com.playelector.app://auth-callback#access_token=…&refresh_token=…
 * This module catches that link (both cold- and warm-start) and hands the tokens to
 * supabase.auth.setSession; the existing onAuthChange subscription (useProfile.init)
 * then re-routes the app. (A same-device email magic-link return lands here too.)
 *
 * The deep-link plugin is imported dynamically and only on native, so it never enters
 * the web / iOS-14 module-eval path — consistent with the app's strict old-WebView
 * posture (see the polyfill shim in index.html).
 */
import { isNativeRuntime } from './authClient';
import { supabase, isSupabaseConfigured } from './supabaseClient';

const CALLBACK_PREFIX = 'com.playelector.app://';

let wired = false;

/** Pull tokens from a deep-link URL fragment and set the Supabase session. */
async function completeFromUrl(url: string): Promise<void> {
  try {
    if (!url.startsWith(CALLBACK_PREFIX)) return;
    const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
    const params = new URLSearchParams(hash);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    // No tokens → an OAuth error or a cancelled/unrelated link. Leave the user on
    // the sign-in screen rather than throwing.
    if (!access_token || !refresh_token) return;
    await supabase.auth.setSession({ access_token, refresh_token });
  } catch (err) {
    console.warn('[auth] deep-link callback failed:', err);
  }
}

/**
 * Wire native OAuth deep-link handling. Idempotent; a no-op on web and when Supabase
 * isn't configured. Covers warm-start (onOpenUrl) and cold-start (getCurrent).
 */
export async function initNativeAuthCallback(): Promise<void> {
  if (wired || !isNativeRuntime() || !isSupabaseConfigured) return;
  wired = true;
  try {
    const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
    // Warm-start: a link arrives while the app is already running.
    await onOpenUrl((urls) => urls.forEach((u) => void completeFromUrl(u)));
    // Cold-start: the app was launched by the link.
    const initial = await getCurrent();
    initial?.forEach((u) => void completeFromUrl(u));
  } catch (err) {
    console.warn('[auth] failed to init native auth callback:', err);
  }
}
