/**
 * nativeAuthCallback — completes OAuth sign-in inside the Tauri (native) app.
 *
 * On web, supabase.auth.signInWithOAuth does a full-page redirect and
 * detectSessionInUrl parses the returned tokens automatically. Native has no such
 * redirect: authClient.startOAuth opens the provider's authorize URL in the mobile
 * in-app browser, and the provider returns to the registered deep link
 *   com.playelector.app://auth-callback#access_token=…&refresh_token=…
 * This module catches that link (both cold- and warm-start) and completes sign-in.
 * Supabase defaults to the PKCE flow, so the provider returns ?code=… and we call
 * exchangeCodeForSession; for the implicit flow we fall back to reading the tokens
 * from the URL fragment and calling setSession. Either way the existing onAuthChange
 * subscription (useProfile.init) then re-routes the app. (A same-device email
 * magic-link return lands here too — also a ?code= under PKCE.)
 *
 * The deep-link plugin is imported dynamically and only on native, so it never enters
 * the web / iOS-14 module-eval path — consistent with the app's strict old-WebView
 * posture (see the polyfill shim in index.html).
 */
import { isNativeRuntime } from './authClient';
import { supabase, isSupabaseConfigured } from './supabaseClient';

const CALLBACK_PREFIX = 'com.playelector.app://';

let wired = false;

/** Complete sign-in from a deep-link callback URL (PKCE code or implicit tokens). */
async function completeFromUrl(url: string): Promise<void> {
  try {
    if (!url.startsWith(CALLBACK_PREFIX)) return;

    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');
    const query = queryIndex !== -1
      ? url.slice(queryIndex + 1, hashIndex > queryIndex ? hashIndex : undefined)
      : '';
    const hash = hashIndex !== -1 ? url.slice(hashIndex + 1) : '';
    const queryParams = new URLSearchParams(query);
    const hashParams = new URLSearchParams(hash);

    // Provider cancellation/error returns are expected user actions. Log enough
    // for diagnostics, then leave the sign-in UI in place.
    const error = queryParams.get('error') || hashParams.get('error');
    if (error) {
      console.warn('[auth] provider returned without a session:', error);
      return;
    }

    // PKCE flow (Supabase default): the provider returns ?code=… in the query.
    // exchangeCodeForSession redeems it using the verifier this client stored when
    // it started the flow. Also covers same-device email magic-link returns.
    const code = queryParams.get('code');
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
      return;
    }

    // Implicit flow fallback: tokens arrive in the URL fragment.
    const access_token = hashParams.get('access_token');
    const refresh_token = hashParams.get('refresh_token');
    // No code and no tokens → an OAuth error or a cancelled/unrelated link. Leave
    // the user on the sign-in screen rather than throwing.
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
