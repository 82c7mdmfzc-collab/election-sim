-- ════════════════════════════════════════════════════════════════════════════
-- season.sql — the Campaign Trail season pass (Season 1: "Road to the White House").
--
-- Apply order: AFTER profiles.sql, BEFORE rewards.sql (complete_game_result reads
-- these tables under a to_regclass guard). The CI loop in deploy-db.yml places
-- `season` immediately before `rewards`. Idempotent (create-or-replace / if-not-exists).
--
-- DESIGN
--   The SERVER owns the reward catalog (seasons.tiers / seasons.objectives jsonb) so
--   the client can never spoof an amount; get_season_status returns the catalog and
--   the client only renders it + computes the current tier from xp vs cumXp. Season 2
--   is a single new `insert` — no code change.
--
--   Progression: Season XP is earned per finished game inside complete_game_result
--   (rewards.sql), capped 350/24h, +50 once per distinct candidate WON with (feeds
--   the Roster Objectives). Premium track unlocked with 4,000 Campaign Funds — a soft
--   currency sink, NOT a new App Store product.
--
--   Anti-abuse mirrors game_rewards: per-(tier,track) idempotency ledger, profile row
--   lock, server-owned amounts clamped, rate-limited claims.
-- ════════════════════════════════════════════════════════════════════════════

-- NOTE: game_rewards.season_xp (the rolling-cap column) is added in rewards.sql,
-- because season.sql runs first (before game_rewards exists). See deploy-db.yml.

-- claim_season_tier writes profiles.candidate_mastery (a mastery "tome"). That
-- column is normally created in rewards.sql, which runs AFTER this file — so with
-- check_function_bodies on, CREATE FUNCTION would fail. Ensure it exists here first.
alter table public.profiles add column if not exists candidate_mastery jsonb not null default '{}'::jsonb;

create table if not exists public.seasons (
  id           text primary key,
  title        text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  premium_cost integer not null default 4000,
  tiers        jsonb not null default '[]'::jsonb,       -- [{tier,cumXp,free:{...},premium:{...}}]
  objectives   jsonb not null default '[]'::jsonb        -- [{id,threshold,xp,funds?,cosmetic?}]
);

create table if not exists public.season_progress (
  user_id            uuid not null references auth.users(id) on delete cascade,
  season_id          text not null references public.seasons(id),
  xp                 integer not null default 0,
  premium            boolean not null default false,
  premium_unlocked_at timestamptz,
  candidates_won     text[] not null default '{}',       -- distinct candidates WON with this season
  updated_at         timestamptz not null default now(),
  primary key (user_id, season_id)
);
alter table public.season_progress enable row level security;
drop policy if exists season_progress_select_own on public.season_progress;
create policy season_progress_select_own on public.season_progress
  for select using (auth.uid() = user_id);

create table if not exists public.season_claims (
  user_id    uuid not null references auth.users(id) on delete cascade,
  season_id  text not null references public.seasons(id),
  ref        text not null,                              -- tier number as text, or objective id
  track      text not null check (track in ('free', 'premium', 'objective')),
  amount     integer not null default 0,
  cosmetic   text,
  mastery_xp integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, season_id, ref, track)
);
alter table public.season_claims enable row level security;
drop policy if exists season_claims_select_own on public.season_claims;
create policy season_claims_select_own on public.season_claims
  for select using (auth.uid() = user_id);

