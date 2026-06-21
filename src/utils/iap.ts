/**
 * iap.ts — client entry point for real-money purchases.
 *
 * Purchases are NATIVE-ONLY (Apple StoreKit via tauri-plugin-iap). There is no web
 * billing rail: on the website the Shop hides the "Buy Campaign Funds" section and
 * players top up only in the iOS app. The plugin completes the StoreKit purchase and
 * returns the signed-transaction JWS, which we forward to the fulfill-purchase edge
 * function for server-side verification. Grant amounts are owned by supabase/iap.sql;
 * the client can never grant itself anything.
 */
import { supabase, isSupabaseConfigured } from './supabaseClient';

export interface FundsBundle {
  sku: string;
  funds: number;
  /** USD fallback price, shown only until StoreKit's localized price loads. The
   *  authoritative per-territory price lives in App Store Connect. */
  priceLabel: string;
  badge?: string;
  /** Per-bundle coin artwork served from /assets/coins/. */
  imageUrl: string;
}

/** Consumable Campaign Funds bundles shown in the Shop (grants owned by SQL).
 *  SKUs/amounts MUST match supabase/iap.sql (fulfill_purchase) and the App Store
 *  Connect product IDs. Prices are set per-territory in App Store Connect; the Shop
 *  shows StoreKit's localized formattedPrice and falls back to priceLabel (USD). */
export const FUNDS_BUNDLES: readonly FundsBundle[] = [
  { sku: 'funds_1500', funds: 1500, priceLabel: '$2.99', imageUrl: '/assets/coins/funds_1500.png' },
  { sku: 'funds_4000', funds: 4000, priceLabel: '$4.99', imageUrl: '/assets/coins/funds_4000.png' },
  { sku: 'funds_9000', funds: 9000, priceLabel: '$8.99', badge: 'Most popular', imageUrl: '/assets/coins/funds_9000.png' },
  { sku: 'funds_20000', funds: 20000, priceLabel: '$14.99', badge: 'Best value', imageUrl: '/assets/coins/funds_20000.png' },
];

export type IapPlatform = 'web' | 'ios' | 'android' | 'unsupported';

/** Detect the billing rail for the current runtime. */
export function iapPlatform(): IapPlatform {
  if (typeof window === 'undefined') return 'unsupported';
  const isTauri = window.location.protocol.startsWith('tauri');
  if (!isTauri) return 'web';
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'unsupported'; // desktop Tauri has no app-store billing
}

/** True when the native StoreKit billing rail is available. The tauri-plugin-iap
 *  bridge is compiled into the iOS binary, so "running on iOS" ⇒ available. Kept
 *  synchronous because the Shop reads it during render. */
export function nativeIapAvailable(): boolean {
  return iapPlatform() === 'ios';
}

export type PurchaseResult =
  | { status: 'fulfilled'; balance: number | null }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

export async function purchase(sku: string): Promise<PurchaseResult> {
  if (!isSupabaseConfigured) return { status: 'error', message: 'Purchases are not configured.' };
  // Native StoreKit only — there is no web billing rail.
  if (iapPlatform() === 'ios') return purchaseNative('ios', sku);
  return { status: 'unsupported' };
}

async function purchaseNative(platform: 'ios', sku: string): Promise<PurchaseResult> {
  let jws: string;
  try {
    // Dynamic import keeps the native plugin out of the web bundle / module-eval.
    const { purchase: iapPurchase } = await import('@choochmeque/tauri-plugin-iap-api');
    const result = await iapPurchase(sku, 'inapp'); // funds are consumables (StoreKit 'inapp')
    const rep = (result as { jwsRepresentation?: string }).jwsRepresentation;
    if (!rep) return { status: 'error', message: 'Purchase could not be verified on device.' };
    jws = rep;
  } catch (err) {
    // The plugin rejects userCancelled / pending / unverified with a descriptive message.
    return { status: 'error', message: (err as Error)?.message ?? 'Purchase cancelled.' };
  }

  const { data, error } = await supabase.functions.invoke('fulfill-purchase', {
    body: { platform, sku, receipt: jws },
  });
  if (error) return { status: 'error', message: error.message };
  const balance = (data as { balance?: number } | null)?.balance ?? null;
  return { status: 'fulfilled', balance };
}

/** StoreKit's localized price strings (e.g. "£1.99") keyed by SKU, for display.
 *  Returns {} on non-iOS or if the product query fails. */
export async function getFundsPrices(): Promise<Record<string, string>> {
  if (iapPlatform() !== 'ios') return {};
  try {
    const { getProducts } = await import('@choochmeque/tauri-plugin-iap-api');
    const res = await getProducts(FUNDS_BUNDLES.map((b) => b.sku), 'inapp');
    const products = (res as { products?: Array<{ productId: string; formattedPrice?: string }> }).products ?? [];
    const out: Record<string, string> = {};
    for (const p of products) {
      if (p.formattedPrice) out[p.productId] = p.formattedPrice;
    }
    return out;
  } catch {
    return {};
  }
}
