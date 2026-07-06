// ════════════════════════════════════════════════════════════════════════════
// admin-broadcast — send a custom push notification to every install.
//
// Deploy:  supabase functions deploy admin-broadcast
//
// The standalone admin page (admin/index.html) composes a title/body and invokes
// this function with the signed-in admin's JWT. It:
//   • identifies the caller from their JWT,
//   • authorizes them against the public.app_admins allowlist (the same gate the
//     update-config RPCs use) — service-role key never leaves the server,
//   • reads public.device_tokens (all, or one platform), splits by platform, and
//     fans out via APNs (iOS) + FCM (Android). Both senders fail soft until their
//     secrets exist, so this can ship before the push keys are configured.
//
// SECURITY: writes nothing; only reads device_tokens + prunes dead tokens (done
// inside the senders). A non-admin JWT gets 403. CORS is locked to our own admin
// surfaces (the local admin page reports Origin `null`).
//
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (always present) + the push secrets in _shared/apns.ts (APNS_*) and
// _shared/fcm.ts (FCM_SERVICE_ACCOUNT).
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendApnsPush, apnsConfigured } from '../_shared/apns.ts';
import { sendFcmPush, fcmConfigured } from '../_shared/fcm.ts';

// The admin page runs locally (file:// → Origin "null") or from our own domains.
const ALLOWED_ORIGINS = new Set<string>([
  'null',
  'https://playelector.com',
  'https://www.playelector.com',
  'http://localhost:5174',
  'http://localhost:5173',
]);
const FALLBACK_ORIGIN = 'https://playelector.com';

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

type TargetPlatform = 'ios' | 'android' | 'all';

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'missing auth' }, 401, cors);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identify the caller from their JWT.
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'invalid auth' }, 401, cors);
  const uid = userData.user.id;

  // Authorize against the app_admins allowlist (service role bypasses RLS).
  const admin = createClient(url, serviceKey);
  const { data: adminRow } = await admin
    .from('app_admins')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle();
  if (!adminRow) return json({ error: 'not authorized' }, 403, cors);

  const { title, body, platform, data } = (await req.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    platform?: TargetPlatform;
    data?: Record<string, unknown>;
  };
  if (!title?.trim() || !body?.trim()) return json({ error: 'title and body are required' }, 400, cors);

  const target: TargetPlatform = platform === 'ios' || platform === 'android' ? platform : 'all';
  const alert = { title: title.trim(), body: body.trim(), data: { type: 'broadcast', ...(data ?? {}) } };

  // Fetch the target tokens (owner-agnostic; service role reads all).
  let query = admin.from('device_tokens').select('token, environment, platform');
  if (target !== 'all') query = query.eq('platform', target);
  const { data: tokens, error: tokErr } = await query;
  if (tokErr) return json({ error: tokErr.message }, 500, cors);

  type TokenRow = { token: string; environment: string | null; platform: string };
  const rows = (tokens ?? []) as TokenRow[];
  const iosTokens = rows.filter((t) => t.platform === 'ios');
  const androidTokens = rows.filter((t) => t.platform === 'android');

  // Fan out. Each sender no-ops (returns 0) until its secret is configured.
  const [iosDelivered, androidDelivered] = await Promise.all([
    target !== 'android' ? sendApnsPush(admin, iosTokens, alert) : Promise.resolve(0),
    target !== 'ios' ? sendFcmPush(admin, androidTokens, alert) : Promise.resolve(0),
  ]);

  return json({
    target,
    tokens: { ios: iosTokens.length, android: androidTokens.length },
    delivered: { ios: iosDelivered, android: androidDelivered, total: iosDelivered + androidDelivered },
    configured: { apns: apnsConfigured(), fcm: fcmConfigured() },
  }, 200, cors);
});