-- ── Season 1 seed ─────────────────────────────────────────────────────────────
-- Tiers: cumXp 100·5 → 180·10 → 240·10 → 320·5 = 6,300 XP over 30 tiers (~8 weeks
-- for a 2–3 games/day player). Reward keys per track: funds, cosmetic (grants a
-- `cosmetic:<id>` token), masteryXp (a "tome" applied to a chosen owned candidate).
-- Free funds total ≈ 1,300; premium funds total ≈ 6,000 (>4,000 cost = value on finish).
insert into public.seasons (id, title, starts_at, ends_at, premium_cost, tiers, objectives)
values (
  'season_1',
  'Road to the White House',
  '2026-07-05T00:00:00Z',
  '2026-08-10T00:00:00Z',
  4000,
  $json$[
    {"tier":1,"cumXp":100,"free":{"funds":25},"premium":{"funds":150,"cosmetic":"banner_gilded"}},
    {"tier":2,"cumXp":200,"free":{},"premium":{"funds":150}},
    {"tier":3,"cumXp":300,"free":{"funds":50},"premium":{"funds":175}},
    {"tier":4,"cumXp":400,"free":{"funds":50},"premium":{"funds":175}},
    {"tier":5,"cumXp":500,"free":{},"premium":{"funds":200}},
    {"tier":6,"cumXp":680,"free":{"funds":75},"premium":{"funds":200}},
    {"tier":7,"cumXp":860,"free":{"funds":75},"premium":{"funds":225}},
    {"tier":8,"cumXp":1040,"free":{"masteryXp":100},"premium":{"funds":225}},
    {"tier":9,"cumXp":1220,"free":{"funds":100},"premium":{"funds":250}},
    {"tier":10,"cumXp":1400,"free":{"cosmetic":"banner_circuit"},"premium":{"funds":250}},
    {"tier":11,"cumXp":1580,"free":{"funds":100},"premium":{"funds":275}},
    {"tier":12,"cumXp":1760,"free":{},"premium":{"masteryXp":150}},
    {"tier":13,"cumXp":1940,"free":{"funds":100},"premium":{"funds":300}},
    {"tier":14,"cumXp":2120,"free":{},"premium":{"funds":300}},
    {"tier":15,"cumXp":2300,"free":{"funds":100},"premium":{"funds":300,"cosmetic":"campaign_trail"}},
    {"tier":16,"cumXp":2540,"free":{"funds":100},"premium":{"funds":325}},
    {"tier":17,"cumXp":2780,"free":{},"premium":{"funds":325}},
    {"tier":18,"cumXp":3020,"free":{"funds":100},"premium":{"funds":350}},
    {"tier":19,"cumXp":3260,"free":{},"premium":{"funds":350}},
    {"tier":20,"cumXp":3500,"free":{"funds":125},"premium":{"funds":375}},
    {"tier":21,"cumXp":3740,"free":{"funds":125},"premium":{"funds":375}},
    {"tier":22,"cumXp":3980,"free":{},"premium":{"masteryXp":250}},
    {"tier":23,"cumXp":4220,"free":{"funds":125},"premium":{"funds":400}},
    {"tier":24,"cumXp":4460,"free":{"funds":125},"premium":{"funds":400}},
    {"tier":25,"cumXp":4700,"free":{},"premium":{"funds":400,"cosmetic":"theme_midnight_gold"}},
    {"tier":26,"cumXp":5020,"free":{"funds":150},"premium":{"funds":450}},
    {"tier":27,"cumXp":5340,"free":{"funds":150},"premium":{"funds":450}},
    {"tier":28,"cumXp":5660,"free":{},"premium":{"funds":500}},
    {"tier":29,"cumXp":5980,"free":{"funds":150},"premium":{"funds":600}},
    {"tier":30,"cumXp":6300,"free":{"funds":150},"premium":{"funds":800,"cosmetic":"banner_s1_champion"}}
  ]$json$::jsonb,
  $json$[
    {"id":"coalition_builder","threshold":3,"xp":200,"cosmetic":"banner_coalition"},
    {"id":"big_tent","threshold":5,"xp":300,"funds":500},
    {"id":"party_unity","threshold":7,"xp":400,"funds":1000}
  ]$json$::jsonb
)
on conflict (id) do update set
  title = excluded.title,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  premium_cost = excluded.premium_cost,
  tiers = excluded.tiers,
  objectives = excluded.objectives;

-- ── Internal: the active season row (within its run, or 7-day claim grace) ─────
create or replace function public._active_season()
returns public.seasons language sql stable security definer set search_path = public as $$
  select * from public.seasons
  where now() >= starts_at and now() < ends_at + interval '7 days'
  order by starts_at desc
  limit 1;
$$;

-- ── get_season_status ─────────────────────────────────────────────────────────
-- One round trip: the active season (catalog included) + my progress + claimed refs.
create or replace function public.get_season_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_season public.seasons;
  v_xp integer := 0;
  v_premium boolean := false;
  v_cands text[] := '{}';
  v_claims jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into v_season from public._active_season();
  if v_season.id is null then return jsonb_build_object('season', null); end if;

  select xp, premium, candidates_won
    into v_xp, v_premium, v_cands
    from public.season_progress where user_id = v_uid and season_id = v_season.id;

  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'track', track)), '[]'::jsonb)
    into v_claims
    from public.season_claims where user_id = v_uid and season_id = v_season.id;

  return jsonb_build_object(
    'season', jsonb_build_object(
      'id', v_season.id,
      'title', v_season.title,
      'startsAt', v_season.starts_at,
      'endsAt', v_season.ends_at,
      'premiumCost', v_season.premium_cost,
      'tiers', v_season.tiers,
      'objectives', v_season.objectives,
      'ended', now() >= v_season.ends_at
    ),
    'progress', jsonb_build_object(
      'xp', coalesce(v_xp, 0),
      'premium', coalesce(v_premium, false),
      'candidatesWon', to_jsonb(coalesce(v_cands, '{}'))
    ),
    'claims', v_claims
  );
