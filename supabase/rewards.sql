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

alter table public.game_rewards enable row level security;

-- Owner may read their own ledger; writes happen only via the SECURITY DEFINER RPC.
drop policy if exists game_rewards_select_own on public.game_rewards;
create policy game_rewards_select_own on public.game_rewards
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
  c_base         constant integer := 100;
  c_win          constant integer := 400;
  c_per_secured  constant integer := 10;
  c_per_coalition constant integer := 50;
  c_per_streak   constant integer := 50;
  c_max_streak   constant integer := 5;
  c_reward_cap   constant integer := 5000;   -- per-game cap (matches REWARD_CAP)
  c_daily_cap    constant integer := 20000;  -- rolling 24h cap per account
  v_secured      integer;
  v_coalitions   integer;
  v_streak       integer;
  v_reward       integer;
  v_today        integer;
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

  v_reward := c_base
            + (case when p_won then c_win else 0 end)
            + v_secured * c_per_secured
            + v_coalitions * c_per_coalition
            + (case when p_won then least(v_streak, c_max_streak) * c_per_streak else 0 end);
  v_reward := least(v_reward, c_reward_cap);

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

-- ── GRANTs (A5) — explicit so anon/auth clients can call the RPCs ────────────
grant execute on function public.claim_game_reward(text, boolean, integer, integer, integer)
  to anon, authenticated;
grant execute on function public.award_funds(integer)        to anon, authenticated;
grant execute on function public.unlock_character(text)      to anon, authenticated;
