/**
 * iap.ts — client entry point for real-money purchases.
 *
 * One purchase(sku) API that routes by platform:
 *   • web      → Stripe Checkout (stripe-checkout Edge Function → redirect)
 *   • ios      → native StoreKit via the Tauri IAP plugin → fulfill-purchase
 *   • android  → native Play Billing via the Tauri IAP plugin → fulfill-purchase
 *
 * Funds/characters granted are owned by the server (supabase/iap.sql); the client
 * only initiates the purchase and (native) forwards the signed receipt for
 * server-side verification. It can never grant itself anything.
 */
import { supabase, isSupabaseConfigured } from './supabaseClient';

export interface FundsBundle {
  sku: string;
  funds: number;
  /** Display-only USD price (final price strings live in each store console). */
  priceLabel: string;
  badge?: string;
  /** Per-bundle coin artwork served from /assets/coins/. */
  imageUrl: string;
}

/** Consumable Campaign Funds bundles shown in the Shop (grants owned by SQL).
 *  Amounts/SKUs MUST match supabase/iap.sql (fulfill_purchase) and the web price
 *  catalog in supabase/functions/stripe-checkout/index.ts. */
export const FUNDS_BUNDLES: readonly FundsBundle[] = [
  { sku: 'funds_1500', funds: 1500, priceLabel: '$0.99', imageUrl: '/assets/coins/funds_1500.png' },
  { sku: 'funds_4000', funds: 4000, priceLabel: '$1.99', imageUrl: '/assets/coins/funds_4000.png' },
  { sku: 'funds_8000', funds: 8000, priceLabel: '$3.99', badge: 'Most popular', imageUrl: '/assets/coins/funds_8000.png' },
  { sku: 'funds_12000', funds: 12000, priceLabel: '$5.99', badge: 'Best value', imageUrl: '/assets/coins/funds_12000.png' },
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

/**
 * Native bridge injected by the Tauri IAP plugin (StoreKit / Play Billing).
 * The plugin completes the store purchase and returns the signed receipt for our
 * server to verify. Absent on web / desktop.
 */
interface NativeIap {
  purchase(sku: string): Promise<{ transactionId: string; receipt: string }>;
}
function nativeIap(): NativeIap | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __ELECTOR_IAP__?: NativeIap };
  return w.__ELECTOR_IAP__ ?? null;
}

/** True only when a reviewed StoreKit / Play Billing bridge is actually present. */
export function nativeIapAvailable(): boolean {
  return nativeIap() != null;
}

export type PurchaseResult =
  | { status: 'redirect' } // web: navigating to Stripe Checkout
  | { status: 'fulfilled'; balance: number | null }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

export async function purchase(sku: string): Promise<PurchaseResult> {
  if (!isSupabaseConfigured) return { status: 'error', message: 'Purchases are not configured.' };
  const platform = iapPlatform();
  if (platform === 'web') return purchaseWeb(sku);
  if (platform === 'ios' || platform === 'android') return purchaseNative(platform, sku);
  return { status: 'unsupported' };
}

async function purchaseWeb(sku: string): Promise<PurchaseResult> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', {
    body: {
      sku,
      successUrl: `${window.location.origin}/?purchase=success`,
      cancelUrl: `${window.location.origin}/?purchase=cancel`,
    },
  });
  if (error) return { status: 'error', message: error.message };
  const url = (data as { url?: string } | null)?.url;
  if (!url) return { status: 'error', message: 'Could not start checkout.' };
  window.location.assign(url); // fulfillment happens via the Stripe webhook
  return { status: 'redirect' };
}

async function purchaseNative(platform: 'ios' | 'android', sku: string): Promise<PurchaseResult> {
  const iap = nativeIap();
  if (!iap) return { status: 'unsupported' };

  let receipt: { transactionId: string; receipt: string };
  try {
    receipt = await iap.purchase(sku);
  } catch (err) {
    return { status: 'error', message: (err as Error).message ?? 'Purchase cancelled.' };
  }

  const { data, error } = await supabase.functions.invoke('fulfill-purchase', {
    body: { platform, sku, receipt: receipt.receipt },
  });
  if (error) return { status: 'error', message: error.message };
  const balance = (data as { balance?: number } | null)?.balance ?? null;
  return { status: 'fulfilled', balance };
}
