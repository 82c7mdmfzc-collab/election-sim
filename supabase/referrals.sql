-- ════════════════════════════════════════════════════════════════════════════
-- Elector — Referral program (invite → both earn Campaign Funds)
--
-- Apply in Supabase Dashboard → SQL Editor AFTER profiles.sql AND rewards.sql.
-- Idempotent: safe to re-run.
--
-- DESIGN
--   • Each account has an opaque referral_code (generated lazily, server-side).
--   • A brand-new account records who referred them via set_referrer(code) — but
--     ONLY before they've finished any game (prevents established players from
--     retro-attributing themselves).
--   • The reward is GATED ON THE INVITEE FINISHING ONE GAME, not on signup. We
--     reuse the existing game_rewards ledger as the proof-of-play: an AFTER INSERT
--     trigger on game_rewards attempts redemption. The first completed game after
--     a referrer is set pays BOTH parties; the unique referral_rewards key makes
--     it fire exactly once per invited account, ever (anti-fraud).
--   • Rewards are NEVER tied to leaving a store review (Apple 3.1.1 / Google policy).
-- ════════════════════════════════════════════════════════════════════════════

-- Per-account referral code + who referred this account.
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by   uuid references public.profiles(id);

create unique index if not exists profiles_referral_code_uidx
  on public.profiles (referral_code) where referral_code is not null;

-- ── Ledger: one payout per invited account, ever (idempotency / anti-fraud) ───
create table if not exists public.referral_rewards (
  referred_user_id uuid        not null references auth.users(id) on delete cascade,
  referrer_user_id uuid        not null references auth.users(id) on delete cascade,
  amount           integer     not null,
  created_at       timestamptz not null default now(),
  primary key (referred_user_id)
);

alter table public.referral_rewards enable row level security;

-- Either side of the referral may read their own rows; writes happen only via the
-- SECURITY DEFINER trigger below (no insert/update/delete policy).
drop policy if exists referral_rewards_select_own on public.referral_rewards;
create policy referral_rewards_select_own on public.referral_rewards
  for select using (auth.uid() = referrer_user_id or auth.uid() = referred_user_id);

-- ── RPC: get_my_referral_code ────────────────────────────────────────────────
-- Returns the caller's code, allocating one on first call. Retries on the (rare)
-- collision against the unique index.
create or replace function public.get_my_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_code text;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select referral_code into v_code from public.profiles where id = v_uid;
  if v_code is not null then return v_code; end if;

  for _i in 1..6 loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      update public.profiles set referral_code = v_code, updated_at = now() where id = v_uid;
      return v_code;
    exception when unique_violation then
      -- collided; loop and try a fresh code
    end;
  end loop;
  raise exception 'get_my_referral_code: could not allocate a unique code';
end; $$;

-- ── RPC: set_referrer ────────────────────────────────────────────────────────
-- Records who referred the caller. One-time, and only valid for a genuinely new
-- account (no prior game). Returns a status the client can map to UI.
--   'ok' | 'already_set' | 'not_eligible' | 'invalid_code' | 'self'
create or replace function public.set_referrer(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_existing uuid;
  v_ref      uuid;
  v_games    integer;
begin
  if v_uid is null then raise exception 'auth required'; end if;

  select referred_by into v_existing from public.profiles where id = v_uid for update;
  if not found then raise exception 'set_referrer: no profile'; end if;
  if v_existing is not null then return 'already_set'; end if;

  -- Only a brand-new account (hasn't finished a game) may attribute a referrer.
  select count(*) into v_games from public.game_rewards where user_id = v_uid;
  if v_games > 0 then return 'not_eligible'; end if;

  select id into v_ref from public.profiles where referral_code = upper(btrim(coalesce(p_code, '')));
  if v_ref is null then return 'invalid_code'; end if;
  if v_ref = v_uid then return 'self'; end if;

  update public.profiles set referred_by = v_ref, updated_at = now() where id = v_uid;
  return 'ok';
end; $$;

-- ── Redemption: fires when the invitee finishes a game ───────────────────────
-- Internal (no client grant). Credits both parties once; the unique PK on
-- referral_rewards.referred_user_id guarantees exactly-once payout.
create or replace function public._redeem_referral(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ref  uuid;
  v_roll float;
  v_bonus integer;
begin
  select referred_by into v_ref from public.profiles where id = p_user;
  if v_ref is null then return; end if;

  -- Weighted random reward: 45% → 250, 30% → 500, 25% → 750
  v_roll := random();
  if v_roll < 0.45 then
    v_bonus := 250;
  elsif v_roll < 0.75 then
    v_bonus := 500;
  else
    v_bonus := 750;
  end if;

  insert into public.referral_rewards (referred_user_id, referrer_user_id, amount)
  values (p_user, v_ref, v_bonus)
  on conflict (referred_user_id) do nothing;
  if not found then return; end if;   -- already redeemed

  update public.profiles
    set campaign_funds = campaign_funds + v_bonus, updated_at = now()
    where id in (p_user, v_ref);

  update public.profiles
    set achievement_counters = jsonb_set(
          coalesce(achievement_counters, '{}'::jsonb),
          '{referralsRedeemed}',
          to_jsonb(coalesce((achievement_counters->>'referralsRedeemed')::integer, 0) + 1),
          true
        ),
        updated_at = now()
    where id in (p_user, v_ref);
end; $$;

create or replace function public.on_game_reward_redeem_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._redeem_referral(new.user_id);
  return new;
end; $$;

drop trigger if exists trg_game_reward_referral on public.game_rewards;
create trigger trg_game_reward_referral
  after insert on public.game_rewards
  for each row execute function public.on_game_reward_redeem_referral();

-- ── GRANTs ───────────────────────────────────────────────────────────────────
revoke execute on function public.get_my_referral_code()        from anon;
revoke execute on function public.set_referrer(text)            from anon;
revoke execute on function public._redeem_referral(uuid)        from public, anon, authenticated;
grant  execute on function public.get_my_referral_code()        to authenticated;
grant  execute on function public.set_referrer(text)            to authenticated;
