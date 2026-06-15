-- ════════════════════════════════════════════════════════════════════════════
-- 270 — Multiplayer Lobbies: hardened schema, RLS, and identity-bound RPCs
--
-- Apply in Supabase Dashboard → SQL Editor AFTER profiles.sql. Idempotent.
--
-- WHY THIS FILE EXISTS
--   The `lobbies` table was originally created ad-hoc in the dashboard and the
--   client wrote to it with direct `.insert()` / `.update()` calls. A security
--   probe confirmed the table was world-readable by anonymous users and (by
--   inference, since direct client writes had to succeed) world-writable. That
--   let any anon user enumerate and overwrite every game in progress.
--
-- SECURITY MODEL (this file)
--   • Every browser has a Supabase auth identity (anonymous sign-in). We bind
--     each in-game player UUID to the auth.uid() that controls it via the
--     `lobby_participants` table, populated by create/join RPCs.
--   • RLS: a row is readable only by its participants, plus open lobbies in the
--     `waiting` state (so a room code can be looked up before joining).
--   • NO direct client INSERT/UPDATE/DELETE. All mutations flow through
--     SECURITY DEFINER RPCs that validate the caller:
--       - create_lobby ........ caller becomes host; records host participant
--       - join_lobby_player ... caller is bound to the player UUID they claim
--       - start_game .......... host only
--       - submit_turn_pending . caller may only submit AS the player they own
--       - push_game_state ..... host only (drives RESOLUTION / phase changes)
--       - set_lobby_status .... host only (mark finished)
--
-- RESIDUAL RISK (documented, not fully closed here)
--   Turn RESOLUTION is now server-authoritative — it runs in the `resolve-turn`
--   Edge Function with the service-role key, so the host can no longer doctor a
--   resolved turn. What the host still pushes via push_game_state are the
--   non-economic phase transitions (RESOLUTION→next PLANNING, election tally,
--   completeTally). A malicious host could still tamper with those; moving the
--   election/winner computation server-side is the remaining follow-up. This
--   file removes the far larger risk of *any anonymous third party* tampering
--   with lobbies they are not in.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Table (created if the ad-hoc one is missing; otherwise left intact) ───────
create table if not exists public.lobbies (
  id           uuid primary key default gen_random_uuid(),
  room_code    text        not null,
  is_public    boolean     not null default false,
  status       text        not null default 'waiting'
                 check (status in ('waiting', 'in_progress', 'finished')),
  player_count integer     not null default 2,
  game_state   jsonb,
  host_uid     uuid,                       -- auth.uid() of the host (set on create)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Idempotent add for tables that pre-date the host_uid column.
alter table public.lobbies add column if not exists host_uid uuid;

-- ── Membership: binds an auth user to the player UUID it controls in a lobby ──
create table if not exists public.lobby_participants (
  lobby_id   uuid not null references public.lobbies(id) on delete cascade,
  auth_uid   uuid not null default auth.uid(),
  player_id  text not null,                -- the in-game WaitingPlayer.id (client UUID)
  joined_at  timestamptz not null default now(),
  primary key (lobby_id, player_id)
);
create index if not exists lobby_participants_uid_idx
  on public.lobby_participants (auth_uid);

alter table public.lobbies            enable row level security;
alter table public.lobby_participants enable row level security;

-- ── Drop ALL pre-existing policies (the ad-hoc table shipped with a permissive
--    "read/write for all" policy under an unknown name; `drop policy if exists`
--    by our own name would miss it and it would OR with ours, leaving the table
--    world-readable/writable). This wipes the slate before we recreate intent. ──
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('lobbies', 'lobby_participants')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ── Identity helpers (SECURITY DEFINER so they can read despite RLS) ──────────
create or replace function public.is_lobby_participant(p_lobby_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.lobby_participants
    where lobby_id = p_lobby_id and auth_uid = auth.uid()
  );
$$;

create or replace function public.is_lobby_host(p_lobby_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.lobbies
    where id = p_lobby_id and host_uid = auth.uid()
  );
$$;

-- ── RLS policies ──────────────────────────────────────────────────────────────
-- Reads: participants always; plus public+waiting rooms for code lookup/discovery.
drop policy if exists lobbies_select on public.lobbies;
create policy lobbies_select on public.lobbies
  for select
  using (
    public.is_lobby_participant(id)
    or (status = 'waiting' and is_public = true)
    or (status = 'waiting')          -- private rooms still need code lookup to join
  );

-- No direct client writes: every mutation goes through a SECURITY DEFINER RPC.
-- (Absence of INSERT/UPDATE/DELETE policies = denied for anon/authenticated.)

drop policy if exists participants_select on public.lobby_participants;
create policy participants_select on public.lobby_participants
  for select using (auth_uid = auth.uid());

-- ── RPC: create_lobby — caller becomes the host ───────────────────────────────
create or replace function public.create_lobby(
  p_room_code    text,
  p_is_public    boolean,
  p_player_count integer,
  p_game_state   jsonb            -- WaitingLobbyState; game_state.hostPlayerId is the host's player UUID
)
returns setof public.lobbies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_host_pid  text := p_game_state->>'hostPlayerId';
  v_row       public.lobbies;
begin
  if v_uid is null then
    raise exception 'auth required';
  end if;
  if v_host_pid is null then
    raise exception 'game_state.hostPlayerId required';
  end if;
  -- Room codes are short alphanumeric tokens; reject anything malformed so a
  -- crafted code can't be silently truncated into a colliding/odd value.
  if p_room_code is null or p_room_code !~ '^[A-Za-z0-9]{1,12}$' then
    raise exception 'invalid room_code';
  end if;

  insert into public.lobbies (room_code, is_public, player_count, status, game_state, host_uid)
  values (p_room_code, coalesce(p_is_public, false),
          greatest(2, least(coalesce(p_player_count, 2), 6)), 'waiting', p_game_state, v_uid)
  returning * into v_row;

  insert into public.lobby_participants (lobby_id, auth_uid, player_id)
  values (v_row.id, v_uid, v_host_pid)
  on conflict do nothing;

  return next v_row;
end;
$$;

-- ── RPC: join_lobby_player — bind caller to the claimed player UUID ────────────
create or replace function public.join_lobby_player(
  p_lobby_id uuid,
  p_player   jsonb               -- WaitingPlayer { id, candidateId, name, isHost }
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_pid    text := p_player->>'id';
  v_state  jsonb;
  v_status text;
  v_cap    integer;
  v_count  integer;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  if v_pid is null then raise exception 'player.id required'; end if;

  select game_state, status, player_count
    into v_state, v_status, v_cap
    from public.lobbies where id = p_lobby_id for update;

  if v_state is null then raise exception 'lobby not found'; end if;
  if v_status <> 'waiting' then raise exception 'lobby not joinable'; end if;

  v_count := coalesce(jsonb_array_length(v_state->'players'), 0);
  if v_count >= coalesce(v_cap, 2) then raise exception 'lobby full'; end if;

  -- Reject a player UUID that already exists in the room (anti-spoof / dup).
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_state->'players', '[]'::jsonb)) e
    where e->>'id' = v_pid
  ) then
    raise exception 'player already present';
  end if;

  update public.lobbies
     set game_state = jsonb_set(
           v_state, '{players}',
           coalesce(v_state->'players', '[]'::jsonb) || jsonb_build_array(p_player)),
         updated_at = now()
   where id = p_lobby_id;

  insert into public.lobby_participants (lobby_id, auth_uid, player_id)
  values (p_lobby_id, v_uid, v_pid)
  on conflict (lobby_id, player_id) do update set auth_uid = excluded.auth_uid;
