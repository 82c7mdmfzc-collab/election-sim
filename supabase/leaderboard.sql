-- ════════════════════════════════════════════════════════════════════════════
-- leaderboard.sql — global player rankings (read-only).
--
-- Apply in Supabase SQL editor AFTER profiles.sql + rewards.sql. Idempotent.
-- The CI workflow (.github/workflows/deploy-db.yml) applies it after `rewards`.
--
-- WHY A SECURITY DEFINER RPC
--   `profiles` has no client SELECT policy — all reads go through SECURITY DEFINER
--   RPCs. The leaderboard therefore cannot be a plain table query; this function is
--   the ONLY read path and it exposes just (display_name, ranked value) — never
--   campaign_funds, email, or the auth uid.
--
-- BOARDS
--   wins_all   — lifetime wins         (profiles.stats.gamesWon)
--   streak     — best win streak       (profiles.stats.bestWinStreak)
--   wins_month — wins in the last 30d   (count over game_rewards, rolling window)
--   wins_week  — wins in the last 7d    (count over game_rewards, rolling window)
--
-- Rolling windows (not calendar months/weeks) so a board is never empty right after
-- a reset. Ties share a rank via rank() — same value ⇒ same position.
-- ════════════════════════════════════════════════════════════════════════════

-- Speeds the windowed win counts: only "won" rows, indexed by recency.
create index if not exists game_rewards_won_created_idx
  on public.game_rewards (created_at) where won;

-- ── get_leaderboard ──────────────────────────────────────────────────────────
-- Returns { top: [{ rank, name, value, isMe }], me: { rank, value } | null }.
-- `me` is null when the caller has no entries on this board (value 0 / unranked).
create or replace function public.get_leaderboard(
  p_board text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_rows  jsonb;
  v_me    jsonb;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  if p_board not in ('wins_all', 'wins_month', 'wins_week', 'streak') then
    raise exception 'invalid board %', p_board;
  end if;

  with ranked as (
    select
      p.id,
      p.display_name as name,
      coalesce(p.equipped_banner, '') as banner,
      case p_board
        when 'streak'   then coalesce((p.stats->>'bestWinStreak')::integer, 0)
        when 'wins_all' then coalesce((p.stats->>'gamesWon')::integer, 0)
        else (
          select count(*)::integer
          from public.game_rewards g
          where g.user_id = p.id
            and g.won
            and g.created_at > now() - (case when p_board = 'wins_week'
                  then interval '7 days' else interval '30 days' end)
        )
      end as value
    from public.profiles p
    where p.display_name is not null
      -- App Review demo account: never shown on public boards.
      and p.display_name <> 'AppleReview'
  ),
  withrank as (
    select id, name, banner, value, rank() over (order by value desc) as rnk
    from ranked
    where value > 0
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object('rank', rnk, 'name', name, 'banner', banner, 'value', value, 'isMe', id = v_uid)
             order by rnk
           ) filter (where rnk <= v_limit),
           '[]'::jsonb
         ),
         (select jsonb_build_object('rank', rnk, 'value', value)
            from withrank where id = v_uid)
    into v_rows, v_me
    from withrank;

  return jsonb_build_object('top', coalesce(v_rows, '[]'::jsonb), 'me', v_me);
end; $$;

revoke execute on function public.get_leaderboard(text, integer) from public, anon;
grant  execute on function public.get_leaderboard(text, integer) to authenticated;
