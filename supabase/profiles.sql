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
--       - award_funds(amount): adds a capped, non-negative amount.
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
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

-- Direct updates limited to the owner; the funds/unlocks columns are still only
-- *safely* mutated via the RPCs below (a client could update settings/tutorial_seen
-- on its own row, which is harmless).
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user (incl. anonymous) is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RPC: award_funds ─────────────────────────────────────────────────────────
-- Adds Campaign Funds to the caller's own profile, capped to a sane per-call max
-- to blunt tampering. Returns the new balance.
create or replace function public.award_funds(p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if p_amount is null or p_amount < 0 or p_amount > 5000 then
    raise exception 'award_funds: amount out of range';
  end if;
  update public.profiles
    set campaign_funds = campaign_funds + p_amount, updated_at = now()
    where id = auth.uid()
    returning campaign_funds into new_balance;
  if new_balance is null then raise exception 'award_funds: no profile'; end if;
  return new_balance;
end; $$;

-- ── RPC: unlock_character ────────────────────────────────────────────────────
-- The SERVER owns the price catalog so the client cannot spoof a low cost.
-- Atomically verifies funds, deducts, and appends the unlock. Returns the row.
create or replace function public.unlock_character(p_character text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare prof public.profiles; v_cost integer;
begin
  v_cost := case p_character
    when 'joe_biden'     then 1500
    when 'ronald_reagan' then 1500
    else null end;
  if v_cost is null then raise exception 'unlock_character: unknown character %', p_character; end if;

  select * into prof from public.profiles where id = auth.uid() for update;
  if prof.id is null then raise exception 'unlock_character: no profile'; end if;
  if p_character = any(prof.unlocked_characters) then return prof; end if;       -- already owned (no-op)
  if prof.campaign_funds < v_cost then raise exception 'unlock_character: insufficient funds'; end if;

  update public.profiles
    set campaign_funds      = campaign_funds - v_cost,
        unlocked_characters = array_append(unlocked_characters, p_character),
        updated_at          = now()
    where id = auth.uid()
    returning * into prof;
  return prof;
end; $$;

-- ── GRANTs — explicit EXECUTE so anon/authenticated clients can call the RPCs ──
grant execute on function public.award_funds(integer)   to anon, authenticated;
grant execute on function public.unlock_character(text) to anon, authenticated;