end;
$$;

-- ── RPC: ensure_participant — repair a missing participant binding on rejoin ───
-- Called on session restore (page refresh / device switch). If the caller's seat
-- exists in the lobby but their lobby_participants row is missing (e.g. an earlier
-- insert was lost), this rebinds it to the caller. SECURITY: it will NOT hijack a
-- seat already bound to a DIFFERENT auth user — only an unbound or self-owned seat
-- is (re)claimed. With durable accounts the binding is stable, so this is a no-op
-- safety net rather than the primary mechanism.
create or replace function public.ensure_participant(
  p_lobby_id  uuid,
  p_player_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_state jsonb;
  v_owner uuid;
begin
  if v_uid is null then raise exception 'auth required'; end if;

  select game_state into v_state from public.lobbies where id = p_lobby_id;
  if v_state is null then raise exception 'lobby not found'; end if;

  -- The seat must be a real player in this lobby.
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_state->'players', '[]'::jsonb)) e
    where e->>'id' = p_player_id
  ) then
    raise exception 'unknown seat';
  end if;

  select auth_uid into v_owner
    from public.lobby_participants
    where lobby_id = p_lobby_id and player_id = p_player_id;

  -- Refuse to take over a seat already owned by a different account.
  if v_owner is not null and v_owner <> v_uid then
    raise exception 'seat owned by another account';
  end if;

  insert into public.lobby_participants (lobby_id, auth_uid, player_id)
  values (p_lobby_id, v_uid, p_player_id)
  on conflict (lobby_id, player_id) do update set auth_uid = excluded.auth_uid;
end;
$$;

