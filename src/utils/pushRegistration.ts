/**
 * pushRegistration — register this device for remote push and upsert its token.
 *
 * Native-only (no-op on web/desktop). Backed by the elector-push plugin, which
 * returns the APNs device token (iOS) or FCM token (Android). The token is stored
 * in public.device_tokens under the signed-in account (owner RLS), where the
 * admin-broadcast / resolve-turn edge functions read it to send pushes.
 *
 * Mirrors notifications.ts: dynamic-imports the bridge, swallows every error
 * (push is a nicety, never load-bearing), and reuses the same OS permission prompt
 * as the local re-engagement notifications so the user is asked at most once.
 */
import { isNativeRuntime } from './platform';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { ensureNotificationPermission } from './notifications';

interface RegisterPushResponse {
  token?: string;
  platform?: string;
  environment?: string;
  error?: string;
}

// The token registered for the current signed-in device this session — used to
// delete exactly this row on sign-out (never other devices' tokens).
let registeredToken: string | null = null;

async function nativeRegister(): Promise<RegisterPushResponse | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<RegisterPushResponse>('plugin:elector-push|register_for_push');
  } catch {
    return null; // plugin unavailable / desktop stub
  }
}

/**
 * Register for push and persist the token for `userId`. Fire-and-forget; safe to
 * call on every signed-in launch (upsert is idempotent). No-op off-native, without
 * a Supabase config, or when the OS denies notification permission.
 */
export async function registerForPush(userId: string): Promise<void> {
  if (!isNativeRuntime() || !isSupabaseConfigured || !userId) return;
  try {
    if (!(await ensureNotificationPermission())) return; // declined — nothing to store
    const res = await nativeRegister();
    if (!res?.token) return;
    const platform = res.platform === 'android' ? 'android' : 'ios';
    const environment = res.environment === 'sandbox' ? 'sandbox' : 'prod';
    const { error } = await supabase
      .from('device_tokens')
      .upsert(
        { user_id: userId, token: res.token, platform, environment },
        { onConflict: 'user_id,token' },
      );
    if (!error) registeredToken = res.token;
  } catch {
    /* push registration is non-essential — never surface an error */
  }
}

/**
 * Remove this device's token. Call BEFORE signing out (the delete needs the
 * still-valid session, since device_tokens RLS is owner-only). No-op if we never
 * registered this session.
 */
export async function unregisterPush(): Promise<void> {
  if (!registeredToken || !isSupabaseConfigured) return;
  const token = registeredToken;
  registeredToken = null;
  try {
    await supabase.from('device_tokens').delete().eq('token', token);
  } catch {
    /* best-effort; a stale token is pruned server-side on the next 410/UNREGISTERED */
  }
}
