-- ════════════════════════════════════════════════════════════════════════════
-- 270 / Elector — Server-authoritative Campaign Funds rewards (Phase: launch hardening)
--
-- Apply in Supabase Dashboard → SQL Editor AFTER profiles.sql. Idempotent.
--
-- WHY THIS EXISTS
--   Previously the client computed its own reward and called award_funds(amount),
--   which only capped the per-call amount. With no per-game dedup or cooldown a
--   script could call it repeatedly and mint unlimited Campaign Funds.
--
-- WHAT CHANGES
--   • The SERVER owns the reward formula (mirrors src/game/rewards.ts).
--   • Each (user, game) can be claimed at most once  → game_rewards unique key.
--   • A rolling 24h cap bounds abuse even across many distinct games.
--   • The client passes only the (range-checked) game outcome, never an amount.
--
-- RESIDUAL TRUST NOTE
--   Single-player/bot outcomes are still reported by the client (there is no
--   server-side SP simulation), so a determined cheater could craft one winning
--   result per distinct gameId. The dedup + per-call cap + daily cap reduce this
--   from "unlimited funds" to "one capped, bounded reward per game", which is the
--   meaningful protection for launch. Online rewards derive from the authoritative
--   resolved state.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Ledger: one row per claimed game, enforces idempotency ───────────────────
create table if not exists public.game_rewards (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  game_id    text        not null,
  amount     integer     not null,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

alter table public.game_rewards add column if not exists won boolean;
alter table public.game_rewards add column if not exists mode text;
alter table public.game_rewards add column if not exists bot_difficulty text;
alter table public.game_rewards add column if not exists bot_count integer;
alter table public.game_rewards add column if not exists turns integer;
alter table public.game_rewards add column if not exists electoral_votes integer;
alter table public.game_rewards add column if not exists candidate_id text;
alter table public.game_rewards add column if not exists opponent_count integer;
-- Season XP earned on this game (drives the rolling 24h season-XP cap). Defined here
-- because season.sql runs BEFORE rewards.sql, so game_rewards doesn't exist there yet.
alter table public.game_rewards add column if not exists season_xp integer not null default 0;

alter table public.game_rewards enable row level security;

-- Owner may read their own ledger; writes happen only via the SECURITY DEFINER RPC.
drop policy if exists game_rewards_select_own on public.game_rewards;
create policy game_rewards_select_own on public.game_rewards
  for select using (auth.uid() = user_id);

-- Progression columns live on profiles but are created here too so rewards.sql
-- remains idempotent when applied after an older profiles.sql.
alter table public.profiles add column if not exists achievement_counters jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists daily_streak jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists candidate_mastery jsonb not null default '{}'::jsonb;

-- One-time grandfathering for the paid candidate floor rebalance. Before this
-- change, Tier 2 candidates displayed at Level 3 and Farage displayed at Level 5
-- even with 0 XP. Preserve that visible level for existing owners once, while
-- allowing future unlocks to use the new lower floors.
create table if not exists public.economy_migrations (
  key text primary key,
  applied_at timestamptz not null default now()
);

do $$
declare
  v_inserted integer := 0;
  r record;
  v_mastery jsonb;
  v_entry jsonb;
  v_candidate text;
  v_xp integer;
  v_level integer;
begin
  insert into public.economy_migrations (key)
  values ('candidate_mastery_floor_rebalance_2026_07')
  on conflict (key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    return;
  end if;

  for r in select id, unlocked_characters, candidate_mastery from public.profiles loop
    v_mastery := coalesce(r.candidate_mastery, '{}'::jsonb);

    foreach v_candidate in array array['ronald_reagan', 'washington', 'starmer', 'jfk'] loop
      if v_candidate = any(coalesce(r.unlocked_characters, '{}')) then
        v_entry := coalesce(v_mastery -> v_candidate, '{}'::jsonb);
        v_xp := greatest(900, greatest(0, coalesce((v_entry->>'xp')::integer, 0)));
        v_level := case
          when v_xp >= 4000 then 5
          when v_xp >= 1800 then 4
          when v_xp >= 900 then 3
          when v_xp >= 150 then 2
          else 1
        end;
        v_entry := jsonb_set(v_entry, '{xp}', to_jsonb(v_xp), true);
        v_entry := jsonb_set(v_entry, '{level}', to_jsonb(greatest(v_level, 3)), true);
        v_mastery := jsonb_set(v_mastery, array[v_candidate], v_entry, true);
      end if;
    end loop;

    if 'farage' = any(coalesce(r.unlocked_characters, '{}')) then
      v_entry := coalesce(v_mastery -> 'farage', '{}'::jsonb);
      v_xp := greatest(4000, greatest(0, coalesce((v_entry->>'xp')::integer, 0)));
      v_entry := jsonb_set(v_entry, '{xp}', to_jsonb(v_xp), true);
      v_entry := jsonb_set(v_entry, '{level}', to_jsonb(5), true);
      v_mastery := jsonb_set(v_mastery, array['farage'], v_entry, true);
    end if;

    update public.profiles
      set candidate_mastery = v_mastery, updated_at = now()
      where id = r.id and v_mastery <> coalesce(r.candidate_mastery, '{}'::jsonb);
  end loop;
end; $$;

-- ── Ledger: one reward per achievement per account ──────────────────────────
create table if not exists public.achievement_rewards (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  achievement_id text       not null,
  amount         integer    not null,
  created_at     timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

alter table public.achievement_rewards enable row level security;

drop policy if exists achievement_rewards_select_own on public.achievement_rewards;
create policy achievement_rewards_select_own on public.achievement_rewards
  for select using (auth.uid() = user_id);

-- ── RPC: claim_game_reward ───────────────────────────────────────────────────
-- Computes the reward SERVER-SIDE from the (clamped) game outcome, dedups by
-- (user, game_id), enforces a rolling daily cap, credits the profile, and returns
-- the new balance. A repeat claim for the same game is a no-op that returns the
-- current balance.
create or replace function public.claim_game_reward(
  p_game_id     text,
  p_won         boolean,
  p_secured     integer,
  p_coalitions  integer,
  p_win_streak  integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  -- formula constants (keep in sync with src/game/rewards.ts)
  c_base         constant integer := 5;
  c_win          constant integer := 20;
  c_per_secured  constant integer := 1;
  c_per_coalition constant integer := 3;
  c_per_streak   constant integer := 5;
  c_max_streak   constant integer := 5;
  c_reward_cap   constant integer := 60;     -- per-game cap (matches REWARD_CAP)
  c_daily_cap    constant integer := 20000;  -- rolling 24h cap per account
  v_secured      integer;
  v_coalitions   integer;
  v_streak       integer;
  v_reward       integer;
  v_today        integer;
  v_games_today  integer;
  v_balance      integer;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  perform public.assert_app_supported();
  if p_game_id is null or length(p_game_id) < 1 or length(p_game_id) > 64 then
    raise exception 'invalid game_id';
  end if;

  -- Clamp outcome inputs to sane ranges so a tampered client can't inflate them.
  v_secured    := greatest(0, least(coalesce(p_secured, 0), 56));      -- 50 states + DC + slack
  v_coalitions := greatest(0, least(coalesce(p_coalitions, 0), 20));
  v_streak     := greatest(0, least(coalesce(p_win_streak, 0), 9999));

  -- Count games already claimed in the past 24h (before this one) for diminishing returns.
  select count(*)::integer into v_games_today
    from public.game_rewards
    where user_id = v_uid and created_at > now() - interval '24 hours' and game_id <> p_game_id;

  v_reward := c_base
            + (case when p_won then c_win else 0 end)
            + v_secured * c_per_secured
            + v_coalitions * c_per_coalition
            + (case when p_won then least(v_streak, c_max_streak) * c_per_streak else 0 end);
  -- Diminishing returns: -10 per game played today, floors at 0.
  v_reward := least(v_reward, greatest(0, c_reward_cap - v_games_today * 10));

  -- Idempotency: first claim for this game wins; repeats return current balance.
  insert into public.game_rewards (user_id, game_id, amount)
  values (v_uid, p_game_id, v_reward)
  on conflict (user_id, game_id) do nothing;

  if not found then
    select campaign_funds into v_balance from public.profiles where id = v_uid;
    return coalesce(v_balance, 0);
  end if;

  -- Rolling daily cap: clamp the credited amount to what's left in the window.
  select coalesce(sum(amount), 0) into v_today
    from public.game_rewards
    where user_id = v_uid and created_at > now() - interval '24 hours' and game_id <> p_game_id;
  if v_today + v_reward > c_daily_cap then
    v_reward := greatest(0, c_daily_cap - v_today);
    update public.game_rewards set amount = v_reward
      where user_id = v_uid and game_id = p_game_id;
  end if;

  update public.profiles
    set campaign_funds = campaign_funds + v_reward, updated_at = now()
    where id = v_uid
    returning campaign_funds into v_balance;
  if v_balance is null then raise exception 'claim_game_reward: no profile'; end if;
  return v_balance;
end; $$;

-- ── RPC: complete_game_result ───────────────────────────────────────────────
-- New game-end path: one idempotent call owns game reward, 14-day finish streak,
-- lifetime stats, and server-side achievement counters.
create or replace function public.complete_game_result(
  p_game_id         text,
  p_won             boolean,
  p_secured         integer,
  p_coalitions      integer,
  p_win_streak      integer,
  p_mode            text,
  p_bot_difficulty  text,
  p_bot_count       integer,
  p_turns           integer,
  p_electoral_votes integer,
  p_candidate_id    text,
  p_opponent_count  integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  prof           public.profiles;
  c_base         constant integer := 5;
  c_win          constant integer := 20;
  c_per_secured  constant integer := 1;
  c_per_coalition constant integer := 3;
  c_per_streak   constant integer := 5;
  c_max_streak   constant integer := 5;
  c_reward_cap   constant integer := 60;
  c_daily_cap    constant integer := 20000;
  v_secured      integer := greatest(0, least(coalesce(p_secured, 0), 56));
  v_coalitions   integer := greatest(0, least(coalesce(p_coalitions, 0), 20));
  v_streak       integer := greatest(0, least(coalesce(p_win_streak, 0), 9999));
  v_turns        integer := greatest(1, least(coalesce(p_turns, 1), 99));
  v_ev           integer := greatest(0, least(coalesce(p_electoral_votes, 0), 538));
  v_bot_count    integer := greatest(0, least(coalesce(p_bot_count, 0), 3));
  v_opponents    integer := greatest(0, least(coalesce(p_opponent_count, 0), 3));
  v_mode         text := case when p_mode in ('single', 'bot', 'daily', 'online') then p_mode else 'single' end;
  v_bot_diff     text := case when p_bot_difficulty in ('easy', 'medium', 'hard', 'impossible') then p_bot_difficulty else null end;
  v_reward       integer;
  v_games_today  integer;
  v_today_total  integer;
  v_game_inserted boolean;
  v_today        date := (now() at time zone 'utc')::date;
  v_last_date    date;
  v_streak_count integer;
  v_daily_reward integer := 0;
  v_stats        jsonb;
  v_counters     jsonb;
  v_claimed      text[];
  v_claimable    text[] := '{}';
  v_balance      integer;
  v_premium_unlocks integer;
  v_referrals    integer;
  v_candidate_id text := nullif(btrim(coalesce(p_candidate_id, '')), '');
  v_candidate_mastery jsonb;
  v_mastery_entry jsonb;
  v_mastery_prev_xp integer;
  v_mastery_xp integer;
  v_mastery_new_xp integer;
  v_mastery_floor integer;
  v_mastery_prev_level integer;
  v_mastery_new_level integer;
  v_mastery_award jsonb;
  -- Season pass (guarded; requires season.sql to have been applied)
  v_season_id text;
  v_season_xp integer := 0;
  v_season_base integer := 0;
  v_season_roster integer := 0;
  v_season_today integer := 0;
  v_season_prev_xp integer := 0;
  v_season_premium boolean := false;
  v_season_cands text[] := '{}';
  v_season jsonb := null;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  perform public.assert_app_supported();
  if p_game_id is null or length(p_game_id) < 1 or length(p_game_id) > 64 then
    raise exception 'invalid game_id';
  end if;

  select * into prof from public.profiles where id = v_uid for update;
  if prof.id is null then raise exception 'complete_game_result: no profile'; end if;

  -- Count games already claimed in the past 24h (before this one) for diminishing returns.
  select count(*)::integer into v_games_today
    from public.game_rewards
    where user_id = v_uid and created_at > now() - interval '24 hours' and game_id <> p_game_id;

  v_reward := c_base
            + (case when p_won then c_win else 0 end)
            + v_secured * c_per_secured
            + v_coalitions * c_per_coalition
            + (case when p_won then least(v_streak, c_max_streak) * c_per_streak else 0 end);
  -- Diminishing returns: -10 per game played today, floors at 0. All integer arithmetic.
  v_reward := least(v_reward, greatest(0, c_reward_cap - v_games_today * 10));

  insert into public.game_rewards (
    user_id, game_id, amount, won, mode, bot_difficulty, bot_count,
    turns, electoral_votes, candidate_id, opponent_count
  )
  values (
    v_uid, p_game_id, v_reward, p_won, v_mode, v_bot_diff, v_bot_count,
    v_turns, v_ev, nullif(btrim(coalesce(p_candidate_id, '')), ''), v_opponents
  )
  on conflict (user_id, game_id) do nothing;
  v_game_inserted := found;

  if not v_game_inserted then
    select coalesce(array_agg(achievement_id order by achievement_id), '{}')
      into v_claimed
      from public.achievement_rewards
      where user_id = v_uid;
    return jsonb_build_object(
      'balance', prof.campaign_funds,
      'gameReward', 0,
      'dailyStreakReward', 0,
      'dailyStreakDay', coalesce((prof.daily_streak->>'count')::integer, 0),
      'stats', prof.stats,
      'achievementCounters', prof.achievement_counters,
      'dailyStreak', prof.daily_streak,
      'newlyCompletedAchievements', '[]'::jsonb,
      'claimedAchievements', to_jsonb(coalesce(v_claimed, '{}')),
      'candidateMastery', prof.candidate_mastery,
      'masteryAward', jsonb_build_object(
        'candidateId', null,
        'xpGained', 0,
        'previousLevel', 1,
        'newLevel', 1,
        'leveledUp', false
      ),
      'season', null
    );
  end if;

  select coalesce(sum(amount), 0) into v_today_total
    from public.game_rewards
    where user_id = v_uid and created_at > now() - interval '24 hours' and game_id <> p_game_id;
  if v_today_total + v_reward > c_daily_cap then
    v_reward := greatest(0, c_daily_cap - v_today_total);
    update public.game_rewards set amount = v_reward
      where user_id = v_uid and game_id = p_game_id;
  end if;

  begin
    v_last_date := nullif(prof.daily_streak->>'lastDate', '')::date;
  exception when others then
    v_last_date := null;
  end;

  if v_last_date = v_today then
    v_streak_count := greatest(0, coalesce((prof.daily_streak->>'count')::integer, 0));
    v_daily_reward := 0;
  else
    if v_last_date = v_today - 1 then
      v_streak_count := greatest(0, coalesce((prof.daily_streak->>'count')::integer, 0)) + 1;
    else
      v_streak_count := 1;
    end if;
    v_daily_reward := case
      when v_streak_count <= 1 then 10
      when v_streak_count = 2 then 15
      when v_streak_count = 3 then 20
      when v_streak_count = 4 then 25
      when v_streak_count = 5 then 30
      when v_streak_count = 6 then 35
      when v_streak_count = 7 then 40
      when v_streak_count = 8 then 45
      when v_streak_count = 9 then 50
      when v_streak_count = 10 then 60
      when v_streak_count = 11 then 70
      when v_streak_count = 12 then 80
      when v_streak_count = 13 then 90
      else 100
    end;
  end if;

  select count(*)::integer into v_premium_unlocks
    from unnest(prof.unlocked_characters) as u(id)
    where u.id in ('ronald_reagan', 'washington', 'starmer', 'farage', 'jfk');

  if to_regclass('public.referral_rewards') is not null then
    select count(*)::integer into v_referrals
      from public.referral_rewards
      where referrer_user_id = v_uid or referred_user_id = v_uid;
  else
    v_referrals := coalesce((prof.achievement_counters->>'referralsRedeemed')::integer, 0);
  end if;

  v_stats := jsonb_build_object(
    'gamesPlayed', coalesce((prof.stats->>'gamesPlayed')::integer, 0) + 1,
    'gamesWon', coalesce((prof.stats->>'gamesWon')::integer, 0) + case when p_won then 1 else 0 end,
    'winStreak', case when p_won then v_streak else 0 end,
    'bestWinStreak', greatest(coalesce((prof.stats->>'bestWinStreak')::integer, 0), case when p_won then v_streak else 0 end),
    'coalitionsDominated', coalesce((prof.stats->>'coalitionsDominated')::integer, 0) + v_coalitions
  );

  v_counters := jsonb_build_object(
    'gamesFinished', coalesce((prof.achievement_counters->>'gamesFinished')::integer, 0) + 1,
    'gamesWon', coalesce((prof.achievement_counters->>'gamesWon')::integer, 0) + case when p_won then 1 else 0 end,
    'bestWinStreak', greatest(coalesce((prof.achievement_counters->>'bestWinStreak')::integer, 0), case when p_won then v_streak else 0 end),
    'coalitionsDominated', coalesce((prof.achievement_counters->>'coalitionsDominated')::integer, 0) + v_coalitions,
    'securedStatesLifetime', coalesce((prof.achievement_counters->>'securedStatesLifetime')::integer, 0) + v_secured,
    'botEasyWins', coalesce((prof.achievement_counters->>'botEasyWins')::integer, 0) + case when p_won and v_mode = 'bot' and v_bot_diff = 'easy' then 1 else 0 end,
    'botMediumWins', coalesce((prof.achievement_counters->>'botMediumWins')::integer, 0) + case when p_won and v_mode = 'bot' and v_bot_diff = 'medium' then 1 else 0 end,
    'botHardWins', coalesce((prof.achievement_counters->>'botHardWins')::integer, 0) + case when p_won and v_mode = 'bot' and v_bot_diff in ('hard', 'impossible') then 1 else 0 end,
    'botThreeHardWins', coalesce((prof.achievement_counters->>'botThreeHardWins')::integer, 0) + case when p_won and v_mode = 'bot' and v_bot_diff in ('hard', 'impossible') and v_bot_count >= 3 then 1 else 0 end,
    'botHard350Wins', coalesce((prof.achievement_counters->>'botHard350Wins')::integer, 0) + case when p_won and v_mode = 'bot' and v_bot_diff in ('hard', 'impossible') and v_ev >= 350 then 1 else 0 end,
    'maxCoalitionsSingleGame', greatest(coalesce((prof.achievement_counters->>'maxCoalitionsSingleGame')::integer, 0), v_coalitions),
    'maxSecuredStatesSingleGame', greatest(coalesce((prof.achievement_counters->>'maxSecuredStatesSingleGame')::integer, 0), v_secured),
    'maxWinEv', greatest(coalesce((prof.achievement_counters->>'maxWinEv')::integer, 0), case when p_won then v_ev else 0 end),
    'fastestWinTurn', case
      when not p_won then prof.achievement_counters->'fastestWinTurn'
      when prof.achievement_counters->>'fastestWinTurn' is null then to_jsonb(v_turns)
      else to_jsonb(least((prof.achievement_counters->>'fastestWinTurn')::integer, v_turns))
    end,
    'onlineFinished', coalesce((prof.achievement_counters->>'onlineFinished')::integer, 0) + case when v_mode = 'online' then 1 else 0 end,
    'onlineWon', coalesce((prof.achievement_counters->>'onlineWon')::integer, 0) + case when v_mode = 'online' and p_won then 1 else 0 end,
    'premiumUnlocks', v_premium_unlocks,
    'referralsRedeemed', v_referrals
  );

  v_candidate_mastery := coalesce(prof.candidate_mastery, '{}'::jsonb);
  v_mastery_floor := case
    when v_candidate_id = 'farage' then 3
    when v_candidate_id in ('ronald_reagan', 'washington', 'starmer', 'jfk') then 2
    else 1
  end;
  v_mastery_entry := coalesce(v_candidate_mastery -> coalesce(v_candidate_id, ''), '{}'::jsonb);
  v_mastery_prev_xp := greatest(0, coalesce((v_mastery_entry->>'xp')::integer, 0));
  v_mastery_xp := 10
    + case when p_won then 25 else 0 end
    + v_secured
    + v_coalitions * 5
    + case when p_won and v_mode = 'bot' and v_bot_diff in ('hard', 'impossible') then 10 else 0 end
    + case when p_won and v_mode = 'online' then 15 else 0 end;
  v_mastery_new_xp := v_mastery_prev_xp + v_mastery_xp;
  v_mastery_prev_level := greatest(v_mastery_floor, case
    when v_mastery_prev_xp >= 4000 then 5
    when v_mastery_prev_xp >= 1800 then 4
    when v_mastery_prev_xp >= 900 then 3
    when v_mastery_prev_xp >= 150 then 2
    else 1
  end);
  v_mastery_new_level := greatest(v_mastery_floor, case
    when v_mastery_new_xp >= 4000 then 5
    when v_mastery_new_xp >= 1800 then 4
    when v_mastery_new_xp >= 900 then 3
    when v_mastery_new_xp >= 150 then 2
    else 1
  end);
  if v_mastery_new_level > 5 then v_mastery_new_level := 5; end if;
  if v_mastery_prev_level > 5 then v_mastery_prev_level := 5; end if;

  if v_candidate_id is not null then
    v_candidate_mastery := jsonb_set(
      v_candidate_mastery,
      array[v_candidate_id],
      jsonb_build_object(
        'xp', v_mastery_new_xp,
        'level', v_mastery_new_level,
        'gamesFinished', greatest(0, coalesce((v_mastery_entry->>'gamesFinished')::integer, 0)) + 1,
        'wins', greatest(0, coalesce((v_mastery_entry->>'wins')::integer, 0)) + case when p_won then 1 else 0 end,
        'bestEv', greatest(greatest(0, coalesce((v_mastery_entry->>'bestEv')::integer, 0)), v_ev),
        'fastestWin', case
          when not p_won then v_mastery_entry->'fastestWin'
          when v_mastery_entry->>'fastestWin' is null then to_jsonb(v_turns)
          else to_jsonb(least((v_mastery_entry->>'fastestWin')::integer, v_turns))
        end,
        'maxCoalitions', greatest(greatest(0, coalesce((v_mastery_entry->>'maxCoalitions')::integer, 0)), v_coalitions),
        'maxSecuredStates', greatest(greatest(0, coalesce((v_mastery_entry->>'maxSecuredStates')::integer, 0)), v_secured),
        'hardWins', greatest(0, coalesce((v_mastery_entry->>'hardWins')::integer, 0)) + case when p_won and v_mode = 'bot' and v_bot_diff in ('hard', 'impossible') then 1 else 0 end,
        'onlineWins', greatest(0, coalesce((v_mastery_entry->>'onlineWins')::integer, 0)) + case when p_won and v_mode = 'online' then 1 else 0 end
      ),
      true
    );
  end if;
  v_mastery_award := jsonb_build_object(
    'candidateId', v_candidate_id,
    'xpGained', case when v_candidate_id is null then 0 else v_mastery_xp end,
    'previousLevel', v_mastery_prev_level,
    'newLevel', v_mastery_new_level,
    'leveledUp', v_mastery_new_level > v_mastery_prev_level
  );

  -- ── Season pass XP (guarded — only runs once season.sql is applied) ──────────
  if to_regclass('public.seasons') is not null then
    select id into v_season_id from public.seasons
      where now() >= starts_at and now() < ends_at
      order by starts_at desc limit 1;
    if v_season_id is not null then
      -- Base XP from the already-clamped outcome inputs.
      v_season_base := 20
        + case when p_won then 20 else 0 end
        + least(v_secured, 10)
        + least(v_coalitions, 5) * 2
        + case when v_mode in ('daily', 'weekly') then 10
               when v_mode = 'online' then 15 else 0 end;
      -- Rolling 24h cap of 350 (this game's season_xp is still 0 at this point).
      select coalesce(sum(season_xp), 0) into v_season_today
        from public.game_rewards
        where user_id = v_uid and created_at > now() - interval '24 hours' and game_id <> p_game_id;
      v_season_base := greatest(0, least(v_season_base, 350 - v_season_today));

      -- Load progress (init blank), apply the roster-variety bonus.
      select xp, premium, candidates_won
        into v_season_prev_xp, v_season_premium, v_season_cands
        from public.season_progress where user_id = v_uid and season_id = v_season_id;
      v_season_prev_xp := coalesce(v_season_prev_xp, 0);
      v_season_premium := coalesce(v_season_premium, false);
      v_season_cands := coalesce(v_season_cands, '{}');
      if p_won and v_candidate_id is not null and not (v_candidate_id = any(v_season_cands)) then
        v_season_cands := array_append(v_season_cands, v_candidate_id);
        v_season_roster := 50;
      end if;

      v_season_xp := v_season_base + v_season_roster;
      update public.game_rewards set season_xp = v_season_xp
        where user_id = v_uid and game_id = p_game_id;

      insert into public.season_progress (user_id, season_id, xp, candidates_won, updated_at)
        values (v_uid, v_season_id, v_season_prev_xp + v_season_xp, v_season_cands, now())
        on conflict (user_id, season_id) do update
          set xp = season_progress.xp + v_season_xp,
              candidates_won = v_season_cands,
              updated_at = now();

      v_season := jsonb_build_object(
        'seasonId', v_season_id,
        'gained', v_season_xp,
        'xp', v_season_prev_xp + v_season_xp,
        'premium', v_season_premium,
        'candidatesWon', to_jsonb(v_season_cands)
      );
    end if;
  end if;

  update public.profiles
    set campaign_funds = campaign_funds + v_reward + v_daily_reward,
        stats = v_stats,
        achievement_counters = v_counters,
        daily_streak = jsonb_build_object('count', v_streak_count, 'lastDate', v_today::text),
        candidate_mastery = v_candidate_mastery,
        updated_at = now()
    where id = v_uid
    returning campaign_funds into v_balance;

  select coalesce(array_agg(achievement_id order by achievement_id), '{}')
    into v_claimed
    from public.achievement_rewards
    where user_id = v_uid;

  if coalesce((v_counters->>'gamesFinished')::integer, 0) >= 1 and not ('campaign_finish_first' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'campaign_finish_first'); end if;
  if coalesce((v_counters->>'gamesWon')::integer, 0) >= 1 and not ('campaign_win_first' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'campaign_win_first'); end if;
  if coalesce((v_counters->>'gamesFinished')::integer, 0) >= 10 and not ('campaign_finish_10' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'campaign_finish_10'); end if;
  if coalesce((v_counters->>'gamesWon')::integer, 0) >= 25 and not ('campaign_win_25' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'campaign_win_25'); end if;
  if coalesce((v_counters->>'bestWinStreak')::integer, 0) >= 5 and not ('campaign_streak_5' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'campaign_streak_5'); end if;
  if coalesce((v_counters->>'botEasyWins')::integer, 0) >= 1 and not ('bot_beat_easy' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'bot_beat_easy'); end if;
  if coalesce((v_counters->>'botMediumWins')::integer, 0) >= 1 and not ('bot_beat_medium' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'bot_beat_medium'); end if;
  if coalesce((v_counters->>'botHardWins')::integer, 0) >= 1 and not ('bot_beat_hard' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'bot_beat_hard'); end if;
  if coalesce((v_counters->>'botThreeHardWins')::integer, 0) >= 1 and not ('bot_beat_3_hard' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'bot_beat_3_hard'); end if;
  if coalesce((v_counters->>'botHard350Wins')::integer, 0) >= 1 and not ('bot_hard_350_ev' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'bot_hard_350_ev'); end if;
  if coalesce((v_counters->>'securedStatesLifetime')::integer, 0) >= 1 and not ('strategy_secure_first' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'strategy_secure_first'); end if;
  if coalesce((v_counters->>'maxCoalitionsSingleGame')::integer, 0) >= 3 and not ('strategy_3_coalitions' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'strategy_3_coalitions'); end if;
  if coalesce((v_counters->>'maxSecuredStatesSingleGame')::integer, 0) >= 10 and not ('strategy_10_states' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'strategy_10_states'); end if;
  if coalesce((v_counters->>'maxWinEv')::integer, 0) >= 350 and not ('strategy_350_ev' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'strategy_350_ev'); end if;
  if coalesce((v_counters->>'fastestWinTurn')::integer, 99) <= 12 and not ('strategy_fast_win' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'strategy_fast_win'); end if;
  if coalesce((v_counters->>'onlineFinished')::integer, 0) >= 1 and not ('online_finish_first' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'online_finish_first'); end if;
  if coalesce((v_counters->>'onlineWon')::integer, 0) >= 1 and not ('online_win_first' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'online_win_first'); end if;
  if coalesce((v_counters->>'onlineWon')::integer, 0) >= 5 and not ('online_win_5' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'online_win_5'); end if;
  if coalesce((v_counters->>'onlineWon')::integer, 0) >= 10 and not ('online_win_10' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'online_win_10'); end if;
  if coalesce((v_counters->>'premiumUnlocks')::integer, 0) >= 1 and not ('roster_unlock_first' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'roster_unlock_first'); end if;
  if coalesce((v_counters->>'premiumUnlocks')::integer, 0) >= 3 and not ('roster_unlock_all' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'roster_unlock_all'); end if;
  if coalesce((v_counters->>'referralsRedeemed')::integer, 0) >= 1 and not ('community_referral_1' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'community_referral_1'); end if;
  if coalesce((v_counters->>'referralsRedeemed')::integer, 0) >= 3 and not ('community_referral_3' = any(v_claimed)) then v_claimable := array_append(v_claimable, 'community_referral_3'); end if;

  return jsonb_build_object(
    'balance', v_balance,
    'gameReward', v_reward,
    'dailyStreakReward', v_daily_reward,
    'dailyStreakDay', v_streak_count,
    'stats', v_stats,
    'achievementCounters', v_counters,
    'dailyStreak', jsonb_build_object('count', v_streak_count, 'lastDate', v_today::text),
    'newlyCompletedAchievements', to_jsonb(v_claimable),
    'claimedAchievements', to_jsonb(coalesce(v_claimed, '{}')),
    'candidateMastery', v_candidate_mastery,
    'masteryAward', v_mastery_award,
    'season', v_season
  );
end; $$;

-- ── RPC: claim_achievement_reward ───────────────────────────────────────────
create or replace function public.claim_achievement_reward(p_achievement_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof public.profiles;
  c jsonb;
  v_id text := btrim(coalesce(p_achievement_id, ''));
  v_amount integer;
  v_ok boolean := false;
  v_balance integer;
  v_claimed text[];
  v_premium_unlocks integer;
  v_referrals integer;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into prof from public.profiles where id = v_uid for update;
  if prof.id is null then raise exception 'claim_achievement_reward: no profile'; end if;
  c := coalesce(prof.achievement_counters, '{}'::jsonb);

  select count(*)::integer into v_premium_unlocks
    from unnest(prof.unlocked_characters) as u(id)
    where u.id in ('ronald_reagan', 'washington', 'starmer', 'farage', 'jfk');
  if to_regclass('public.referral_rewards') is not null then
    select count(*)::integer into v_referrals
      from public.referral_rewards
      where referrer_user_id = v_uid or referred_user_id = v_uid;
  else
    v_referrals := coalesce((c->>'referralsRedeemed')::integer, 0);
  end if;

  v_amount := case v_id
    when 'campaign_finish_first' then 10
    when 'campaign_win_first' then 25
    when 'campaign_finish_10' then 40
    when 'campaign_win_25' then 75
    when 'campaign_streak_5' then 100
    when 'bot_beat_easy' then 15
    when 'bot_beat_medium' then 35
    when 'bot_beat_hard' then 75
    when 'bot_beat_3_hard' then 100
    when 'bot_hard_350_ev' then 100
    when 'strategy_secure_first' then 15
    when 'strategy_3_coalitions' then 40
    when 'strategy_10_states' then 60
    when 'strategy_350_ev' then 80
    when 'strategy_fast_win' then 100
    when 'online_finish_first' then 20
    when 'online_win_first' then 50
    when 'online_win_5' then 75
    when 'online_win_10' then 100
    when 'roster_unlock_first' then 25
    when 'roster_unlock_all' then 100
    when 'community_referral_1' then 50
    when 'community_referral_3' then 100
    else null
  end;
  if v_amount is null then raise exception 'unknown achievement %', v_id; end if;
  if v_amount > 100 then raise exception 'achievement reward exceeds cap'; end if;

  v_ok := case v_id
    when 'campaign_finish_first' then coalesce((c->>'gamesFinished')::integer, 0) >= 1
    when 'campaign_win_first' then coalesce((c->>'gamesWon')::integer, 0) >= 1
    when 'campaign_finish_10' then coalesce((c->>'gamesFinished')::integer, 0) >= 10
    when 'campaign_win_25' then coalesce((c->>'gamesWon')::integer, 0) >= 25
    when 'campaign_streak_5' then coalesce((c->>'bestWinStreak')::integer, 0) >= 5
    when 'bot_beat_easy' then coalesce((c->>'botEasyWins')::integer, 0) >= 1
    when 'bot_beat_medium' then coalesce((c->>'botMediumWins')::integer, 0) >= 1
    when 'bot_beat_hard' then coalesce((c->>'botHardWins')::integer, 0) >= 1
    when 'bot_beat_3_hard' then coalesce((c->>'botThreeHardWins')::integer, 0) >= 1
    when 'bot_hard_350_ev' then coalesce((c->>'botHard350Wins')::integer, 0) >= 1
    when 'strategy_secure_first' then coalesce((c->>'securedStatesLifetime')::integer, 0) >= 1
    when 'strategy_3_coalitions' then coalesce((c->>'maxCoalitionsSingleGame')::integer, 0) >= 3
    when 'strategy_10_states' then coalesce((c->>'maxSecuredStatesSingleGame')::integer, 0) >= 10
    when 'strategy_350_ev' then coalesce((c->>'maxWinEv')::integer, 0) >= 350
    when 'strategy_fast_win' then coalesce((c->>'fastestWinTurn')::integer, 99) <= 12
    when 'online_finish_first' then coalesce((c->>'onlineFinished')::integer, 0) >= 1
    when 'online_win_first' then coalesce((c->>'onlineWon')::integer, 0) >= 1
    when 'online_win_5' then coalesce((c->>'onlineWon')::integer, 0) >= 5
    when 'online_win_10' then coalesce((c->>'onlineWon')::integer, 0) >= 10
    when 'roster_unlock_first' then v_premium_unlocks >= 1
    when 'roster_unlock_all' then v_premium_unlocks >= 3
    when 'community_referral_1' then v_referrals >= 1
    when 'community_referral_3' then v_referrals >= 3
    else false
  end;
  if not v_ok then raise exception 'achievement not complete: %', v_id; end if;

  insert into public.achievement_rewards (user_id, achievement_id, amount)
  values (v_uid, v_id, v_amount)
  on conflict (user_id, achievement_id) do nothing;

  if found then
    update public.profiles
      set campaign_funds = campaign_funds + v_amount, updated_at = now()
      where id = v_uid
      returning campaign_funds into v_balance;
  else
    v_amount := 0;
    v_balance := prof.campaign_funds;
  end if;

  select coalesce(array_agg(achievement_id order by achievement_id), '{}')
    into v_claimed
    from public.achievement_rewards
    where user_id = v_uid;

  return jsonb_build_object(
    'balance', v_balance,
    'amount', v_amount,
    'claimedAchievements', to_jsonb(coalesce(v_claimed, '{}'))
  );
end; $$;

-- ── RPC: train_candidate_mastery ────────────────────────────────────────────
-- Paid acceleration sink: spends Campaign Funds to raise an owned candidate to
-- the next mastery threshold. The server owns both the costs and level math.
create or replace function public.train_candidate_mastery(p_character text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof public.profiles;
  v_candidate_id text := nullif(btrim(coalesce(p_character, '')), '');
  v_owned boolean;
  v_floor integer;
  v_entry jsonb;
  v_prev_xp integer;
  v_prev_level integer;
  v_next_level integer;
  v_next_xp integer;
  v_cost integer;
  v_mastery jsonb;
  v_balance integer;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  if v_candidate_id not in (
    'tooley', 'trump', 'harris', 'lincoln', 'joe_biden',
    'ronald_reagan', 'washington', 'starmer', 'farage', 'jfk'
  ) then
    raise exception 'train_candidate_mastery: unknown character %', coalesce(v_candidate_id, '');
  end if;

  select * into prof from public.profiles where id = v_uid for update;
  if prof.id is null then raise exception 'train_candidate_mastery: no profile'; end if;

  v_owned := v_candidate_id in ('tooley', 'trump', 'harris', 'lincoln', 'joe_biden')
    or v_candidate_id = any(prof.unlocked_characters);
  if not v_owned then raise exception 'train_candidate_mastery: character not owned'; end if;

  v_floor := case
    when v_candidate_id = 'farage' then 3
    when v_candidate_id in ('ronald_reagan', 'washington', 'starmer', 'jfk') then 2
    else 1
  end;
  v_mastery := coalesce(prof.candidate_mastery, '{}'::jsonb);
  v_entry := coalesce(v_mastery -> v_candidate_id, '{}'::jsonb);
  v_prev_xp := greatest(0, coalesce((v_entry->>'xp')::integer, 0));
  v_prev_level := greatest(v_floor, case
    when v_prev_xp >= 4000 then 5
    when v_prev_xp >= 1800 then 4
    when v_prev_xp >= 900 then 3
    when v_prev_xp >= 150 then 2
    else 1
  end);
  if v_prev_level >= 5 then
    raise exception 'train_candidate_mastery: already max level';
  end if;

  v_next_level := v_prev_level + 1;
  v_next_xp := case v_next_level
    when 2 then 150
    when 3 then 900
    when 4 then 1800
    when 5 then 4000
    else null
  end;
  v_cost := case v_next_level
    when 2 then 750
    when 3 then 2000
    when 4 then 4500
    when 5 then 9000
    else null
  end;
  if v_next_xp is null or v_cost is null then
    raise exception 'train_candidate_mastery: invalid next level';
  end if;
  if prof.campaign_funds < v_cost then
    raise exception 'train_candidate_mastery: insufficient funds';
  end if;

  v_entry := jsonb_set(v_entry, '{xp}', to_jsonb(greatest(v_prev_xp, v_next_xp)), true);
  v_entry := jsonb_set(v_entry, '{level}', to_jsonb(v_next_level), true);
  v_mastery := jsonb_set(v_mastery, array[v_candidate_id], v_entry, true);

  update public.profiles
    set campaign_funds = campaign_funds - v_cost,
        candidate_mastery = v_mastery,
        updated_at = now()
    where id = v_uid
    returning campaign_funds into v_balance;

  return jsonb_build_object(
    'balance', v_balance,
    'candidateMastery', v_mastery,
    'trainingAward', jsonb_build_object(
      'candidateId', v_candidate_id,
      'cost', v_cost,
      'previousLevel', v_prev_level,
      'newLevel', v_next_level,
      'xp', greatest(v_prev_xp, v_next_xp)
    )
  );
end; $$;

-- ── GRANTs (A5) — explicit so authenticated clients can call the RPCs ────────
revoke execute on function public.claim_game_reward(text, boolean, integer, integer, integer) from public, anon;
grant execute on function public.claim_game_reward(text, boolean, integer, integer, integer)
  to authenticated;
revoke execute on function public.complete_game_result(text, boolean, integer, integer, integer, text, text, integer, integer, integer, text, integer) from public, anon;
grant execute on function public.complete_game_result(text, boolean, integer, integer, integer, text, text, integer, integer, integer, text, integer)
  to authenticated;
revoke execute on function public.claim_achievement_reward(text) from public, anon;
grant execute on function public.claim_achievement_reward(text)
  to authenticated;
revoke execute on function public.train_candidate_mastery(text) from public, anon;
grant execute on function public.train_candidate_mastery(text) to authenticated;
revoke execute on function public.unlock_character(text) from public, anon;
grant execute on function public.unlock_character(text) to authenticated;
