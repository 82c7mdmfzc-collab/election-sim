// ════════════════════════════════════════════════════════════════════════════
// fcm.ts — Firebase Cloud Messaging (Android push) helper, shared by edge fns.
//
// Mirrors apns.ts: fail-soft (no-op until the secret is configured), best-effort
// per-token delivery, prunes tokens FCM reports as UNREGISTERED. Uses the FCM
// HTTP v1 API with an OAuth2 access token minted from a Firebase service account
// (RFC 7523 JWT-bearer grant, the same pattern as fulfill-purchase's Play auth).
//
// Required secret (Supabase → Project settings → Edge Functions secrets):
//   FCM_SERVICE_ACCOUNT — the Firebase service-account JSON (the whole file's
//                         contents). project_id is read from the JSON itself, so
//                         no separate project-id secret is needed.
// ════════════════════════════════════════════════════════════════════════════
import { SignJWT, importPKCS8 } from 'jsr:@panva/jose@6';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface PushAlert {
  title: string;
  body: string;
  /** Opaque string map delivered to the app for tap handling. */
  data?: Record<string, unknown>;
}

interface DeviceToken {
  token: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

// FCM OAuth tokens live ~1h; reuse one within a warm instance.
let cachedBearer: { jwt: string; mintedAtMs: number } | null = null;

async function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  const nowMs = Date.now();
  if (cachedBearer && nowMs - cachedBearer.mintedAtMs < 50 * 60 * 1000) return cachedBearer.jwt;

  const key = await importPKCS8(sa.private_key.replace(/\\n/g, '\n'), 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!resp.ok) throw new Error(`FCM OAuth token exchange failed: ${resp.status}`);
  const { access_token } = (await resp.json()) as { access_token?: string };
  if (!access_token) throw new Error('FCM OAuth token exchange returned no token');
  cachedBearer = { jwt: access_token, mintedAtMs: nowMs };
  return access_token;
}

/** True once the FCM secret is present. Lets callers bail before any DB query. */
export function fcmConfigured(): boolean {
  return !!Deno.env.get('FCM_SERVICE_ACCOUNT');
}

/** FCM data payload values must be strings — coerce the opaque map. */
function stringifyData(data?: Record<string, unknown>): Record<string, string> | undefined {
  if (!data) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/**
 * Send an alert to a set of FCM registration tokens. Best-effort: swallows
 * per-token failures and prunes tokens FCM reports as UNREGISTERED/NOT_FOUND.
 * Returns the delivered count. No-op (0) until configured.
 */
export async function sendFcmPush(
  admin: SupabaseClient,
  tokens: DeviceToken[],
  alert: PushAlert,
): Promise<number> {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw || tokens.length === 0) return 0;

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw) as ServiceAccount;
  } catch {
    return 0; // malformed secret — fail soft
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) return 0;

  const bearer = await fcmAccessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const data = stringifyData(alert.data);

  let delivered = 0;
  const dead: string[] = [];
  await Promise.all(
    tokens.map(async ({ token }) => {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: alert.title, body: alert.body },
              ...(data ? { data } : {}),
            },
          }),
        });
        if (resp.ok) {
          delivered++;
          await resp.body?.cancel().catch(() => {});
          return;
        }
        // A stale/unregistered token returns 404 with errorCode UNREGISTERED.
        const errText = await resp.text().catch(() => '');
        if (resp.status === 404 || /UNREGISTERED|NOT_FOUND/.test(errText)) dead.push(token);
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
