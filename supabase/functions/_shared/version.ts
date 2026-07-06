// _shared/version.ts — forced-update guard for edge functions.
//
// The client attaches `x-app-version` / `x-platform` headers to every Supabase
// request (see src/utils/supabaseClient.ts). guardVersion() reads them, compares
// against the platform's minimum_version in public.app_config, and returns a 426
// { code: 'UPDATE_REQUIRED' } response when the caller is too old — so an
// out-of-date build is refused server-side even if it evades the client gate.
//
// Fails OPEN (returns null) when the headers are absent, the platform is not
// ios/android, or the config lookup errors — the client gate is the primary UX,
// and we never want a config blip to break live multiplayer/purchases.

import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Semantic `a >= b` over dotted numeric segments (so 1.0.10 >= 1.0.2). Fails open. */
function verGe(a: string, b: string): boolean {
  try {
    const pa = a.split('.').map((n) => parseInt(n, 10));
    const pb = b.split('.').map((n) => parseInt(n, 10));
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] ?? 0;
      const y = pb[i] ?? 0;
      if (Number.isNaN(x) || Number.isNaN(y)) return true; // unparseable → fail open
      if (x !== y) return x > y;
    }
    return true; // equal
  } catch {
    return true;
  }
}

// Per-cold-start cache of platform → minimum_version, refreshed every 60s so a
// newly-published minimum takes effect quickly without a DB read per request.
const MIN_TTL_MS = 60_000;
let cache: { at: number; mins: Record<string, string> } | null = null;

async function minimumFor(platform: string): Promise<string | null> {
  const now = Date.now();
  if (!cache || now - cache.at > MIN_TTL_MS) {
    try {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { data } = await admin.from('app_config').select('platform, minimum_version');
      const mins: Record<string, string> = {};
      for (const row of data ?? []) mins[row.platform as string] = row.minimum_version as string;
      cache = { at: now, mins };
    } catch {
      return null; // fail open
    }
  }
  return cache?.mins[platform] ?? null;
}

/**
 * Returns a 426 Response when the caller's app version is below the platform
 * minimum, or null when the request should proceed. `cors` is the caller's CORS
 * header map (each edge function builds its own).
 */
export async function guardVersion(
  req: Request,
  cors: Record<string, string>,
): Promise<Response | null> {
  const platform = req.headers.get('x-platform') ?? '';
  const version = req.headers.get('x-app-version') ?? '';
  if ((platform !== 'ios' && platform !== 'android') || !version) return null;

  const min = await minimumFor(platform);
  if (!min) return null;

  if (!verGe(version, min)) {
    return new Response(
      JSON.stringify({ code: 'UPDATE_REQUIRED', message: 'This version of Elector is no longer supported.' }),
      { status: 426, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
  return null;
}
