/**
 * iap.ts — client entry point for real-money purchases.
 *
 * Purchases are NATIVE-ONLY (Apple StoreKit / Google Play Billing via
 * tauri-plugin-iap). There is no web billing rail: on the website the Shop hides
 * the "Buy Campaign Funds" section and players top up only in the apps. The plugin
 * completes the store purchase and returns a receipt — StoreKit's signed JWS on
 * iOS, the purchaseToken on Android — which we forward to the fulfill-purchase
 * edge function for server-side verification. Grant amounts are owned by
 * supabase/iap.sql; the client can never grant itself anything.
 *
 * Android extra: funds packs are consumables, and Play Billing purchases must be
 * CONSUMED after the server credits them — an un-consumed purchase blocks
 * re-buying the same pack and is auto-refunded by Google after 3 days. The server
 * defensively acknowledges; the client consumes post-credit, with
 * recoverAndroidPurchases() sweeping up anything interrupted mid-flow.
 */
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { platformKind, type PlatformKind } from './platform';

export interface FundsBundle {
  sku: string;
  funds: number;
  /** USD fallback price, shown only until StoreKit's localized price loads. The
   *  authoritative per-territory price lives in App Store Connect. */
  priceLabel: string;
  /** GBP fallback price, used for UK locales until StoreKit's localized price loads
   *  (mirrors the App Store Connect tiers documented in APPLE_SETUP.md). */
  priceGBP: string;
  badge?: string;
  /** Per-bundle coin artwork served from /assets/coins/. */
  imageUrl: string;
}

/** Consumable Campaign Funds bundles shown in the Shop (grants owned by SQL).
 *  SKUs/amounts MUST match supabase/iap.sql (fulfill_purchase) and the App Store
 *  Connect product IDs. Prices are set per-territory in App Store Connect; the Shop
 *  shows StoreKit's localized formattedPrice and falls back to a locale price (see
 *  localFallbackPrice). The GBP values mirror the tiers in APPLE_SETUP.md. */
export const FUNDS_BUNDLES: readonly FundsBundle[] = [
  { sku: 'funds_600', funds: 600, priceLabel: '$0.99', priceGBP: '£0.99', badge: 'Starter', imageUrl: '/assets/coins/funds_600.png' },
  { sku: 'funds_1500', funds: 1500, priceLabel: '$2.99', priceGBP: '£1.99', imageUrl: '/assets/coins/funds_1500.png' },
  { sku: 'funds_4000', funds: 4000, priceLabel: '$4.99', priceGBP: '£3.99', imageUrl: '/assets/coins/funds_4000.png' },
  { sku: 'funds_9000', funds: 9000, priceLabel: '$8.99', priceGBP: '£7.99', badge: 'Most popular', imageUrl: '/assets/coins/funds_9000.png' },
  { sku: 'funds_20000', funds: 20000, priceLabel: '$14.99', priceGBP: '£14.99', badge: 'Best value', imageUrl: '/assets/coins/funds_20000.png' },
  { sku: 'funds_45000', funds: 45000, priceLabel: '$19.99', priceGBP: '£19.99', badge: 'Most Funds', imageUrl: '/assets/coins/funds_45000.png' },
];

/** True when the runtime looks UK-based. */
function isUKRuntimeRegion(): boolean {
  if (typeof navigator === 'undefined') return false;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  if (langs.some((l) => /-GB$/i.test(l || ''))) return true;

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return [
      'Europe/London',
      'Europe/Belfast',
      'Europe/Guernsey',
      'Europe/Isle_of_Man',
      'Europe/Jersey',
    ].includes(tz);
  } catch {
    return false;
  }
}

function isUsdPrice(price: string): boolean {
  return /^\s*(US\$|\$|USD\b)/i.test(price);
}

/** Display price to show before/without StoreKit's authoritative localized price.
 *  Picks the user's local currency by region so a UK player never flashes USD.
 *  StoreKit's formattedPrice always overrides this when it resolves. */
export function localFallbackPrice(bundle: FundsBundle): string {
  return isUKRuntimeRegion() ? bundle.priceGBP : bundle.priceLabel;
}

/** Final visible price for a funds bundle. StoreKit is normally authoritative, but
 *  TestFlight/sandbox can return USD when the device context is UK. In that case
 *  show the local GBP tier documented for App Store Connect instead. */
export function displayFundsPrice(bundle: FundsBundle, storePrice?: string): string {
  if (storePrice && !(isUKRuntimeRegion() && isUsdPrice(storePrice))) return storePrice;
  return localFallbackPrice(bundle);
}

export type IapPlatform = PlatformKind;

/** Detect the billing rail for the current runtime. Delegates to ./platform. */
export function iapPlatform(): IapPlatform {
  return platformKind();
}

