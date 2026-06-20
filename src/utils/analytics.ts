import posthog from 'posthog-js';
import { isNativeRuntime } from './authClient';

type Platform = 'web' | 'ios' | 'android' | 'tauri_desktop' | 'unknown';
type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsProps = Record<string, AnalyticsValue>;

const key = (import.meta.env.VITE_POSTHOG_KEY as string | undefined) ?? '';
const host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com';
const appVersion = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '1.0.0';
const enabled = Boolean(key);

let initialized = false;
let isAccount = false;
const gameStartedAt = new Map<string, number>();

function platform(): Platform {
  if (typeof window === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (isNativeRuntime()) {
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/android/i.test(ua)) return 'android';
    return 'tauri_desktop';
  }
  return 'web';
}

function environment(): 'production' | 'development' {
  return import.meta.env.PROD ? 'production' : 'development';
}

function routeSurface(): string {
  if (typeof window === 'undefined') return 'unknown';
  const path = window.location.pathname;
  if (path === '/' || path === '') return 'app';
  return path.split('/').filter(Boolean)[0] ?? 'app';
}

function cleanProps(props: AnalyticsProps = {}): AnalyticsProps {
  const clean: AnalyticsProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    clean[k] = typeof v === 'string' ? v.slice(0, 120) : v;
  }
  return clean;
}

function baseProps(): AnalyticsProps {
  return {
    platform: platform(),
    app_version: appVersion,
    is_account: isAccount,
    native_runtime: isNativeRuntime(),
    environment: environment(),
    route_surface: routeSurface(),
  };
}

export function initAnalytics(): void {
  if (!enabled || initialized || typeof window === 'undefined') return;
  try {
    posthog.init(key, {
      api_host: host,
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: false,
      capture_pageleave: false,
      persistence: 'memory',
      person_profiles: 'identified_only',
    });
    initialized = true;
  } catch (e) {
    console.warn('[analytics] init failed:', e);
  }
}

export function track(event: string, props?: AnalyticsProps): void {
  if (!enabled) return;
  initAnalytics();
  if (!initialized) return;
  posthog.capture(event, { ...baseProps(), ...cleanProps(props) });
}

export function identifyAccount(userId: string): void {
  if (!enabled || !userId) return;
  initAnalytics();
  if (!initialized) return;
  isAccount = true;
  posthog.identify(userId, { is_account: true });
}

export function resetAnalyticsIdentity(): void {
  isAccount = false;
  if (!enabled || !initialized) return;
  posthog.reset();
}

export function setAnalyticsAccountState(next: boolean): void {
  isAccount = next;
}

export function markGameStarted(gameId: string | null, now = Date.now()): void {
  if (!gameId) return;
  gameStartedAt.set(gameId, now);
}

export function gameDurationSeconds(gameId: string | null, now = Date.now()): number | null {
  if (!gameId) return null;
  const started = gameStartedAt.get(gameId);
  if (!started) return null;
  return Math.max(0, Math.round((now - started) / 1000));
}

export function clearGameTiming(gameId: string | null): void {
  if (!gameId) return;
  gameStartedAt.delete(gameId);
}
