// ════════════════════════════════════════════════════════════════════════════
// apns.ts — Apple Push Notification service helper (shared by edge functions).
//
// Mints an ES256 provider token with the SAME jose pattern as fulfill-purchase,
// then delivers alert pushes over HTTP/2 (Deno fetch negotiates h2 automatically).
//
// FAIL-SOFT: every entry point returns early (no-op) until the APNs secrets are
// configured, so callers can ship the trigger code before the key exists and it
// simply does nothing in the meantime.
//
// Required secrets (Supabase → Project settings → Edge Functions secrets):
//   APNS_KEY_ID       — the APNs Auth Key (.p8) Key ID
//   APPLE_TEAM_ID     — Apple Developer Team ID
//   APNS_PRIVATE_KEY  — contents of the .p8 (PKCS#8 PEM; escaped \n tolerated)
// (APNS_KEY_ID is a DIFFERENT key from the Sign-in and IAP .p8s.)
// ════════════════════════════════════════════════════════════════════════════
import { SignJWT, importPKCS8 } from 'jsr:@panva/jose@6';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const APNS_TOPIC = 'com.playelector.app';

export interface PushAlert {
  title: string;
  body: string;
  /** App-icon badge count to set, if any. */
  badge?: number;
  /** Opaque payload delivered to the app (e.g. { lobbyId }) for tap deep-linking. */
  data?: Record<string, unknown>;
}

interface DeviceToken {
  token: string;
  environment: string | null;
}

// Apple rejects too-frequent provider-token refreshes (TooManyProviderTokenUpdates)
// and accepts a token aged 20–60 min, so reuse one within a warm instance.
let cachedBearer: { jwt: string; mintedAtMs: number } | null = null;

async function apnsBearer(keyId: string, teamId: string, privateKeyPem: string): Promise<string> {
  const nowMs = Date.now();
  if (cachedBearer && nowMs - cachedBearer.mintedAtMs < 50 * 60 * 1000) return cachedBearer.jwt;
  const key = await importPKCS8(privateKeyPem.replace(/\\n/g, '\n'), 'ES256');
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(key);
  cachedBearer = { jwt, mintedAtMs: nowMs };
  return jwt;
}

/** True once the APNs secrets are present. Lets callers bail before any DB query. */
export function apnsConfigured(): boolean {
  return !!(Deno.env.get('APNS_KEY_ID') && Deno.env.get('APPLE_TEAM_ID') && Deno.env.get('APNS_PRIVATE_KEY'));
}

/**
 * Send an alert to a set of device tokens. Best-effort: swallows per-token
 * failures and prunes tokens APNs reports as 410 Unregistered. Returns the
 * delivered count. No-op (0) until configured.
 */
export async function sendApnsPush(
  admin: SupabaseClient,
  tokens: DeviceToken[],
  alert: PushAlert,
): Promise<number> {
  const keyId = Deno.env.get('APNS_KEY_ID');
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const privateKey = Deno.env.get('APNS_PRIVATE_KEY');
  if (!keyId || !teamId || !privateKey || tokens.length === 0) return 0;

  const bearer = await apnsBearer(keyId, teamId, privateKey);
  const body = JSON.stringify({
    aps: {
      alert: { title: alert.title, body: alert.body },
      sound: 'default',
      ...(alert.badge != null ? { badge: alert.badge } : {}),
    },
    ...(alert.data ?? {}),
  });

  let delivered = 0;
  const dead: string[] = [];
  await Promise.all(
    tokens.map(async ({ token, environment }) => {
      const host = environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
      try {
        const resp = await fetch(`https://${host}/3/device/${token}`, {
          method: 'POST',
          headers: {
            authorization: `bearer ${bearer}`,
            'apns-topic': APNS_TOPIC,
            'apns-push-type': 'alert',
            'content-type': 'application/json',
          },
          body,
        });
        if (resp.status === 200) delivered++;
        else if (resp.status === 410) dead.push(token);
        // Drain the body so the connection can be reused / closed cleanly.
        await resp.body?.cancel().catch(() => {});
      } catch {
        /* network error — best-effort, skip this token */
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from('device_tokens').delete().in('token', dead);
  }
  return delivered;
}

/**
 * Look up the device tokens of a lobby's participants (optionally excluding one
 * auth uid — e.g. the caller who just acted, who is foregrounded) and push an
 * alert. Best-effort; safe to call fire-and-forget. No-op until APNs is
 * configured.
 */
export async function pushToLobby(
  admin: SupabaseClient,
  lobbyId: string,
  alert: PushAlert,
  excludeUid?: string,
): Promise<void> {
  if (!apnsConfigured()) return;

  const { data: parts } = await admin
    .from('lobby_participants')
    .select('auth_uid')
    .eq('lobby_id', lobbyId);
  if (!parts || parts.length === 0) return;

  const uids = parts
    .map((p) => p.auth_uid as string)
    .filter((u) => !!u && u !== excludeUid);
  if (uids.length === 0) return;

  const { data: toks } = await admin
    .from('device_tokens')
    .select('token, environment')
    .in('user_id', uids);
  if (!toks || toks.length === 0) return;

  await sendApnsPush(admin, toks as DeviceToken[], alert);
}
