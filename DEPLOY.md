# 270 — Security & Deployment (Phase 5)

This is the pre-ship checklist for the v1.0 release covering Supabase hardening,
client hygiene, and shipping to web (Vercel) + desktop/mobile (Tauri).

## 1. Supabase hardening

### Apply the profiles schema
Run [`supabase/profiles.sql`](supabase/profiles.sql) in **Dashboard → SQL Editor**.
It is idempotent. It creates:
- `public.profiles` (keyed by `auth.uid()`) with **RLS: owner-only** read/insert/update.
- A trigger that auto-creates a profile row for every new auth user (incl. anonymous guests).
- `award_funds(amount)` — `SECURITY DEFINER`, caps each grant at 5000 to limit tampering.
- `unlock_character(character)` — `SECURITY DEFINER`; the **server owns the price catalog**,
  so a client can never spoof a cheap unlock. Keep its `CASE` price list in sync with
  `unlockCost` in `src/game/candidates.ts`.

### Enable anonymous sign-ins
Dashboard → Authentication → Providers → **Anonymous** = ON. This lets guests play and
earn progression immediately; `sendMagicLink` later links an email to the same uid so
funds/unlocks carry over (`src/utils/authClient.ts`).

### Audit the existing lobby RPCs
Review `submit_turn_pending` and `join_lobby_player` (created during the multiplayer
milestone) so that:
- a player can only submit/join **as themselves** (validate `p_player_id` / player id), and
- only into a lobby they belong to.
Confirm `lobbies` has RLS appropriate to a public-room model (read for participants, writes via RPC).

### Keys
- Only the **publishable anon key** (`VITE_SUPABASE_ANON_KEY`) ships to the client — by design.
  `git grep -i service_role` must return nothing in `src/`.
- The service-role key (if ever needed for server functions) lives **only** in Vercel env, never in the bundle.

## 2. Client / session hygiene
- Display names are length-capped and run through `sanitizeName` (`src/utils/sanitize.ts`)
  before entering shared state (strips control chars + angle brackets). React escapes on render.
- Auth tokens use Supabase's own storage; `sessionStore` only holds non-secret lobby/player ids.
- **Tauri CSP** (`src-tauri/tauri.conf.json`) `connect-src` allows `https://*.supabase.co` +
  `wss://*.supabase.co` (realtime) and nothing broader.

## 3. Ship

### Web (Vercel)
1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel → Settings → Environment Variables
   (do **not** commit `.env.local`).
2. `npm run build` → deploy. SPA rewrite is already in [`vercel.json`](vercel.json).

### Desktop / mobile (Tauri)
- Version is bumped to `1.0.0` in `package.json` and `src-tauri/tauri.conf.json`.
- Desktop: `npm run tauri:build` (macOS/Windows).
- Mobile: `npm run tauri:ios:build` / `npm run tauri:android:build`.
- Add code-signing / notarization credentials before store submission (heaviest item).

### Pre-ship gate
```
npm run test     # Vitest — engine, rewards, bot, sanitize
npm run lint     # ESLint clean
npm run build    # tsc -b + vite build
```
Update `test_puppeteer.js` for the new menu flow (mode-select → vs Bot / Shop) and smoke it.
