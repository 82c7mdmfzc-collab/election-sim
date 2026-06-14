/**
 * authClient — thin wrapper over supabase.auth.
 *
 * Goals:
 *   • Play is NEVER blocked by a login wall. If Supabase is configured we sign
 *     the device in anonymously (a "guest"), which still yields an auth.uid()
 *     so a cloud profile row exists and progression can sync later.
 *   • "Save my progress" upgrades a guest to a real account via magic link,
 *     preserving the same uid (and therefore the same profile/unlocks).
 *   • If Supabase isn't configured (e.g. unit tests, offline), everything no-ops
 *     and callers fall back to the localStorage profile mirror.
 */

import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabaseClient';

export type { Session, User };

/** Current session, or null if signed-out / not configured. */
export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

/**
 * Ensure there is *some* session. If signed out, create an anonymous guest
 * session so a profile uid exists. Returns the active user (or null if the
 * project hasn't enabled anonymous sign-ins / isn't configured).
 */
export async function ensureSession(): Promise<User | null> {
  if (!isSupabaseConfigured) return null;
  const existing = await getSession();
  if (existing?.user) return existing.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn('ensureSession: anonymous sign-in unavailable —', error.message);
    return null;
  }
  return data.user ?? null;
}

/** True when the active user is an anonymous guest (not an email account). */
export function isGuest(user: User | null): boolean {
  if (!user) return true;
  // supabase-js marks anonymous users with is_anonymous; fall back to "no email".
  return (user as User & { is_anonymous?: boolean }).is_anonymous ?? !user.email;
}

/**
 * Send a magic-link to upgrade/sign-in with email. From a guest session we link
 * the email to the SAME uid via updateUser (preserving progression); if there's
 * no session we fall back to a fresh OTP sign-in.
 */
export async function sendMagicLink(email: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: 'Online accounts are not configured.' };

  const session = await getSession();
  if (session?.user) {
    const { error } = await supabase.auth.updateUser({ email });
    return error ? { error: error.message } : {};
  }

  const { error } = await supabase.auth.signInWithOtp({ email });
  return error ? { error: error.message } : {};
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
