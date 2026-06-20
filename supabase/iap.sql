-- ════════════════════════════════════════════════════════════════════════════
-- Elector — In-App Purchases (real money → Campaign Funds / character unlocks)
--
-- Apply in Supabase Dashboard → SQL Editor AFTER profiles.sql. Idempotent.
--
-- SECURITY MODEL
--   • The client NEVER credits itself. Purchases are fulfilled only by trusted
--     server code (Edge Functions running with the service-role key) AFTER the
--     receipt is verified with the platform:
--       - web      → Stripe webhook (signature-verified) → fulfill_purchase
--       - ios      → App Store Server API verifies the signed transaction
--       - android  → Google Play Developer API verifies the purchase token
--   • The SERVER owns the SKU catalog (funds/characters per SKU) here in SQL, so
--     even the Edge Function can't pick an arbitrary amount — it passes only the
--     verified (platform, transaction_id, sku).
--   • Idempotency: one credit per (platform, transaction_id). Replayed webhooks
--     or re-sent receipts are no-ops that return the current balance.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Ledger: one row per fulfilled purchase (idempotency key) ─────────────────
create table if not exists public.purchases (
  platform           text        not null check (platform in ('ios', 'android', 'web')),
  transaction_id     text        not null,
  user_id            uuid        not null references auth.users(id) on delete cascade,
  sku                text        not null,
  funds_granted      integer     not null default 0,
  characters_granted text[]      not null default '{}',
  created_at         timestamptz not null default now(),
  primary key (platform, transaction_id)
);

alter table public.purchases enable row level security;

-- Owner may read their own purchase history; writes happen only via the
-- service-role RPC below (no insert/update/delete policy for normal clients).
drop policy if exists purchases_select_own on public.purchases;
create policy purchases_select_own on public.purchases
  for select using (auth.uid() = user_id);

-- ── RPC: fulfill_purchase (service-role only) ────────────────────────────────
-- Credits the user for a verified purchase. Atomic + idempotent. Returns the new
-- Campaign Funds balance.
create or replace function public.fulfill_purchase(
  p_user           uuid,
  p_platform       text,
  p_transaction_id text,
  p_sku            text
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_funds   integer := 0;
  v_chars   text[]  := '{}';
  v_balance integer;
begin
  if p_user is null then raise exception 'fulfill_purchase: user required'; end if;
  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'fulfill_purchase: invalid platform %', p_platform;
  end if;
  if p_transaction_id is null or length(p_transaction_id) < 1 then
    raise exception 'fulfill_purchase: transaction_id required';
  end if;

  -- SERVER-OWNED catalog. Consumable Funds bundles + (future) direct unlocks.
  -- $ price strings are configured in each store console; these are the grants.
  case p_sku
    when 'funds_small'          then v_funds := 1200;   -- ~$0.99
    when 'funds_medium'         then v_funds := 7000;   -- ~$4.99 (bonus value)
    when 'funds_large'          then v_funds := 16000;  -- ~$9.99 (best value)
    when 'unlock_washington'    then v_chars := array['washington'];
    when 'unlock_joe_biden'     then v_chars := array['joe_biden'];
    when 'unlock_ronald_reagan' then v_chars := array['ronald_reagan'];
    else raise exception 'fulfill_purchase: unknown sku %', p_sku;
  end case;

  -- Idempotency: first fulfillment for this transaction wins; repeats are no-ops.
  insert into public.purchases (platform, transaction_id, user_id, sku, funds_granted, characters_granted)
  values (p_platform, p_transaction_id, p_user, p_sku, v_funds, v_chars)
  on conflict (platform, transaction_id) do nothing;

  if not found then
    select campaign_funds into v_balance from public.profiles where id = p_user;
    return coalesce(v_balance, 0);
  end if;

  update public.profiles
    set campaign_funds      = campaign_funds + v_funds,
        unlocked_characters = (select array(select distinct unnest(unlocked_characters || v_chars))),
        updated_at          = now()
    where id = p_user
    returning campaign_funds into v_balance;
  if v_balance is null then raise exception 'fulfill_purchase: no profile'; end if;
  return v_balance;
end; $$;

-- Only trusted server code (Edge Functions with the service role) may fulfill.
revoke execute on function public.fulfill_purchase(uuid, text, text, text) from public, anon, authenticated;
grant  execute on function public.fulfill_purchase(uuid, text, text, text) to service_role;
