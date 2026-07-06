-- ════════════════════════════════════════════════════════════════════════════
-- app_config.sql — remote forced-update / version-gate config (server-owned).
--
-- Apply order: FIRST (before profiles). It has no dependencies of its own (only
-- auth.users), but it DEFINES assert_app_supported(), which the guarded write RPCs
-- in profiles/lobbies/season/rewards call — plpgsql validates that reference at
-- CREATE, so this file must be applied before them (see deploy-db.yml). Idempotent
-- (create-or-replace / if-not-exists / on-conflict-do-nothing) so a redeploy never
-- clobbers values an admin has changed live via the standalone admin page.
--
-- DESIGN
--   The SERVER owns the update policy per platform: latest / minimum-supported
--   version, a force-update kill switch, a soft-update nudge, the store URL, and a
--   message. The client fetches get_app_config() on launch + resume and compares
--   against its installed marketing semver (1.0.10 > 1.0.2). Defense-in-depth:
--   assert_app_supported() lets the security-critical write RPCs (and the edge
--   functions, via their own header check) refuse an out-of-date build even if it
--   evades the client gate.
--
--   Admin writes are gated by the app_admins allowlist (the first admin primitive
--   in this codebase) — no service-role key ever touches the admin page.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Config store (one row per platform) ───────────────────────────────────────
create table if not exists public.app_config (
  platform        text primary key,                 -- 'ios' | 'android'
  latest_version  text not null,
  minimum_version text not null,
  force_update    boolean not null default false,   -- global kill switch: hard-wall EVERYTHING
  soft_update     boolean not null default false,   -- optional "update available" nudge
  update_url      text not null,
  message         text not null default '',
  updated_at      timestamptz not null default now()
);
alter table public.app_config enable row level security;  -- reads go through the RPC below; no direct table access

-- Seed both platforms. on-conflict-do-nothing keeps live admin edits intact across redeploys.
insert into public.app_config (platform, latest_version, minimum_version, update_url, message)
values
  ('ios',     '1.0.0', '1.0.0', 'https://apps.apple.com/app/elector/id6782414544', ''),
  ('android', '1.0.0', '1.0.0', 'https://play.google.com/store/apps/details?id=com.playelector.app', '')
on conflict (platform) do nothing;

-- ── Admin allowlist (first is_admin primitive) ────────────────────────────────
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_admins enable row level security;  -- membership checked only inside SECURITY DEFINER fns

-- One-time seed: promote the developer account to admin by email. Safe to re-run.
-- ⚠️  Replace the email below with the admin account's email before deploying.
insert into public.app_admins (user_id)
  select id from auth.users where email = 'cherrypeetoom1@gmail.com'
on conflict (user_id) do nothing;

-- ── Semantic version compare ─────────────────────────────────────────────────
-- a >= b, comparing dotted numeric segments (Postgres int[] compares lexically,
-- so {1,0,10} > {1,0,2}). Fails OPEN (returns true) on any unparseable input so a
-- weird version string can never wrongly lock a user out.
create or replace function public._ver_ge(a text, b text)
returns boolean language plpgsql immutable set search_path = public as $$
begin
  if a is null or b is null then return true; end if;
  return string_to_array(a, '.')::int[] >= string_to_array(b, '.')::int[];
exception when others then
  return true;
end; $$;

-- ── get_app_config ────────────────────────────────────────────────────────────
-- Public read (callable before sign-in). Returns the flat shape the client wants,
-- or null when the platform has no row.
create or replace function public.get_app_config(p_platform text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_row public.app_config;
begin
  select * into v_row from public.app_config where platform = p_platform;
  if v_row.platform is null then return null; end if;
  return jsonb_build_object(
    'latestVersion',           v_row.latest_version,
    'minimumSupportedVersion', v_row.minimum_version,
    'forceUpdate',             v_row.force_update,
    'softUpdate',              v_row.soft_update,
    'updateUrl',               v_row.update_url,
    'message',                 v_row.message
  );
end; $$;

revoke execute on function public.get_app_config(text) from public;
grant  execute on function public.get_app_config(text) to anon, authenticated;

-- ── assert_app_supported (defense-in-depth guard for write RPCs) ──────────────
-- Reads the x-app-version / x-platform request headers (sent by the client on
-- every Supabase call) and raises UPDATE_REQUIRED when the caller is below the
-- platform minimum. Fails OPEN when the headers are absent or the platform is not
-- ios/android (the website, server-to-server calls, and legacy header-less
-- clients are never blocked here — the client gate is the primary UX).
create or replace function public.assert_app_supported()
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_headers   json;
  v_version   text;
  v_platform  text;
  v_min       text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return;  -- no request context / unparseable → fail open
  end;
  if v_headers is null then return; end if;

  v_platform := v_headers ->> 'x-platform';
  v_version  := v_headers ->> 'x-app-version';
  if v_platform not in ('ios', 'android') or v_version is null then return; end if;

  select minimum_version into v_min from public.app_config where platform = v_platform;
  if v_min is null then return; end if;

  if not public._ver_ge(v_version, v_min) then
    raise exception 'UPDATE_REQUIRED' using errcode = 'P0001';
  end if;
end; $$;

revoke execute on function public.assert_app_supported() from public;
grant  execute on function public.assert_app_supported() to anon, authenticated;

-- ── Admin read/write (gated by app_admins) ────────────────────────────────────
create or replace function public._require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null
     or not exists (select 1 from public.app_admins where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
end; $$;

create or replace function public.admin_get_app_config()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(to_jsonb(c) order by c.platform), '[]'::jsonb) into v_rows
    from public.app_config c;
  return v_rows;
end; $$;

create or replace function public.admin_set_app_config(
  p_platform text,
  p_latest   text,
  p_minimum  text,
  p_force    boolean,
  p_soft     boolean,
  p_message  text,
  p_update_url text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_platform not in ('ios', 'android') then raise exception 'invalid platform'; end if;

  insert into public.app_config
    (platform, latest_version, minimum_version, force_update, soft_update, message, update_url, updated_at)
  values
    (p_platform, p_latest, p_minimum, coalesce(p_force, false), coalesce(p_soft, false),
     coalesce(p_message, ''),
     coalesce(p_update_url, 'https://apps.apple.com/app/elector/id6782414544'), now())
  on conflict (platform) do update set
    latest_version  = excluded.latest_version,
    minimum_version = excluded.minimum_version,
    force_update    = excluded.force_update,
    soft_update     = excluded.soft_update,
    message         = excluded.message,
    -- keep the existing store URL when the caller omits it
    update_url      = coalesce(p_update_url, public.app_config.update_url),
    updated_at      = now();

  return public.admin_get_app_config();
end; $$;

revoke execute on function public.admin_get_app_config()                               from public, anon;
revoke execute on function public.admin_set_app_config(text,text,text,boolean,boolean,text,text) from public, anon;
grant  execute on function public.admin_get_app_config()                               to authenticated;
grant  execute on function public.admin_set_app_config(text,text,text,boolean,boolean,text,text) to authenticated;
