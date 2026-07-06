/**
 * appConfig — fetch the remote forced-update config for this platform.
 *
 * Mirrors the getSeasonStatusRemote() pattern (game/profile.ts): guard on
 * isSupabaseConfigured, one RPC, normalize, graceful null. A short-lived
 * localStorage cache lets a returning user's gate paint instantly and provides an
 * offline fallback — but the driver hook always re-fetches on launch/resume, so a
 * stale cache can never mask a newly-published force update for long.
 */

import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';
import { platformKind } from '../utils/platform';
import type { AppUpdateConfig } from '../utils/updateGate';

const CACHE_KEY = 'elector.appConfig.v1';

function normalize(data: unknown): AppUpdateConfig | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  const bool = (v: unknown) => v === true;
  const min = str(d.minimumSupportedVersion, '0.0.0');
  const latest = str(d.latestVersion, min);
  return {
    latestVersion: latest,
    minimumSupportedVersion: min,
    forceUpdate: bool(d.forceUpdate),
    softUpdate: bool(d.softUpdate),
    updateUrl: str(d.updateUrl),
    message: str(d.message),
  };
}

/** Last successfully-fetched config (any age). Used to paint instantly + offline. */
export function getCachedConfig(): AppUpdateConfig | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCache(cfg: AppUpdateConfig): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cfg));
  } catch {
    /* private mode / quota — cache is best-effort */
  }
}

/**
 * Fetch the current config from the server. Returns null on the web/desktop (no
 * store gate there) or when Supabase isn't configured. Falls back to the cached
 * value on network failure so an offline launch still honors the last-known
 * policy (including a cached force update).
 */
export async function fetchAppConfig(): Promise<AppUpdateConfig | null> {
  const platform = platformKind();
  if (platform !== 'ios' && platform !== 'android') return null;
  if (!isSupabaseConfigured) return getCachedConfig();
  try {
    const { data, error } = await supabase.rpc('get_app_config', { p_platform: platform });
    if (error) return getCachedConfig();
    const cfg = normalize(data);
    if (cfg) writeCache(cfg);
    return cfg ?? getCachedConfig();
  } catch {
    return getCachedConfig();
  }
}
