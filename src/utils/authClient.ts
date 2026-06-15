/**
 * authClient — thin wrapper over supabase.auth.
 *
 * Account model:
 *   • There is NO anonymous/guest economy. Campaign Funds, unlocks, stats, the
 *     shop, and online play exist ONLY for a signed-in account. A "guest" is
 *     simply someone with no session — they may still play vs-bot and pass-and-play.
 *   • Sign-in is via Apple, Google, or an email magic link. All three resolve to a
 *     durable Supabase auth.uid() that is stable across refreshes and devices,
 *     which is what keeps online lobby participation valid.
 *   • Each account claims ONE permanent username (see claimDisplayName), used as
 *     their display name in online lobbies.
 *   • If Supabase isn't configured (e.g. unit tests, offline), auth calls no-op.
 */

import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabaseClient';

export type { Session, User };

/** Where OAuth should send the user back. Web uses the current origin; native
 *  (Tauri) uses a registered deep-link scheme handled on app open. */
function oauthRedirectTo(): string {
  // In a Tauri webview the origin is tauri://localhost; route back through the
  // deep-link scheme the app registers. On the web, return to the current origin.
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('tauri')) {
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

/** Begin the Google OAuth flow (redirects the browser). */
export async function signInWithGoogle(): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: 'Online accounts are not configured.' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: oauthRedirectTo() },
  });
  return error ? { error: error.message } : {};
}

/** Begin the Apple OAuth flow (redirects the browser). */
export async function signInWithApple(): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: 'Online accounts are not configured.' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: oauthRedirectTo() },
  });
  return error ? { error: error.message } : {};
}

/** Send an email magic link to sign in (passwordless). */
export async function sendMagicLink(email: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: 'Online accounts are not configured.' };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: oauthRedirectTo() },
  });
  return error ? { error: error.message } : {};
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
  await supabase.auth.signOut();
}

/** Subscribe to auth state changes. Returns an unsubscribe function. */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  if (!isSupabaseConfigured) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}
