import { isNativeRuntime, platformKind } from './platform';

export const AD_REWARD_MIN = 10;
export const AD_REWARD_MAX = 25;
export const AD_REWARD_LIMIT = 5;
export const AD_REWARD_WINDOW_HOURS = 12;
export const AD_REWARD_WINDOW_MS = AD_REWARD_WINDOW_HOURS * 60 * 60 * 1000;
export const INLINE_AD_SECONDS = 8;

const LOCAL_KEY = 'elector-rewarded-ads-v1';

export interface AdRewardStatus {
  watched: number;
  remaining: number;
  limit: number;
  windowHours: number;
  nextResetAt: string | null;
}

export interface RewardedAdCompletion {
  completed: boolean;
  provider?: string;
  adUnit?: string;
  error?: string;
}

interface RewardedAdBridge {
  showRewardedAd(args: { placement: string }): Promise<boolean | RewardedAdCompletion>;
}

type LocalAdRewards = Record<string, number[]>;

function readLocal(): LocalAdRewards {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: LocalAdRewards = {};
    for (const [userId, values] of Object.entries(parsed)) {
      if (!Array.isArray(values)) continue;
      clean[userId] = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    }
    return clean;
  } catch {
    return {};
  }
}

function writeLocal(next: LocalAdRewards): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function adRewardStatusFromTimestamps(timestamps: readonly number[], now = Date.now()): AdRewardStatus {
  const recent = [...timestamps]
    .filter((ts) => Number.isFinite(ts) && now - ts < AD_REWARD_WINDOW_MS)
    .sort((a, b) => a - b);
  const remaining = Math.max(0, AD_REWARD_LIMIT - recent.length);
  return {
    watched: recent.length,
    remaining,
    limit: AD_REWARD_LIMIT,
    windowHours: AD_REWARD_WINDOW_HOURS,
    nextResetAt: remaining === 0 && recent[0] != null
      ? new Date(recent[0] + AD_REWARD_WINDOW_MS).toISOString()
      : null,
  };
}

export function getLocalAdRewardStatus(userId: string | null, now = Date.now()): AdRewardStatus {
  if (!userId) return adRewardStatusFromTimestamps([], now);
  const all = readLocal();
  return adRewardStatusFromTimestamps(all[userId] ?? [], now);
}

export function recordLocalAdReward(userId: string, now = Date.now()): AdRewardStatus {
  const all = readLocal();
  const nextEvents = [...(all[userId] ?? []), now].filter((ts) => now - ts < AD_REWARD_WINDOW_MS);
  all[userId] = nextEvents;
  writeLocal(all);
  return adRewardStatusFromTimestamps(nextEvents, now);
}

export function mergeAdRewardStatus(remote: AdRewardStatus | null, local: AdRewardStatus): AdRewardStatus {
  if (!remote) return local;
  return remote;
}

function bridge(): RewardedAdBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    __ELECTOR_ADS__?: RewardedAdBridge;
    ElectorAds?: RewardedAdBridge;
  };
  return w.__ELECTOR_ADS__ ?? w.ElectorAds ?? null;
}

export function nativeRewardedAdsAvailable(): boolean {
  const kind = platformKind();
  return import.meta.env.VITE_ENABLE_NATIVE_REWARDED_ADS === 'true'
    && isNativeRuntime()
    && (kind === 'ios' || kind === 'android');
}

export function rewardedAdBridgeAvailable(): boolean {
  return bridge() != null || nativeRewardedAdsAvailable();
}

export function inlineRewardedAdsEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ENABLE_INLINE_REWARDED_ADS === 'true';
}

export async function showRewardedAd(placement = 'shop'): Promise<RewardedAdCompletion> {
  const ads = bridge();
  if (!ads) return showNativeRewardedAd(placement);
  try {
    const result = await ads.showRewardedAd({ placement });
    if (typeof result === 'boolean') return { completed: result };
    return { completed: Boolean(result.completed), provider: result.provider, adUnit: result.adUnit, error: result.error };
  } catch (err) {
    return {
      completed: false,
      error: err instanceof Error ? err.message : 'The ad could not be shown.',
    };
  }
}

async function showNativeRewardedAd(placement: string): Promise<RewardedAdCompletion> {
  if (!nativeRewardedAdsAvailable()) {
    return { completed: false, error: 'No rewarded ad bridge is installed.' };
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<RewardedAdCompletion>('plugin:elector-admob|show_rewarded_ad', {
      payload: { placement },
    });
  } catch (err) {
    return {
      completed: false,
      provider: 'admob',
      error: err instanceof Error ? err.message : 'The ad could not be shown.',
    };
  }
}
