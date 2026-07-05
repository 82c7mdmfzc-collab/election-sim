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

-- Equipped profile banner (a `profile_banner` cosmetic id, or '' for none). Unlike
-- share frames / map themes (device-local), banners are shown to OTHER players on
-- the leaderboard + profile modal, so the equipped choice must live on the row.
alter table public.profiles add column if not exists equipped_banner text not null default '';

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
    -- map_theme cosmetics (render surface: game/mapTheme.ts)
    when 'theme_dusk'   then 800
    when 'theme_marble' then 1200
    -- profile_banner cosmetics (render surface: components/ProfileBanner.tsx)
    when 'banner_laurel' then 500
    when 'banner_stars'  then 800
    -- NOTE: season-exclusive ids (theme_midnight_gold, banner_circuit/coalition/
    -- gilded/s1_champion, campaign_trail) are deliberately absent — they are granted
    -- only by the Season pass (supabase/season.sql), never bought here.
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

-- ── set_equipped_banner ───────────────────────────────────────────────────────
-- Equip (or clear, with '') a profile_banner the player already owns. Server
-- validates ownership so a client can't equip an un-earned banner; '' always
-- allowed (un-equip). Returns the updated profile row.
create or replace function public.set_equipped_banner(p_banner text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare prof public.profiles; v_token text;
begin
  select * into prof from public.profiles where id = auth.uid() for update;
  if prof.id is null then raise exception 'set_equipped_banner: no profile'; end if;

  if coalesce(p_banner, '') <> '' then
    v_token := 'cosmetic:' || p_banner;
    if not (v_token = any(prof.unlocked_characters)) then
      raise exception 'set_equipped_banner: banner % not owned', p_banner;
    end if;
  end if;

  update public.profiles
    set equipped_banner = coalesce(p_banner, ''),
        updated_at      = now()
    where id = auth.uid()
    returning * into prof;
  return prof;
end; $$;

revoke execute on function public.set_equipped_banner(text) from public, anon;
grant  execute on function public.set_equipped_banner(text) to authenticated;

-- ── Avatar preset ─────────────────────────────────────────────────────────────
-- Chosen profile picture ('' = initials monogram). Free presets (flags / US states /
-- patterns; see src/game/avatars.ts), so — unlike banners — there is no ownership
-- gate. Server-owned like equipped_banner because OTHER players see it (leaderboard,
-- multiplayer, profile modal). Validated to the known id shape so a client can't
-- stash arbitrary text that everyone else would then render.
alter table public.profiles add column if not exists avatar text not null default '';

create or replace function public.set_avatar(p_avatar text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare prof public.profiles; v_avatar text;
begin
  v_avatar := coalesce(p_avatar, '');
  if v_avatar <> '' and v_avatar !~ '^(flag|state|pattern)-[a-z0-9]{1,16}$' then
    raise exception 'set_avatar: invalid avatar id %', p_avatar;
  end if;

  update public.profiles
    set avatar     = v_avatar,
        updated_at = now()
    where id = auth.uid()
    returning * into prof;
  if prof.id is null then raise exception 'set_avatar: no profile'; end if;
  return prof;
end; $$;

revoke execute on function public.set_avatar(text) from public, anon;
grant  execute on function public.set_avatar(text) to authenticated;
