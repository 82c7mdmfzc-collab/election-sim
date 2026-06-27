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
import { platformKind, type PlatformKind } from './platform';

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
  { sku: 'funds_600', funds: 600, priceLabel: '$0.99', badge: 'Starter', imageUrl: '/assets/coins/funds_600.png' },
  { sku: 'funds_1500', funds: 1500, priceLabel: '$2.99', imageUrl: '/assets/coins/funds_1500.png' },
  { sku: 'funds_4000', funds: 4000, priceLabel: '$4.99', imageUrl: '/assets/coins/funds_4000.png' },
  { sku: 'funds_9000', funds: 9000, priceLabel: '$8.99', badge: 'Most popular', imageUrl: '/assets/coins/funds_9000.png' },
  { sku: 'funds_20000', funds: 20000, priceLabel: '$14.99', badge: 'Best value', imageUrl: '/assets/coins/funds_20000.png' },
  { sku: 'funds_45000', funds: 45000, priceLabel: '$19.99', badge: 'Most Funds', imageUrl: '/assets/coins/funds_45000.png' },
];

export type IapPlatform = PlatformKind;

/** Detect the billing rail for the current runtime. Delegates to ./platform. */
export function iapPlatform(): IapPlatform {
  return platformKind();
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
  if (error) return { status: 'error', message: await edgeErrorMessage(error) };
  const balance = (data as { balance?: number } | null)?.balance ?? null;
  return { status: 'fulfilled', balance };
}

/** Extract the real reason from a supabase-js FunctionsHttpError. On a non-2xx the
 *  default `error.message` is the useless "Edge Function returned a non-2xx status
 *  code" — the actual `{ error }` body is hidden behind `error.context` (a Response).
 *  Pull it out so the Shop shows e.g. "purchase verification failed" instead. */
async function edgeErrorMessage(error: unknown): Promise<string> {
  const fallback = (error as { message?: string })?.message ?? 'Purchase could not be completed.';
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = await (ctx as Response).clone().json();
      if (body && typeof body.error === 'string') return body.error;
    } catch {
      /* body wasn't JSON — keep the fallback */
    }
  }
  return fallback;
}

/** StoreKit's localized price strings (e.g. "£1.99") keyed by SKU, for display.
 *  The formattedPrice Apple returns is already in the user's storefront currency,
 *  so the displayed price is location-based with no currency logic on our side.
 *
 *  StoreKit loads products asynchronously and a cold first query (right after the
 *  Shop mounts) often returns an empty list before the catalog is ready — which
 *  previously left the UI showing the hardcoded USD fallback (e.g. "$8.99" to a UK
 *  user). So we retry with a short backoff until products resolve. Returns {} on
 *  non-iOS or if every attempt comes back empty (e.g. offline). */
export async function getFundsPrices(): Promise<Record<string, string>> {
  if (iapPlatform() !== 'ios') return {};
  const skus = FUNDS_BUNDLES.map((b) => b.sku);
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const ATTEMPTS = 6;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const { getProducts } = await import('@choochmeque/tauri-plugin-iap-api');
      const res = await getProducts(skus, 'inapp');
      const products = (res as { products?: Array<{ productId: string; formattedPrice?: string }> }).products ?? [];
      const out: Record<string, string> = {};
      for (const p of products) {
        if (p.formattedPrice) out[p.productId] = p.formattedPrice;
      }
      if (Object.keys(out).length > 0) return out;
    } catch {
      // fall through to retry
    }
    if (attempt < ATTEMPTS - 1) await delay(400 * (attempt + 1)); // 0.4s, 0.8s, … ~8.4s total
  }
  return {};
}
