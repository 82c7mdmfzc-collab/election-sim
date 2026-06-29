-- daily.sql — cross-device Daily Challenge tracking.
--
-- Apply in Supabase SQL editor AFTER profiles.sql. Idempotent.
--
-- A per-account `daily_challenge` jsonb mirrors the device-local record
-- (src/utils/localPrefs.ts DailyChallengeLocal) so the consecutive-day streak and
-- today's status follow the player across devices. This is DISTINCT from the
-- login `daily_streak` (rewards.sql) — it tracks the Daily Challenge specifically.
-- The streak math mirrors complete_game_result's UTC today / today-1 logic.
--
-- Shape: { count:int, lastDate:'YYYY-MM-DD', lastWonDate:'YYYY-MM-DD'|null, lastEv:int }

alter table public.profiles add column if not exists daily_challenge jsonb not null default '{}'::jsonb;

-- ── record_daily_result: idempotent per UTC day; advances the consecutive streak ──
create or replace function public.record_daily_result(p_date_key text, p_won boolean, p_ev integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  prof        public.profiles;
  v_date      date;
  v_prev      jsonb;
  v_prev_date date;
  v_count     integer;
  v_last_won  text;
  v_ev        integer := greatest(0, least(coalesce(p_ev, 0), 538));
  v_result    jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  begin
    v_date := p_date_key::date;
  exception when others then
    raise exception 'record_daily_result: invalid date_key %', p_date_key;
  end;

  select * into prof from public.profiles where id = v_uid for update;
  if prof.id is null then raise exception 'record_daily_result: no profile'; end if;

  v_prev := coalesce(prof.daily_challenge, '{}'::jsonb);
  begin
    v_prev_date := nullif(v_prev->>'lastDate', '')::date;
  exception when others then
    v_prev_date := null;
  end;
  v_last_won := nullif(v_prev->>'lastWonDate', '');

  if v_prev_date = v_date then
    -- Re-played the same day: keep the streak, just refresh EV / won flag.
    v_count := greatest(0, coalesce((v_prev->>'count')::integer, 0));
  elsif v_prev_date = v_date - 1 then
    v_count := greatest(0, coalesce((v_prev->>'count')::integer, 0)) + 1;
  else
    v_count := 1;
  end if;
  if p_won then v_last_won := v_date::text; end if;

  v_result := jsonb_build_object(
    'count', v_count,
    'lastDate', v_date::text,
    'lastWonDate', v_last_won,
    'lastEv', v_ev
  );

  update public.profiles
    set daily_challenge = v_result, updated_at = now()
    where id = v_uid;

  return v_result;
end; $$;

-- ── get_daily_status: returns the stored daily_challenge jsonb (or {}) ────────────
create or replace function public.get_daily_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_dc jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select daily_challenge into v_dc from public.profiles where id = v_uid;
  return coalesce(v_dc, '{}'::jsonb);
end; $$;

revoke execute on function public.record_daily_result(text, boolean, integer) from public, anon;
grant  execute on function public.record_daily_result(text, boolean, integer) to authenticated;
revoke execute on function public.get_daily_status() from public, anon;
grant  execute on function public.get_daily_status() to authenticated;

-- ── claim_login_bonus: a small Campaign Funds chest, once per UTC day ─────────────
-- Distinct from the Daily Challenge AND from the finish-streak (rewards.sql): this
-- rewards simply OPENING the app each day. Idempotent — the second call on the same
-- UTC day grants 0. The client calls it on every launch; the date check is the gate.
-- Shape stored on profiles.login_bonus: { lastDate:'YYYY-MM-DD' }.
alter table public.profiles add column if not exists login_bonus jsonb not null default '{}'::jsonb;

create or replace function public.claim_login_bonus()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  prof      public.profiles;
  c_amount  constant integer := 10;
  v_today   date := (now() at time zone 'utc')::date;
  v_last    date;
  v_amount  integer := 0;
  v_balance integer;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  select * into prof from public.profiles where id = v_uid for update;
  if prof.id is null then raise exception 'claim_login_bonus: no profile'; end if;

  begin
    v_last := nullif(prof.login_bonus->>'lastDate', '')::date;
  exception when others then
    v_last := null;
  end;

  if v_last is distinct from v_today then
    v_amount := c_amount;
    update public.profiles
      set campaign_funds = campaign_funds + v_amount,
          login_bonus = jsonb_build_object('lastDate', v_today::text),
          updated_at = now()
      where id = v_uid
      returning campaign_funds into v_balance;
  else
    v_balance := prof.campaign_funds;
  end if;

  return jsonb_build_object('amount', v_amount, 'balance', v_balance, 'lastDate', v_today::text);
end; $$;

revoke execute on function public.claim_login_bonus() from public, anon;
grant  execute on function public.claim_login_bonus() to authenticated;
