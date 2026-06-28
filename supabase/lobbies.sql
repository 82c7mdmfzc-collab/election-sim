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
--       - set_lobby_bots ...... host-only waiting-room computer seats
--       - start_game .......... disabled; Edge Function builds initial state
--       - submit_turn_pending . service-only atomic write of validated pending
--       - push_game_state ..... disabled
--       - set_lobby_status .... host only (mark finished)
--
-- RESIDUAL RISK (documented, not fully closed here)
--   Single-player rewards are still client-reported and bounded by
--   claim_game_reward. Online setup, submissions, turn resolution, and phase
--   transitions are server-authoritative via the resolve-turn Edge Function.
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

create or replace function public.is_known_candidate(p_candidate text)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- Canonical roster: src/game/candidates.ts (keep in sync). All 10 selectable candidates.
  select p_candidate in ('tooley', 'trump', 'harris', 'lincoln', 'joe_biden', 'ronald_reagan', 'washington', 'starmer', 'farage', 'jfk');
$$;

create or replace function public.is_free_candidate(p_candidate text)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- Free founding roster only (unlockCost === 0 in src/game/candidates.ts).
  select p_candidate in ('tooley', 'trump', 'harris', 'lincoln', 'joe_biden');
$$;

create or replace function public.caller_can_use_candidate(p_candidate text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_unlocked text[];
begin
  if not public.is_known_candidate(p_candidate) then return false; end if;
  if public.is_free_candidate(p_candidate) then return true; end if;

  select unlocked_characters into v_unlocked
    from public.profiles
    where id = auth.uid();
  return coalesce(p_candidate = any(v_unlocked), false);
end;
$$;

create or replace function public.normalize_waiting_player(
  p_player  jsonb,
  p_is_host boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_pid       text := p_player->>'id';
  v_candidate text := p_player->>'candidateId';
  v_name      text := p_player->>'name';
  v_is_host   text := p_player->>'isHost';
begin
  if p_player is null or jsonb_typeof(p_player) <> 'object' then
    raise exception 'invalid player';
  end if;
  if v_pid is null or v_pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid player.id';
  end if;
  if v_name is null or v_name !~ '^[A-Za-z0-9_-]{3,20}$' then
    raise exception 'invalid player.name';
  end if;
  if v_is_host is null or v_is_host not in ('true', 'false') or (v_is_host::boolean) <> p_is_host then
    raise exception 'invalid player.isHost';
  end if;
  if not public.caller_can_use_candidate(v_candidate) then
    raise exception 'candidate unavailable';
  end if;

  return jsonb_build_object(
    'id', v_pid,
    'candidateId', v_candidate,
    'name', v_name,
    'isHost', p_is_host
  );
end;
$$;

-- ── RLS policies ──────────────────────────────────────────────────────────────
-- Full row reads are participants-only. Public lists and room-code lookup use
-- narrow SECURITY DEFINER RPCs below so private waiting rooms are not enumerable.
drop policy if exists lobbies_select on public.lobbies;
create policy lobbies_select on public.lobbies
  for select
  using (public.is_lobby_participant(id));

-- No direct client writes: every mutation goes through a SECURITY DEFINER RPC.
-- (Absence of INSERT/UPDATE/DELETE policies = denied for anon/authenticated.)

drop policy if exists participants_select on public.lobby_participants;
create policy participants_select on public.lobby_participants
  for select using (auth_uid = auth.uid());

-- ── RPC: waiting-room lookup surfaces ────────────────────────────────────────
create or replace function public.find_lobby_by_code(p_room_code text)
returns table (
  id uuid,
  room_code text,
  is_public boolean,
  status text,
  player_count integer,
  game_state jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select l.id, l.room_code, l.is_public, l.status, l.player_count, l.game_state, l.created_at, l.updated_at
  from public.lobbies l
  where p_room_code ~ '^[0-9]{4}$'
    and l.room_code = p_room_code
    and l.status = 'waiting'
  order by l.created_at desc
  limit 1;
$$;

create or replace function public.list_public_lobbies()
returns table (
  id uuid,
  room_code text,
  is_public boolean,
  status text,
  player_count integer,
  game_state jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select l.id, l.room_code, l.is_public, l.status, l.player_count, l.game_state, l.created_at, l.updated_at
  from public.lobbies l
  where l.status = 'waiting' and l.is_public = true
  order by l.created_at desc
  limit 20;
$$;

-- ── RPC: cleanup_stale_lobbies — expire and delete inactive lobbies ───────────
-- Called at the start of create_lobby so cleanup piggybacks on normal usage.
create or replace function public.cleanup_stale_lobbies()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Waiting rooms nobody joined/started within 30 minutes
  update public.lobbies set status = 'finished', updated_at = now()
  where status = 'waiting' and updated_at < now() - interval '30 minutes';

  -- In-progress games with no activity for 2 hours (host disconnected without aborting)
  update public.lobbies set status = 'finished', updated_at = now()
  where status = 'in_progress' and updated_at < now() - interval '2 hours';

  -- Delete finished rows older than 24 hours to keep the table lean
  delete from public.lobbies
  where status = 'finished' and updated_at < now() - interval '24 hours';
end;
$$;

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
  v_cap       integer := p_player_count;
  v_host      jsonb;
  v_host_pid  text;
  v_state     jsonb;
  v_row       public.lobbies;
begin
  if v_uid is null then
    raise exception 'auth required';
  end if;

  -- Expire abandoned lobbies on each create (no cron needed)
  perform public.cleanup_stale_lobbies();

  if v_cap is null or v_cap < 2 or v_cap > 4 then
    raise exception 'invalid player_count';
  end if;
  if p_game_state is null or jsonb_typeof(p_game_state->'players') <> 'array'
     or jsonb_array_length(p_game_state->'players') <> 1 then
    raise exception 'invalid waiting state';
  end if;
  if p_game_state->>'playerCount' is null or (p_game_state->>'playerCount')::integer <> v_cap then
    raise exception 'player_count mismatch';
  end if;

  v_host := public.normalize_waiting_player((p_game_state->'players')->0, true);
  v_host_pid := v_host->>'id';
  if p_game_state->>'hostPlayerId' <> v_host_pid then
    raise exception 'hostPlayerId mismatch';
  end if;

  -- Room codes are 4 numeric digits in the client flow.
  if p_room_code is null or p_room_code !~ '^[0-9]{4}$' then
    raise exception 'invalid room_code';
  end if;

  v_state := jsonb_build_object(
    'playerCount', v_cap,
    'hostPlayerId', v_host_pid,
    'players', jsonb_build_array(v_host)
  );

  insert into public.lobbies (room_code, is_public, player_count, status, game_state, host_uid)
  values (p_room_code, coalesce(p_is_public, false), v_cap, 'waiting', v_state, v_uid)
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
  v_player jsonb;
  v_pid    text;
  v_candidate text;
  v_state  jsonb;
  v_status text;
  v_cap    integer;
  v_count  integer;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  v_player := public.normalize_waiting_player(p_player, false);
  v_pid := v_player->>'id';
  v_candidate := v_player->>'candidateId';

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

  -- One seat per candidate; the UI disables taken candidates, and the server
  -- enforces it so concurrent joins cannot duplicate a candidate.
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_state->'players', '[]'::jsonb)) e
    where e->>'candidateId' = v_candidate
  ) then
    raise exception 'candidate already taken';
  end if;

  update public.lobbies
     set game_state = jsonb_set(
           v_state, '{players}',
           coalesce(v_state->'players', '[]'::jsonb) || jsonb_build_array(v_player)),
         updated_at = now()
   where id = p_lobby_id;

  insert into public.lobby_participants (lobby_id, auth_uid, player_id)
  values (p_lobby_id, v_uid, v_pid)
  on conflict (lobby_id, player_id) do update set auth_uid = excluded.auth_uid;
end;
$$;

-- ── RPC: set_lobby_bots — host adds/removes waiting-room computer seats ───────
create or replace function public.set_lobby_bots(
  p_lobby_id uuid,
  p_bots     jsonb
)
returns setof public.lobbies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_state      jsonb;
  v_status     text;
  v_cap        integer;
  v_humans     jsonb := '[]'::jsonb;
  v_bots       jsonb := '[]'::jsonb;
  v_seen       text[] := '{}';
  v_bot        jsonb;
  v_id         text;
  v_candidate  text;
  v_name       text;
  v_diff       text;
  v_row        public.lobbies;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  if not public.is_lobby_host(p_lobby_id) then raise exception 'only the host may manage bots'; end if;
  if p_bots is null or jsonb_typeof(p_bots) <> 'array' then raise exception 'invalid bots'; end if;

  select game_state, status, player_count
    into v_state, v_status, v_cap
    from public.lobbies where id = p_lobby_id for update;

  if v_state is null then raise exception 'lobby not found'; end if;
  if v_status <> 'waiting' then raise exception 'lobby not waiting'; end if;

  for v_bot in select * from jsonb_array_elements(coalesce(v_state->'players', '[]'::jsonb))
  loop
    if coalesce((v_bot->>'isBot')::boolean, false) = false then
      v_humans := v_humans || jsonb_build_array(v_bot);
      v_seen := array_append(v_seen, v_bot->>'candidateId');
    end if;
  end loop;

  if jsonb_array_length(v_humans) + jsonb_array_length(p_bots) > coalesce(v_cap, 2) then
    raise exception 'lobby full';
  end if;

  for v_bot in select * from jsonb_array_elements(p_bots)
  loop
    if v_bot is null or jsonb_typeof(v_bot) <> 'object' then raise exception 'invalid bot'; end if;
    v_id := v_bot->>'id';
    v_candidate := v_bot->>'candidateId';
    v_name := coalesce(v_bot->>'name', 'AI');
    v_diff := coalesce(v_bot->>'botDifficulty', 'medium');

    if v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid bot.id';
    end if;
    if v_name !~ '^[A-Za-z0-9_-]{2,20}$' then raise exception 'invalid bot.name'; end if;
    if not public.is_known_candidate(v_candidate) then raise exception 'unknown bot candidate'; end if;
    if v_candidate = any(v_seen) then raise exception 'candidate already taken'; end if;
    if v_diff not in ('easy', 'medium', 'hard', 'impossible') then raise exception 'invalid bot difficulty'; end if;

    v_seen := array_append(v_seen, v_candidate);
    v_bots := v_bots || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'candidateId', v_candidate,
      'name', v_name,
      'isHost', false,
      'isBot', true,
      'botDifficulty', v_diff
    ));
  end loop;

  update public.lobbies
     set game_state = jsonb_set(v_state, '{players}', v_humans || v_bots, true),
         updated_at = now()
   where id = p_lobby_id
   returning * into v_row;

  return next v_row;
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

