/**
 * appVersion — the installed app's marketing semver + semantic comparison.
 *
 * APP_VERSION is baked at build time from src-tauri/tauri.conf.json `version`
 * (see vite.config.ts `define: { __APP_VERSION__ }`). It is the SAME value
 * @tauri-apps/api/app.getVersion() returns at runtime on native, but synchronous
 * — so it's safe to attach to Supabase request headers at client init and to
 * compare against the remote update config on launch.
 *
 * Comparison is semantic: 1.0.10 is newer than 1.0.2 (segments compared as
 * integers, not strings).
 */

declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) ||
  (import.meta.env.VITE_APP_VERSION as string | undefined) ||
  '1.0.0';

/** -1 if a < b, 0 if equal, 1 if a > b — comparing dotted numeric segments. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** True when `version` is strictly older than `other` (e.g. isOlder('1.0.2', '1.0.10')). */
export function isOlder(version: string, other: string): boolean {
  return compareSemver(version, other) < 0;
}
