/**
 * authClient — thin wrapper over supabase.auth.
 *
 * Account model:
 *   • There is NO anonymous/guest economy. Campaign Funds, unlocks, stats, the
 *     shop, and online play exist ONLY for a signed-in account. A "guest" is
 *     simply someone with no session — they may still play Solo and pass-and-play.
 *   • Web sign-in supports Google, Apple (once enabled), and email code. Native
 *     iOS currently uses email code only until OAuth deep links are wired.
 *   • Each account claims ONE permanent username (see claimDisplayName), used as
 *     their display name in online lobbies.
 *   • If Supabase isn't configured (e.g. unit tests, offline), auth calls no-op.
 */

import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabaseClient';

export type { Session, User };

// Apple provider is configured in Supabase (Authentication → Providers → Apple),
// so the Apple button now runs a real OAuth flow. Set back to false to fall back to
// the friendly "coming soon" message (no OAuth error) if the provider is ever removed.
export const APPLE_SIGNIN_ENABLED = true;

/** True inside a Tauri native webview. */
export function isNativeRuntime(): boolean {
  return typeof window !== 'undefined' && window.location.protocol.startsWith('tauri');
}

// Native OAuth is wired: the deep-link plugin (registered in src-tauri/src/lib.rs)
// catches the com.playelector.app://auth-callback return and src/utils/nativeAuthCallback
// feeds the tokens to supabase.auth.setSession. With that in place the OAuth buttons
// are shown natively. (Google works once the deep link is allow-listed in Supabase →
// URL Configuration; Apple additionally needs APPLE_SIGNIN_ENABLED — see above.)
export const NATIVE_OAUTH_ENABLED = true;

/** Where OAuth should send the user back. Web uses the current origin; native
 *  (Tauri) uses a registered deep-link scheme handled on app open. */
function oauthRedirectTo(): string {
  // In a Tauri webview the origin is tauri://localhost; route back through the
  // deep-link scheme the app registers. On the web, return to the current origin.
  if (isNativeRuntime()) {
    return 'com.playelector.app://auth-callback';
  }
  return typeof window !== 'undefined' ? window.location.origin : 'https://playelector.com';
}

/** Current session, or null if signed-out / not configured. */
export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

/** Current user, or null if signed-out / not configured. */
export async function getUser(): Promise<User | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/**
 * Begin an OAuth flow.
 *  • Web: signInWithOAuth performs the full-page browser redirect; detectSessionInUrl
 *    finishes sign-in on return.
 *  • Native (Tauri): there is no page redirect, so we request the authorize URL
 *    (skipBrowserRedirect) and open it in the system browser. The provider returns to
 *    com.playelector.app://auth-callback, handled by utils/nativeAuthCallback.ts.
 */
async function startOAuth(provider: 'google' | 'apple'): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: 'Online accounts are not configured.' };

  if (isNativeRuntime()) {
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: oauthRedirectTo(), skipBrowserRedirect: true },
      });
      if (error) return { error: error.message };
      if (!data?.url) return { error: 'Could not start sign-in. Please try again.' };
      // Dynamic import keeps the opener plugin out of the web / iOS-14 module-eval path.
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(data.url);
      return {};
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Could not open the sign-in page.' };
    }
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: oauthRedirectTo() },
  });
  return error ? { error: error.message } : {};
}

/** Begin the Google OAuth flow. */
export function signInWithGoogle(): Promise<{ error?: string }> {
  return startOAuth('google');
}

/** Begin the Apple OAuth flow. */
export function signInWithApple(): Promise<{ error?: string }> {
  return startOAuth('apple');
}

/**
 * Email the player a passwordless sign-in. The email carries BOTH a clickable
 * magic link (same-device) and an 8-digit code (cross-device — read it on your
 * phone, type it on the device you're playing on). Code length/expiry are set in
 * the Supabase dashboard (8 digits / 15 min).
 *
 * @param signUp  Create Account mode (true) creates the user if new; Sign In
 *                mode (false) rejects an unknown email so we can prompt to register.
 */
export async function sendEmailCode(
  email: string,
  { signUp }: { signUp: boolean },
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: 'Online accounts are not configured.' };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: signUp, emailRedirectTo: oauthRedirectTo() },
  });
  if (!error) return {};
  // Friendlier copy for the common Sign-In-with-unknown-email case.
  const msg = /signups? not allowed|not found|no user/i.test(error.message)
    ? 'No account found for that email. Switch to Create Account to make one.'
    : error.message;
  return { error: msg };
}

/** Redeem the 8-digit email code. On success the session is set and onAuthChange fires. */
export async function verifyEmailCode(email: string, token: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: 'Online accounts are not configured.' };
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (!error) return {};
  const msg = /expired|invalid|token/i.test(error.message)
    ? 'That code is invalid or has expired. Request a new one.'
    : error.message;
  return { error: msg };
}

/** Result of attempting to claim the permanent username. */
export type ClaimNameResult = 'ok' | 'taken' | 'invalid' | 'already_set' | 'error';

/**
 * Claim the caller's PERMANENT username. One-time only — the server rejects a
 * second attempt. Returns a result code the UI maps to a message.
 */
export async function claimDisplayName(name: string): Promise<ClaimNameResult> {
  if (!isSupabaseConfigured) return 'error';
  const { data, error } = await supabase.rpc('claim_display_name', { p_name: name });
  if (error) {
    console.warn('claimDisplayName failed:', error.message);
    return 'error';
  }
  return (data as ClaimNameResult) ?? 'error';
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) return;
  // Local scope: clear THIS device's persisted session without a server round-trip.
  // A global sign-out can reject on a stale/expired token or offline, which would
  // otherwise leave the user stuck "signed in" — logging out should never depend on
  // the network succeeding.
  await supabase.auth.signOut({ scope: 'local' });
}

/** Subscribe to auth state changes. Returns an unsubscribe function. */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  if (!isSupabaseConfigured) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}
