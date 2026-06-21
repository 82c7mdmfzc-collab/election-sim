-- iap.sql — server-authoritative purchase fulfillment.
--
-- Called by the fulfill-purchase edge function (native Apple/Google IAP) AFTER the
-- receipt has been verified. The SERVER owns the SKU catalog so the client can never
-- pick the amount. Idempotent on the transaction id, so a duplicate / replayed
-- receipt never double-credits.
--
-- Contract (must match the edge callers):
--   fulfill_purchase(p_user uuid, p_platform text, p_transaction_id text, p_sku text)
--     returns integer  -- the resulting campaign_funds balance

-- Ledger / idempotency key. Service-role only (RLS on, no policies).
create table if not exists public.purchases (
  transaction_id text primary key,
  user_id        uuid not null,
  sku            text not null,
  platform       text not null,
  created_at     timestamptz not null default now()
);
alter table public.purchases enable row level security;

create or replace function public.fulfill_purchase(
  p_user uuid,
  p_platform text,
  p_transaction_id text,
  p_sku text
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_funds   integer;
  v_char    text;
  v_balance integer;
  v_fresh   integer := 0;
begin
  -- Idempotency: record the transaction once. A replayed receipt hits the conflict
  -- and credits nothing — we just return the balance.
  insert into public.purchases (transaction_id, user_id, sku, platform)
  values (p_transaction_id, p_user, p_sku, p_platform)
  on conflict (transaction_id) do nothing;
  get diagnostics v_fresh = row_count;  -- 1 = newly inserted, 0 = already processed

  if v_fresh = 1 then
    -- Campaign Funds bundles (server-owned amounts).
    v_funds := case p_sku
      when 'funds_1500'  then 1500
      when 'funds_4000'  then 4000
      when 'funds_9000'  then 9000
      when 'funds_20000' then 20000
      else null end;

    if v_funds is not null then
      update public.profiles
        set campaign_funds = campaign_funds + v_funds, updated_at = now()
        where id = p_user;
    elsif p_sku like 'unlock_%' then
      -- Character unlocks bought with cash. SKU 'unlock_<id>' → character id.
      v_char := substring(p_sku from 8);
      if v_char not in ('joe_biden','ronald_reagan','washington','starmer','farage','jfk') then
        raise exception 'fulfill_purchase: unknown unlock sku %', p_sku;
      end if;
      update public.profiles
        set unlocked_characters = case
              when v_char = any(unlocked_characters) then unlocked_characters
              else array_append(unlocked_characters, v_char) end,
            updated_at = now()
        where id = p_user;
    else
      raise exception 'fulfill_purchase: unknown sku %', p_sku;
    end if;
  end if;

  select campaign_funds into v_balance from public.profiles where id = p_user;
  return coalesce(v_balance, 0);
end; $$;

revoke execute on function public.fulfill_purchase(uuid, text, text, text) from public, anon, authenticated;
grant  execute on function public.fulfill_purchase(uuid, text, text, text) to service_role;
