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

alter table public.game_rewards enable row level security;

-- Owner may read their own ledger; writes happen only via the SECURITY DEFINER RPC.
drop policy if exists game_rewards_select_own on public.game_rewards;
create policy game_rewards_select_own on public.game_rewards
  for select using (auth.uid() = user_id);

-- Progression columns live on profiles but are created here too so rewards.sql
-- remains idempotent when applied after an older profiles.sql.
alter table public.profiles add column if not exists achievement_counters jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists daily_streak jsonb not null default '{}'::jsonb;

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
begin
  if v_uid is null then raise exception 'auth required'; end if;
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
      'claimedAchievements', to_jsonb(coalesce(v_claimed, '{}'))
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

  update public.profiles
    set campaign_funds = campaign_funds + v_reward + v_daily_reward,
        stats = v_stats,
        achievement_counters = v_counters,
        daily_streak = jsonb_build_object('count', v_streak_count, 'lastDate', v_today::text),
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
    'claimedAchievements', to_jsonb(coalesce(v_claimed, '{}'))
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
revoke execute on function public.unlock_character(text) from public, anon;
grant execute on function public.unlock_character(text) to authenticated;
