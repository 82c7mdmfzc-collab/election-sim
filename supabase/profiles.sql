-- profiles.sql — surgical catalog update.
--
-- The base profiles schema (table, handle_new_user, claim_display_name, …) already
-- lives in the live database. This file intentionally contains ONLY the one function
-- that needs to change when the purchasable roster grows, so re-applying it on deploy
-- is a safe, idempotent `create or replace` that touches nothing else.
--
-- ── RPC: unlock_character ────────────────────────────────────────────────────
-- The SERVER owns the price catalog so the client cannot spoof a low cost.
-- Atomically verifies funds, deducts, and appends the unlock. Returns the row.
-- Catalog must match `unlockCost` for every premium character in
-- src/game/candidates.ts (and the resolve-turn engine copy).
create or replace function public.unlock_character(p_character text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare prof public.profiles; v_cost integer;
begin
  v_cost := case p_character
    -- 'joe_biden' is now a free founding candidate (no purchase path) — see is_free_candidate().
    when 'ronald_reagan' then 4500
    when 'washington'    then 4500
    when 'starmer'       then 4500
    when 'jfk'           then 4500
    when 'farage'        then 10000
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

revoke execute on function public.unlock_character(text) from public, anon;
grant  execute on function public.unlock_character(text) to anon, authenticated;

-- ── RPC: claim_free_character ────────────────────────────────────────────────
-- Time-limited FREE claim (George Washington, July only). The SERVER owns the
-- "is it free right now?" rule so the client cannot spoof the month. Grants the
-- character for 0 funds; idempotent if already owned. Mirrors
-- isCandidateFreeClaimAvailable() in src/game/promos.ts.
create or replace function public.claim_free_character(p_character text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare prof public.profiles;
begin
  if p_character <> 'washington' then
    raise exception 'claim_free_character: % is not claimable', p_character;
  end if;
  if extract(month from (now() at time zone 'utc')) <> 7 then
    raise exception 'claim_free_character: not available outside July';
  end if;

  select * into prof from public.profiles where id = auth.uid() for update;
  if prof.id is null then raise exception 'claim_free_character: no profile'; end if;
  if p_character = any(prof.unlocked_characters) then return prof; end if;       -- already owned (no-op)

  update public.profiles
    set unlocked_characters = array_append(unlocked_characters, p_character),
        updated_at          = now()
    where id = auth.uid()
    returning * into prof;
  return prof;
end; $$;

revoke execute on function public.claim_free_character(text) from public, anon;
grant  execute on function public.claim_free_character(text) to authenticated;
