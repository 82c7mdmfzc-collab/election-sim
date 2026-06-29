-- cosmetics.sql — server-authoritative cosmetic unlocks.
--
-- Apply in Supabase SQL editor AFTER profiles.sql. Idempotent (create or replace).
--
-- Cosmetics are purely visual. Unlocks are stored as namespaced `cosmetic:<id>`
-- tokens INSIDE the existing `profiles.unlocked_characters` text[] — the client's
-- isCosmeticAvailable() (src/game/cosmetics.ts) checks that prefix, and
-- premiumUnlockCount() (src/game/achievements.ts) only counts real character ids,
-- so the two never collide. The SERVER owns the price catalog so the client cannot
-- spoof a cheaper cost. Mirrors unlock_character() in profiles.sql.
--
-- Catalog MUST match `unlockCost` for every priced cosmetic in
-- src/game/cosmetics.ts and src/game/victoryMessages.ts.

create or replace function public.unlock_cosmetic(p_cosmetic text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare prof public.profiles; v_cost integer; v_token text;
begin
  v_cost := case p_cosmetic
    when 'patriot'   then 3000
    when 'gold'      then 3000
    when 'landslide' then 3000
    when 'humble'    then 3000
    when 'fired_up'  then 3000
    when 'map_math' then 3000
    when 'recount_denied' then 3000
    when 'coalition_chef' then 3000
    when 'swing_state_slayer' then 3000
    when 'mandate_mode' then 3000
    when 'campaign_receipts' then 3000
    else null end;
  if v_cost is null then raise exception 'unlock_cosmetic: unknown cosmetic %', p_cosmetic; end if;

  v_token := 'cosmetic:' || p_cosmetic;
  select * into prof from public.profiles where id = auth.uid() for update;
  if prof.id is null then raise exception 'unlock_cosmetic: no profile'; end if;
  if v_token = any(prof.unlocked_characters) then return prof; end if;            -- already owned (no-op)
  if prof.campaign_funds < v_cost then raise exception 'unlock_cosmetic: insufficient funds'; end if;

  update public.profiles
    set campaign_funds      = campaign_funds - v_cost,
        unlocked_characters = array_append(unlocked_characters, v_token),
        updated_at          = now()
    where id = auth.uid()
    returning * into prof;
  return prof;
end; $$;

revoke execute on function public.unlock_cosmetic(text) from public, anon;
grant  execute on function public.unlock_cosmetic(text) to authenticated;