/** True when a native billing rail (StoreKit / Play Billing) is available. The
 *  tauri-plugin-iap bridge is compiled into both mobile binaries, so "running on
 *  iOS/Android" ⇒ available. Kept synchronous because the Shop reads it during
 *  render. */
export function nativeIapAvailable(): boolean {
  const p = iapPlatform();
  return p === 'ios' || p === 'android';
}

export type PurchaseResult =
  | { status: 'fulfilled'; balance: number | null }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

function userFacingPurchaseError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('on conflict')
    || lower.includes('constraint')
    || lower.includes('duplicate key')
    || lower.includes('sql')
    || lower.includes('rpc')
    || lower.includes('function')
  ) {
    return 'Purchase could not be credited. Please contact support if you were charged.';
  }
  if (lower.includes('verification unavailable')) {
    return 'Purchase verification is not available yet. Please try again later.';
  }
  if (lower.includes('verification failed')) {
    return 'Purchase could not be verified. Please try again.';
  }
  return message || 'Purchase could not be completed.';
}

export async function purchase(sku: string): Promise<PurchaseResult> {
  if (!isSupabaseConfigured) return { status: 'error', message: 'Purchases are not configured.' };
  // Native billing only — there is no web billing rail.
  const platform = iapPlatform();
  if (platform === 'ios' || platform === 'android') return purchaseNative(platform, sku);
  return { status: 'unsupported' };
}

async function purchaseNative(platform: 'ios' | 'android', sku: string): Promise<PurchaseResult> {
  // iOS: StoreKit's signed-transaction JWS. Android: the Play purchaseToken.
  let receipt: string;
  try {
    // Dynamic import keeps the native plugin out of the web bundle / module-eval.
    const { purchase: iapPurchase } = await import('@choochmeque/tauri-plugin-iap-api');
    const result = await iapPurchase(sku, 'inapp'); // funds are consumables ('inapp')
    const rep = platform === 'ios'
      ? (result as { jwsRepresentation?: string }).jwsRepresentation
      : (result as { purchaseToken?: string }).purchaseToken;
    if (!rep) return { status: 'error', message: 'Purchase could not be verified on device.' };
    receipt = rep;
  } catch (err) {
    // The plugin rejects userCancelled / pending / unverified with a descriptive message.
    return { status: 'error', message: userFacingPurchaseError((err as Error)?.message ?? 'Purchase cancelled.') };
  }

  const { data, error } = await supabase.functions.invoke('fulfill-purchase', {
    body: { platform, sku, receipt },
  });
  if (error) return { status: 'error', message: userFacingPurchaseError(await edgeErrorMessage(error)) };

  // Android: consume AFTER the server credited, so the pack can be re-bought and
  // Google doesn't auto-refund. On failure the recovery sweep retries — the
  // server's transaction-id idempotency makes the re-POST there harmless.
  if (platform === 'android') {
    try {
      const { consumePurchase } = await import('@choochmeque/tauri-plugin-iap-api');
      await consumePurchase(receipt);
    } catch {
      /* recoverAndroidPurchases() will consume it on the next Shop open */
    }
  }
  const balance = (data as { balance?: number } | null)?.balance ?? null;
  return { status: 'fulfilled', balance };
}

/**
 * Android recovery sweep: re-fulfill and consume any owned-but-unconsumed funds
 * packs. Covers the app being killed between purchase and consume, a failed
 * consume after crediting, and PENDING purchases (slow payment methods) that
 * completed after the original purchase() promise was abandoned. Safe to call
 * often: the server is idempotent per transaction and consuming twice no-ops.
 * Returns how many purchases were re-fulfilled (0 on non-Android / no-op).
 */
export async function recoverAndroidPurchases(): Promise<number> {
  if (iapPlatform() !== 'android' || !isSupabaseConfigured) return 0;
  const known = new Set(FUNDS_BUNDLES.map((b) => b.sku));
  let recovered = 0;
  try {
    const { restorePurchases, consumePurchase, PurchaseState } = await import('@choochmeque/tauri-plugin-iap-api');
    const { purchases } = await restorePurchases('inapp');
    for (const p of purchases) {
      if (p.purchaseState !== PurchaseState.PURCHASED || !known.has(p.productId)) continue;
      const { error } = await supabase.functions.invoke('fulfill-purchase', {
        body: { platform: 'android', sku: p.productId, receipt: p.purchaseToken },
      });
      // Consume ONLY once the server has credited — a consumed-but-uncredited
      // purchase would be unrecoverable.
      if (!error) {
        await consumePurchase(p.purchaseToken);
        recovered += 1;
      }
    }
  } catch {
    /* best-effort; the next Shop open retries */
  }
  return recovered;
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
  if (!nativeIapAvailable()) return {};
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
