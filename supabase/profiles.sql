-- ════════════════════════════════════════════════════════════════════════════
-- 270 — Player Profiles & Meta-Progression (Phase 2 + Phase 5 hardening)
--
-- Apply in Supabase Dashboard → SQL Editor. Idempotent: safe to re-run.
--
-- Stores the cloud-synced progression for a signed-in (or anonymous/guest) user:
-- Campaign Funds, unlocked characters, tutorial flag, settings, and lifetime stats.
--
-- SECURITY MODEL
--   • RLS: a user can read/update ONLY their own row (auth.uid() = id).
--   • Funds & unlocks are NEVER trusted as free-form client writes. They flow
--     through SECURITY DEFINER RPCs that validate/cap server-side:
--       - claim_game_reward(...): server-computed, deduped rewards.
--       - unlock_character(character): server owns the price catalog; atomically
--         checks funds and appends the unlock. The client cannot pick the price.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  campaign_funds      integer  not null default 0,
  unlocked_characters text[]   not null default '{}',
  tutorial_seen       boolean  not null default false,
  settings            jsonb    not null default '{}'::jsonb,
  stats               jsonb    not null default '{}'::jsonb,
  achievement_counters jsonb   not null default '{}'::jsonb,
  daily_streak        jsonb    not null default '{}'::jsonb,
  display_name        text,                         -- permanent, claimed once (see claim_display_name)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Idempotent add for tables that pre-date the display_name column.
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists achievement_counters jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists daily_streak jsonb not null default '{}'::jsonb;

-- Case-insensitive uniqueness for the permanent username. A partial index keeps
-- pre-claim NULLs exempt while guaranteeing no two accounts share a handle.
create unique index if not exists profiles_display_name_lower_uidx
  on public.profiles (lower(display_name)) where display_name is not null;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

-- No direct client UPDATE policy: all profile writes flow through narrow RPCs.
-- This keeps campaign_funds, unlocked_characters, and display_name immutable
-- except through the SECURITY DEFINER functions below.
drop policy if exists profiles_update_own on public.profiles;

-- Auto-create a profile row whenever a new auth user (incl. anonymous) is created.
-- Limited-time promo: accounts created during the July 2026 window are granted the
-- 'washington' character for free (it is purchasable for Funds outside the window —
-- see unlock_character). The window is an explicit, year-bounded UTC range so the
-- "July only" rule is unambiguous (not a bare EXTRACT(MONTH) that recurs yearly).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_july_start constant timestamptz := '2026-07-01 00:00:00+00';
  c_july_end   constant timestamptz := '2026-08-01 00:00:00+00';   -- exclusive
  v_unlocks    text[] := '{}';
begin
  if now() >= c_july_start and now() < c_july_end then
    v_unlocks := array['washington'];
  end if;
  insert into public.profiles (id, unlocked_characters)
  values (new.id, v_unlocks)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Retired RPC: award_funds ──────────────────────────────────────────────────
-- Removed because it let any signed-in client mint capped-but-repeatable funds.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'award_funds'
  ) then
    revoke execute on function public.award_funds(integer) from public, anon, authenticated;
  end if;
end $$;
drop function if exists public.award_funds(integer);