end; $$;

revoke execute on function public.get_season_status() from public, anon;
grant  execute on function public.get_season_status() to authenticated;

-- ── unlock_season_pass ────────────────────────────────────────────────────────
-- Buy the premium track for the season's premium_cost (4,000). Idempotent: a
-- second call is a no-op that just returns the current status.
create or replace function public.unlock_season_pass()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_season public.seasons;
  prof public.profiles;
  v_premium boolean;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  perform public.assert_app_supported();
  select * into v_season from public._active_season();
  if v_season.id is null then raise exception 'no active season'; end if;
  if now() >= v_season.ends_at then raise exception 'season ended'; end if;

  select * into prof from public.profiles where id = v_uid for update;
  if prof.id is null then raise exception 'no profile'; end if;

  -- Ensure a progress row exists, then short-circuit if already premium.
  insert into public.season_progress (user_id, season_id) values (v_uid, v_season.id)
    on conflict (user_id, season_id) do nothing;
  select premium into v_premium from public.season_progress
    where user_id = v_uid and season_id = v_season.id;
  if v_premium then return public.get_season_status(); end if;

  if prof.campaign_funds < v_season.premium_cost then
    raise exception 'unlock_season_pass: insufficient funds';
  end if;

  update public.profiles set campaign_funds = campaign_funds - v_season.premium_cost, updated_at = now()
    where id = v_uid;
  update public.season_progress set premium = true, premium_unlocked_at = now(), updated_at = now()
    where user_id = v_uid and season_id = v_season.id;

  return public.get_season_status();
end; $$;

revoke execute on function public.unlock_season_pass() from public, anon;
grant  execute on function public.unlock_season_pass() to authenticated;