-- ── RPC: start_game — DEPRECATED & DISABLED ──────────────────────────────────
-- The Edge Function now builds the initial LobbyGameState from the validated
-- waiting room. Keeping this old signature writable would let a host seed
-- forged cash/rungs/secured states.
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
  raise exception 'start_game is disabled: game starts are server-authoritative';
end;
$$;

-- ── RPC: submit_turn_pending — service-only atomic merge ─────────────────────
drop function if exists public.submit_turn_pending(uuid, text, jsonb, jsonb);
create or replace function public.submit_turn_pending(
  p_lobby_id       uuid,
  p_player_id      text,
  p_pending        jsonb,          -- validated PendingPurchase[] from the Edge Function
  p_auth_uid       uuid            -- caller uid verified by the Edge Function
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state     jsonb;
  v_status    text;
  v_submitted jsonb;
begin
  if p_auth_uid is null then raise exception 'auth required'; end if;
  if p_pending is null or jsonb_typeof(p_pending) <> 'array' or jsonb_array_length(p_pending) > 100 then
    raise exception 'invalid pending payload';
  end if;

  -- Identity binding: the caller must own p_player_id in THIS lobby. The
  -- function is granted only to service_role; browser clients cannot call it.
  if not exists (
    select 1 from public.lobby_participants
    where lobby_id = p_lobby_id and player_id = p_player_id and auth_uid = p_auth_uid
  ) then
    raise exception 'cannot submit as another player';
  end if;

  select game_state, status into v_state, v_status from public.lobbies where id = p_lobby_id for update;
  if v_state is null then raise exception 'lobby not found'; end if;
  if v_status <> 'in_progress' or v_state->>'phase' <> 'PLANNING' then
    raise exception 'lobby not accepting submissions';
  end if;

  -- Merge this player into the AUTHORITATIVE submittedPlayers array server-side
  -- (under the row lock above) instead of trusting the client-supplied list.
  -- Appending by player id makes concurrent submits commutative and idempotent.
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

-- ── RPC: forfeit_and_finish — any participant can quit; remaining players win ──
-- Sets phase=GAME_OVER in game_state and marks the lobby finished. The remaining
-- players receive the update via Realtime → useGameRewards fires → win credited.
create or replace function public.forfeit_and_finish(
  p_lobby_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_player_id  text;
  v_state      jsonb;
  v_status     text;
  v_victors    text[];
  v_winner     text;
  v_result     jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;

  -- Identify the forfeiting player
  select player_id into v_player_id
    from public.lobby_participants
    where lobby_id = p_lobby_id and auth_uid = v_uid;

  if v_player_id is null then raise exception 'not a participant'; end if;

  select game_state, status into v_state, v_status
    from public.lobbies where id = p_lobby_id for update;

  if v_state is null then raise exception 'lobby not found'; end if;

  -- If already ended or never started, just ensure the row is finished
  if (v_state->>'phase') in ('GAME_OVER', 'MENU', 'SETUP') or v_status = 'waiting' then
    update public.lobbies set status = 'finished', updated_at = now() where id = p_lobby_id;
    return;
  end if;

  -- Collect all non-eliminated players other than the forfeiter
  select array_agg(p->>'id' order by (p->>'id'))
    into v_victors
    from jsonb_array_elements(coalesce(v_state->'players', '[]'::jsonb)) p
    where (p->>'id') <> v_player_id
      and coalesce((p->>'eliminated')::boolean, false) = false;

  -- First remaining player is the UI winner shown on the podium
  v_winner := v_victors[1];

  v_result := jsonb_build_object(
    'winner',        v_winner,
    'forfeitVictors', to_jsonb(coalesce(v_victors, '{}'::text[])),
    'evByPlayer',    '{}'::jsonb,
    'stateLeaders',  '{}'::jsonb
  );

  update public.lobbies
    set game_state  = (v_state || jsonb_build_object('phase', 'GAME_OVER', 'electionResult', v_result)),
        status      = 'finished',
        updated_at  = now()
    where id = p_lobby_id;
end;
$$;

-- ── Grants: authenticated clients use narrow RPCs; service_role performs
--    authoritative Edge Function writes. Tables are not directly writable. ─────
revoke execute on function public.is_known_candidate(text) from public, anon, authenticated;
revoke execute on function public.is_free_candidate(text) from public, anon, authenticated;
revoke execute on function public.caller_can_use_candidate(text) from public, anon, authenticated;
revoke execute on function public.normalize_waiting_player(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.find_lobby_by_code(text) from public, anon;
grant execute on function public.find_lobby_by_code(text)                         to authenticated;
revoke execute on function public.list_public_lobbies() from public, anon;
grant execute on function public.list_public_lobbies()                            to authenticated;
revoke execute on function public.create_lobby(text, boolean, integer, jsonb) from public, anon;
grant execute on function public.create_lobby(text, boolean, integer, jsonb)      to authenticated;
revoke execute on function public.join_lobby_player(uuid, jsonb) from public, anon;
grant execute on function public.join_lobby_player(uuid, jsonb)                   to authenticated;
revoke execute on function public.set_lobby_bots(uuid, jsonb) from public, anon;
grant execute on function public.set_lobby_bots(uuid, jsonb)                     to authenticated;
revoke execute on function public.start_game(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.submit_turn_pending(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.submit_turn_pending(uuid, text, jsonb, uuid)     to service_role;
revoke execute on function public.ensure_participant(uuid, text) from public, anon;
grant execute on function public.ensure_participant(uuid, text)                   to authenticated;
revoke execute on function public.set_lobby_status(uuid, text) from public, anon;
grant execute on function public.set_lobby_status(uuid, text)                     to authenticated;
revoke execute on function public.cleanup_stale_lobbies() from public, anon, authenticated;
revoke execute on function public.forfeit_and_finish(uuid) from public, anon;
grant execute on function public.forfeit_and_finish(uuid)                         to authenticated;
-- push_game_state is deprecated/disabled — revoke so no client can call it.
revoke execute on function public.push_game_state(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.is_lobby_participant(uuid) from public, anon;
grant execute on function public.is_lobby_participant(uuid)                       to authenticated;
revoke execute on function public.is_lobby_host(uuid) from public, anon;
grant execute on function public.is_lobby_host(uuid)                              to authenticated;