-- ── RPC: update_profile_stats ────────────────────────────────────────────────
-- Persists non-economic lifetime stats. Funds/unlocks/display_name stay owned by
-- claim_game_reward, unlock_character, and claim_display_name respectively.
create or replace function public.update_profile_stats(p_user_id uuid, p_stats jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'update_profile_stats: auth mismatch';
  end if;
  if p_stats is null or jsonb_typeof(p_stats) <> 'object' then
    raise exception 'update_profile_stats: invalid stats';
  end if;
  update public.profiles
    set stats = p_stats, updated_at = now()
    where id = auth.uid();
end; $$;

-- ── RPC: unlock_character ────────────────────────────────────────────────────
-- The SERVER owns the price catalog so the client cannot spoof a low cost.
-- Atomically verifies funds, deducts, and appends the unlock. Returns the row.
create or replace function public.unlock_character(p_character text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare prof public.profiles; v_cost integer; v_unlocks text[];
begin
  v_cost := case p_character
    when 'joe_biden'     then 1500
    when 'ronald_reagan' then 1500
    when 'washington'    then 1500   -- free for July signups; this price applies after the promo window
    else null end;
  if v_cost is null then raise exception 'unlock_character: unknown character %', p_character; end if;

  select * into prof from public.profiles where id = auth.uid() for update;
  if prof.id is null then raise exception 'unlock_character: no profile'; end if;
  if p_character = any(prof.unlocked_characters) then return prof; end if;       -- already owned (no-op)
  if prof.campaign_funds < v_cost then raise exception 'unlock_character: insufficient funds'; end if;
  v_unlocks := array_append(prof.unlocked_characters, p_character);

  update public.profiles
    set campaign_funds      = campaign_funds - v_cost,
        unlocked_characters = v_unlocks,
        achievement_counters = jsonb_set(
          coalesce(achievement_counters, '{}'::jsonb),
          '{premiumUnlocks}',
          to_jsonb((
            select count(*)::integer
            from unnest(v_unlocks) as u(id)
            where u.id in ('joe_biden', 'ronald_reagan', 'washington')
          )),
          true
        ),
        updated_at          = now()
    where id = auth.uid()
    returning * into prof;
  return prof;
end; $$;

-- ── Helper: is_offensive ─────────────────────────────────────────────────────
-- Conservative profanity/slur gate for user-visible usernames (Apple 1.2 /
-- Google UGC moderation). Folds common leetspeak, strips separators (so
-- "f.u.c.k" / "f_u_c_k" collapse), then rejects any name containing a blocked
-- term. Server-authoritative so offensive handles never reach other players; the
-- client (src/utils/sanitize.ts) mirrors a copy for instant feedback. This is a
-- deliberately small baseline list — extend it or swap in a moderation service.
create or replace function public.is_offensive(p_name text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  v text;
  bad text;
  blocklist text[] := array[
    'nigger','nigga','faggot','retard','spic','chink','kike','wetback','coon',
    'beaner','gook','tranny','dyke','cunt','whore','rapist','molest','pedophile',
    'nazi','hitler','fuck','shit','bitch','bastard','asshole','slut','dildo',
    'pussy','cock','dick','prick','twat','porn','jizz','wank','cumshot','blowjob'
  ];
begin
  v := lower(coalesce(p_name, ''));
  v := translate(v, '0134578@$!', 'oieastbasi');  -- leet fold
  v := regexp_replace(v, '[^a-z]', '', 'g');       -- drop separators/digits
  foreach bad in array blocklist loop
    if position(bad in v) > 0 then return true; end if;
  end loop;
  return false;
end; $$;

-- ── RPC: claim_display_name ──────────────────────────────────────────────────
-- Claims the caller's PERMANENT username. One-time only: once set it can never be
-- changed (rejects if already claimed). Validates format + profanity and enforces
-- global, case-insensitive uniqueness server-side. Returns a result code the
-- client maps to UI: 'ok' | 'taken' | 'invalid' | 'already_set'.
create or replace function public.claim_display_name(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_current text;
begin
  -- Format: 3–20 chars, letters/digits/underscore/hyphen only.
  if v_name !~ '^[A-Za-z0-9_-]{3,20}$' then
    return 'invalid';
  end if;

  -- Profanity/slur gate (Apple 1.2 / Google UGC). Treated as 'invalid'.
  if public.is_offensive(v_name) then
    return 'invalid';
  end if;

  select display_name into v_current from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'claim_display_name: no profile'; end if;
  if v_current is not null then return 'already_set'; end if;

  begin
    update public.profiles
      set display_name = v_name, updated_at = now()
      where id = auth.uid();
  exception when unique_violation then
    return 'taken';
  end;
  return 'ok';
end; $$;

-- ── GRANTs — explicit EXECUTE so authenticated clients can call the RPCs ──────
revoke execute on function public.update_profile_stats(uuid, jsonb) from public, anon;
grant execute on function public.update_profile_stats(uuid, jsonb) to authenticated;
revoke execute on function public.unlock_character(text) from public, anon;
grant execute on function public.unlock_character(text)            to authenticated;
revoke execute on function public.claim_display_name(text) from public, anon;
grant execute on function public.claim_display_name(text)          to authenticated;

-- ── RPC: delete_account ──────────────────────────────────────────────────────
-- Lets a signed-in user PERMANENTLY delete their own account and all associated
-- data, satisfying Apple Guideline 5.1.1(v) and Google Play's data-deletion
-- requirement. Deleting the auth.users row cascades to public.profiles (FK is
-- `on delete cascade`) and to every other table whose user/profile FK is declared
-- `on delete cascade` (referrals, lobby membership, reports, etc.) — keep those
-- cascades in place so no data is orphaned. SECURITY DEFINER (owner = postgres)
-- so it may remove the auth.users row; it can only ever delete the CALLER.
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'delete_account: not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end; $$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account()                  to authenticated;