-- ── claim_season_tier ─────────────────────────────────────────────────────────
-- Claim one tier's reward on a track. Server reads the reward from seasons.tiers
-- (never the client). Requires xp >= cumXp; premium track requires premium. Mastery
-- tomes need p_candidate (an owned candidate). Idempotent via season_claims PK.
create or replace function public.claim_season_tier(p_tier integer, p_track text, p_candidate text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_season public.seasons;
  prof public.profiles;
  v_xp integer; v_premium boolean;
  v_tier jsonb; v_reward jsonb;
  v_funds integer := 0; v_cosmetic text; v_mastery_xp integer := 0;
  v_cand text := nullif(btrim(coalesce(p_candidate, '')), '');
  v_token text;
  v_mastery jsonb; v_entry jsonb; v_floor integer; v_new_xp integer; v_new_level integer;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  perform public.assert_app_supported();
  if p_track not in ('free', 'premium') then raise exception 'invalid track %', p_track; end if;
  perform public.check_rate_limit('season_claim:' || v_uid::text, 40, 3600);

  select * into v_season from public._active_season();
  if v_season.id is null then raise exception 'no active season'; end if;

  select * into prof from public.profiles where id = v_uid for update;
  if prof.id is null then raise exception 'no profile'; end if;
  select xp, premium into v_xp, v_premium from public.season_progress
    where user_id = v_uid and season_id = v_season.id;
  v_xp := coalesce(v_xp, 0); v_premium := coalesce(v_premium, false);

  -- Locate the tier + its reward for this track (server-owned catalog).
  select t into v_tier from jsonb_array_elements(v_season.tiers) t
    where (t->>'tier')::integer = p_tier;
  if v_tier is null then raise exception 'unknown tier %', p_tier; end if;
  if v_xp < (v_tier->>'cumXp')::integer then raise exception 'tier not reached'; end if;
  if p_track = 'premium' and not v_premium then raise exception 'premium track locked'; end if;
  v_reward := v_tier -> p_track;
  if v_reward is null or v_reward = '{}'::jsonb then raise exception 'no reward on this track'; end if;

  v_funds := coalesce((v_reward->>'funds')::integer, 0);
  v_cosmetic := v_reward->>'cosmetic';
  v_mastery_xp := coalesce((v_reward->>'masteryXp')::integer, 0);

  -- Idempotency: claim the (tier,track) ledger row first.
  insert into public.season_claims (user_id, season_id, ref, track, amount, cosmetic, mastery_xp)
    values (v_uid, v_season.id, p_tier::text, p_track, least(v_funds, 1000), v_cosmetic, least(v_mastery_xp, 300))
    on conflict do nothing;
  if not found then raise exception 'tier already claimed'; end if;

  -- Grant funds (clamped) + cosmetic token.
  if v_funds > 0 then
    update public.profiles set campaign_funds = campaign_funds + least(v_funds, 1000), updated_at = now()
      where id = v_uid;
  end if;
  if v_cosmetic is not null and v_cosmetic <> '' then
    v_token := 'cosmetic:' || v_cosmetic;
    update public.profiles
      set unlocked_characters = case when v_token = any(unlocked_characters)
            then unlocked_characters else array_append(unlocked_characters, v_token) end,
          updated_at = now()
      where id = v_uid;
  end if;

  -- Mastery tome: apply to a chosen owned candidate (validated), clamp 300.
  if v_mastery_xp > 0 then
    if v_cand is null then raise exception 'mastery tome needs a candidate'; end if;
    -- Owned = a founding free candidate OR an unlocked one.
    if not (v_cand = any(prof.unlocked_characters)
            or v_cand in ('tooley','trump','harris','lincoln','joe_biden')) then
      raise exception 'candidate not owned';
    end if;
    v_mastery := coalesce(prof.candidate_mastery, '{}'::jsonb);
    v_entry := coalesce(v_mastery -> v_cand, '{}'::jsonb);
    v_floor := case when v_cand = 'farage' then 3
                    when v_cand in ('ronald_reagan','washington','starmer','jfk') then 2 else 1 end;
    v_new_xp := greatest(0, coalesce((v_entry->>'xp')::integer, 0)) + least(v_mastery_xp, 300);
    v_new_level := greatest(v_floor, case
      when v_new_xp >= 4000 then 5 when v_new_xp >= 1800 then 4
      when v_new_xp >= 900 then 3 when v_new_xp >= 150 then 2 else 1 end);
    update public.profiles
      set candidate_mastery = jsonb_set(v_mastery, array[v_cand],
            jsonb_set(jsonb_set(v_entry, '{xp}', to_jsonb(v_new_xp), true),
                      '{level}', to_jsonb(v_new_level), true), true),
          updated_at = now()
      where id = v_uid;
  end if;

  return public.get_season_status();
end; $$;

revoke execute on function public.claim_season_tier(integer, text, text) from public, anon;
grant  execute on function public.claim_season_tier(integer, text, text) to authenticated;

-- ── claim_season_objective ────────────────────────────────────────────────────
-- Claim a Roster Objective once its distinct-candidate threshold is met. Grants
-- season XP (accelerates tier progress) + funds/cosmetic. Idempotent via ledger.
create or replace function public.claim_season_objective(p_objective text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_season public.seasons;
  prof public.profiles;
  v_cands text[]; v_obj jsonb;
  v_xp integer := 0; v_funds integer := 0; v_cosmetic text; v_token text;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  perform public.check_rate_limit('season_claim:' || v_uid::text, 40, 3600);

  select * into v_season from public._active_season();
  if v_season.id is null then raise exception 'no active season'; end if;

  select o into v_obj from jsonb_array_elements(v_season.objectives) o where o->>'id' = p_objective;
  if v_obj is null then raise exception 'unknown objective %', p_objective; end if;

  select * into prof from public.profiles where id = v_uid for update;
  if prof.id is null then raise exception 'no profile'; end if;
  select candidates_won into v_cands from public.season_progress
    where user_id = v_uid and season_id = v_season.id;
  if coalesce(array_length(coalesce(v_cands, '{}'), 1), 0) < (v_obj->>'threshold')::integer then
    raise exception 'objective not met';
  end if;

  v_xp := coalesce((v_obj->>'xp')::integer, 0);
  v_funds := coalesce((v_obj->>'funds')::integer, 0);
  v_cosmetic := v_obj->>'cosmetic';

  insert into public.season_claims (user_id, season_id, ref, track, amount, cosmetic, mastery_xp)
    values (v_uid, v_season.id, p_objective, 'objective', least(v_funds, 2000), v_cosmetic, 0)
    on conflict do nothing;
  if not found then raise exception 'objective already claimed'; end if;

  update public.season_progress set xp = xp + greatest(0, least(v_xp, 500)), updated_at = now()
    where user_id = v_uid and season_id = v_season.id;
  if v_funds > 0 then
    update public.profiles set campaign_funds = campaign_funds + least(v_funds, 2000), updated_at = now()
      where id = v_uid;
  end if;
  if v_cosmetic is not null and v_cosmetic <> '' then
    v_token := 'cosmetic:' || v_cosmetic;
    update public.profiles
      set unlocked_characters = case when v_token = any(unlocked_characters)
            then unlocked_characters else array_append(unlocked_characters, v_token) end,
          updated_at = now()
      where id = v_uid;
  end if;

  return public.get_season_status();
end; $$;

revoke execute on function public.claim_season_objective(text) from public, anon;
grant  execute on function public.claim_season_objective(text) to authenticated;
