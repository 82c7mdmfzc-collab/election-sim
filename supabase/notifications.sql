-- ════════════════════════════════════════════════════════════════════════════
-- Remote push device tokens — for multiplayer "your turn" notifications (APNs).
--
-- Apply in Supabase Dashboard → SQL Editor. Idempotent: safe to re-run.
--
-- Each signed-in device upserts its APNs (or future FCM) token here on launch/
-- login and deletes it on sign-out. The resolve-turn edge function (service role)
-- reads these to send pushes, and prunes any token APNs reports as 410.
--
-- RLS: a user manages ONLY their own tokens. The service role bypasses RLS, so no
-- explicit grant is needed for the edge function to read/delete for sending.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.device_tokens (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  token       text        not null,
  platform    text        not null default 'ios',     -- 'ios' | 'android'
  environment text        not null default 'prod',     -- 'prod' | 'sandbox' (APNs host)
  updated_at  timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.device_tokens enable row level security;

-- Owner-only access (select / insert / update / delete). The composite policy set
-- lets the client upsert (insert + on-conflict update) and delete its own rows.
drop policy if exists device_tokens_select_own on public.device_tokens;
create policy device_tokens_select_own on public.device_tokens
  for select using (auth.uid() = user_id);

drop policy if exists device_tokens_insert_own on public.device_tokens;
create policy device_tokens_insert_own on public.device_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists device_tokens_update_own on public.device_tokens;
create policy device_tokens_update_own on public.device_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists device_tokens_delete_own on public.device_tokens;
create policy device_tokens_delete_own on public.device_tokens
  for delete using (auth.uid() = user_id);

-- Recipient lookup joins lobby_participants.auth_uid → device_tokens.user_id.
create index if not exists device_tokens_user_idx on public.device_tokens (user_id);
