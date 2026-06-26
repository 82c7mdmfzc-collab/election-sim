/**
 * platform.ts — single source of truth for runtime platform detection.
 *
 * Elector runs in three places: the website (a normal browser), the iOS app (a
 * Tauri webview served over the tauri: protocol), and — during development —
 * desktop Tauri. Native-only features (haptics, screen transitions, in-app
 * billing, push notifications) gate on these helpers so the *secondary* website
 * is never affected.
 *
 * Previously the same checks were re-implemented in authClient, rewardedAds and
 * iap; those now delegate here.
 */

export type PlatformKind = 'web' | 'ios' | 'android' | 'unsupported';

/** True inside any Tauri native webview (iOS, Android, or desktop Tauri). */
export function isNativeRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  // Production native builds serve over the tauri:// scheme. Dev builds
  // (`tauri ios dev`) serve the frontend over http://localhost, so the scheme
  // check alone misses them — detect the Tauri-injected runtime globals too.
  // These are present in every Tauri webview (dev + prod, all platforms) and
  // absent in a real browser, so the website still resolves to 'web'.
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; isTauri?: boolean };
  return window.location.protocol.startsWith('tauri')
    || typeof w.__TAURI_INTERNALS__ !== 'undefined'
    || w.isTauri === true;
}

/**
 * iOS detection that also catches iPadOS, which reports as desktop Safari/Mac
 * with a touch screen. Independent of the Tauri check, so it works on the web
 * build too (e.g. to tune touch affordances for mobile Safari).
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iphone|ipad|ipod/i.test(ua)
    || (/macintosh|macintel/i.test(`${ua} ${platform}`) && navigator.maxTouchPoints > 1);
}

/** Coarse billing / feature rail for the current runtime. */
export function platformKind(): PlatformKind {
  if (typeof window === 'undefined') return 'unsupported';
  if (!isNativeRuntime()) return 'web';
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'unsupported'; // desktop Tauri has no app-store billing / mobile feel
}

/** True on the native iOS app specifically (where haptics/push are available). */
export function isIOSNative(): boolean {
  return platformKind() === 'ios';
}
