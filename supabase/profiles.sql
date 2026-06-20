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
    when 'joe_biden'     then 1500
    when 'ronald_reagan' then 1500
    when 'washington'    then 1500
    when 'starmer'       then 1500
    when 'farage'        then 1500
    when 'jfk'           then 1500
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