-- ── RPC: start_game — host transitions waiting → in_progress ───────────────────
create or replace function public.start_game(
  p_lobby_id   uuid,
  p_game_state jsonb               -- full LobbyGameState (phase='PLANNING')
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_lobby_host(p_lobby_id) then
    raise exception 'only the host may start the game';
  end if;
  update public.lobbies
     set status = 'in_progress', game_state = p_game_state, updated_at = now()
   where id = p_lobby_id;
end;
$$;

-- ── RPC: submit_turn_pending — caller may only submit as the player they own ───
create or replace function public.submit_turn_pending(
  p_lobby_id       uuid,
  p_player_id      text,
  p_pending        jsonb,          -- PendingPurchase[] for this player
  p_submitted_list jsonb           -- DEPRECATED/ignored: submittedPlayers is now merged server-side
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_state     jsonb;
  v_submitted jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;

  -- Identity binding: the caller must own p_player_id in THIS lobby.
  if not exists (
    select 1 from public.lobby_participants
    where lobby_id = p_lobby_id and player_id = p_player_id and auth_uid = v_uid
  ) then
    raise exception 'cannot submit as another player';
  end if;

  select game_state into v_state from public.lobbies where id = p_lobby_id for update;
  if v_state is null then raise exception 'lobby not found'; end if;

  -- Merge this player into the AUTHORITATIVE submittedPlayers array server-side
  -- (under the row lock above) instead of trusting the client-supplied list.
  -- A client's p_submitted_list is computed from its own local snapshot, which
  -- is frequently stale (it hasn't yet received the other players' Realtime
  -- submission events). Overwriting with it let a late/concurrent submit clobber
  -- earlier submitters, so resolve-turn would see "not all submitted" and the
  -- turn never resolved — every player stuck on "Thinking…". Appending by player
  -- id makes concurrent submits commutative and idempotent.
  v_submitted := coalesce(v_state -> 'submittedPlayers', '[]'::jsonb);
  if not (v_submitted @> to_jsonb(p_player_id)) then
    v_submitted := v_submitted || to_jsonb(p_player_id);
  end if;

  -- Build the path as a real text[] (array['pendingSubmissions', p_player_id])
  -- rather than concatenating p_player_id into a '{...}' path literal. The array
  -- form treats p_player_id as a single, literal path element, so a crafted id
  -- containing ',' or '}' can't inject extra JSON path segments.
  update public.lobbies
     set game_state = jsonb_set(
           jsonb_set(v_state, array['pendingSubmissions', p_player_id], p_pending, true),
           '{submittedPlayers}', v_submitted, true),
         updated_at = now()
   where id = p_lobby_id;
end;
$$;

-- ── RPC: push_game_state — DEPRECATED & DISABLED ──────────────────────────────
-- All turn resolution and phase transitions are now server-authoritative inside
-- the resolve-turn Edge Function, which writes the lobby row with the service-role
-- key (bypassing this RPC and RLS). Allowing the host to push an arbitrary
-- game_state let a malicious host fabricate election outcomes, skip turns, or
-- rewrite other players' state. The body now hard-fails and EXECUTE is revoked
-- from clients below; kept as a tombstone so old clients get a clear error.
create or replace function public.push_game_state(
  p_lobby_id   uuid,
  p_game_state jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'push_game_state is disabled: phase transitions are server-authoritative';
end;
$$;

-- ── RPC: set_lobby_status — host marks the lobby finished ──────────────────────
create or replace function public.set_lobby_status(
  p_lobby_id uuid,
  p_status   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_lobby_host(p_lobby_id) then
    raise exception 'only the host may change lobby status';
  end if;
  if p_status not in ('waiting', 'in_progress', 'finished') then
    raise exception 'invalid status';
  end if;
  update public.lobbies set status = p_status, updated_at = now() where id = p_lobby_id;
end;
$$;

-- ── Grants: RPCs callable by anon + authenticated; tables NOT directly writable ─
grant execute on function public.create_lobby(text, boolean, integer, jsonb)      to anon, authenticated;
grant execute on function public.join_lobby_player(uuid, jsonb)                    to anon, authenticated;
grant execute on function public.start_game(uuid, jsonb)                           to anon, authenticated;
grant execute on function public.submit_turn_pending(uuid, text, jsonb, jsonb)     to anon, authenticated;
grant execute on function public.ensure_participant(uuid, text)                    to anon, authenticated;
grant execute on function public.set_lobby_status(uuid, text)                      to anon, authenticated;
-- push_game_state is deprecated/disabled — revoke so no client can call it.
revoke execute on function public.push_game_state(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.is_lobby_participant(uuid)                        to anon, authenticated;
grant execute on function public.is_lobby_host(uuid)                               to anon, authenticated;
