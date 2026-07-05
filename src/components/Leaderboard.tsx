/**
 * Leaderboard — global player rankings across four boards.
 *
 * Reads the get_leaderboard RPC (game/leaderboard). Boards: All-Time wins, last
 * 30 days, last 7 days, best win streak. Highlights the signed-in player's row and
 * pins a "You #N" footer when they rank outside the visible top. Built on the
 * `.setup native-screen` shell so it inherits the landscape / safe-area layout.
 */

import { useEffect, useState } from 'react';
import { AudioManager } from '../utils/audioManager';
import { Spinner } from './Spinner';
import { ProfileBanner } from './ProfileBanner';
import { MedalIcon } from './icons';
import {
  fetchLeaderboardRemote,
  BOARD_META,
  type LeaderboardBoard,
  type LeaderboardResult,
} from '../game/leaderboard';
import { dailyDateKey } from '../game/dailyChallenge';
import { getDailyLeaderboardRemote } from '../game/profile';
import type { DailyLeaderboardResult } from '../game/dailyRankings';
import { track } from '../utils/analytics';

type Board = LeaderboardBoard | 'daily_today';

const BOARDS: Board[] = ['daily_today', 'wins_all', 'wins_month', 'wins_week', 'streak'];

/** Podium medal for ranks 1-3 (gold/silver/bronze via CSS), '#N' otherwise. */
function RankBadge({ rank }: { rank: number }) {
  if (rank > 3) return <>{`#${rank}`}</>;
  return (
    <span className={`lb-medal lb-medal--${rank}`}>
      <MedalIcon rank={rank as 1 | 2 | 3} size={18} />
    </span>
  );
}
const DAILY_META = { label: 'Today', sub: 'Daily Race ranking', unit: 'EV' };

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const [board, setBoard] = useState<Board>('daily_today');
  const [data, setData] = useState<LeaderboardResult | null>(null);
  const [dailyData, setDailyData] = useState<DailyLeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    const loadingTimer = window.setTimeout(() => {
      if (!live) return;
      setLoading(true);
      setError(false);
    }, 0);
    const fetcher = board === 'daily_today'
      ? getDailyLeaderboardRemote(dailyDateKey(), 100).then((res) => {
          if (res) track('daily_rank_viewed', { date_key: dailyDateKey(), has_rank: !!res.me });
          return { daily: res, standard: null };
        })
      : fetchLeaderboardRemote(board).then((res) => ({ daily: null, standard: res }));
    void fetcher.then((res) => {
      if (!live) return;
      if (!res.daily && !res.standard) {
        setError(true);
        setData(null);
        setDailyData(null);
      } else {
        setData(res.standard);
        setDailyData(res.daily);
      }
      setLoading(false);
    });
    return () => {
      live = false;
      window.clearTimeout(loadingTimer);
    };
  }, [board]);

  const meta = board === 'daily_today' ? DAILY_META : BOARD_META[board];
  const meInTop = board === 'daily_today'
    ? dailyData?.rows.some((r) => r.isMe) ?? false
    : data?.rows.some((r) => r.isMe) ?? false;

  return (
    <div className="setup native-screen leaderboard">
      <div className="setup__header">
        <h1 className="setup__title">Leaderboard</h1>
      </div>

      <div className="lb-tabs" role="tablist" aria-label="Leaderboard boards">
        {BOARDS.map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={board === b}
            className={`lb-tab${board === b ? ' is-active' : ''}`}
            onClick={() => { if (b !== board) { AudioManager.play('click'); setBoard(b); } }}
          >
            {b === 'daily_today' ? DAILY_META.label : BOARD_META[b].label}
          </button>
        ))}
      </div>

      <div className="lb-sub">{meta.sub}</div>

      <div className="lb-list">
        {loading ? (
          <div className="lb-state"><Spinner /></div>
        ) : error ? (
          <div className="lb-state">Couldn’t load the leaderboard. Check your connection and try again.</div>
        ) : board === 'daily_today' ? (
          !dailyData || dailyData.rows.length === 0 ? (
            <div className="lb-state">No Daily Race scores yet. Run today’s race to set the pace!</div>
          ) : (
            dailyData.rows.map((r) => (
              <div key={`${r.rank}-${r.name}`} className={`lb-row${r.isMe ? ' lb-row--me' : ''}${r.banner ? ' lb-row--bannered' : ''}`}>
                <ProfileBanner bannerId={r.banner} variant="chip" className="lb-row__banner" />
                <span className="lb-row__rank"><RankBadge rank={r.rank} /></span>
                <span className="lb-row__name">
                  {r.name}
                  {r.isMe && <em className="lb-row__you"> · You</em>}
                </span>
                <span className="lb-row__value">{r.ev.toLocaleString()} <small>{meta.unit}</small> <small>· T{r.turns}</small></span>
              </div>
            ))
          )
        ) : !data || data.rows.length === 0 ? (
          <div className="lb-state">No ranked players yet. Win a game to claim a spot!</div>
        ) : (
          data.rows.map((r) => (
            <div key={`${r.rank}-${r.name}`} className={`lb-row${r.isMe ? ' lb-row--me' : ''}${r.banner ? ' lb-row--bannered' : ''}`}>
              <ProfileBanner bannerId={r.banner} variant="chip" className="lb-row__banner" />
              <span className="lb-row__rank"><RankBadge rank={r.rank} /></span>
              <span className="lb-row__name">
                {r.name}
                {r.isMe && <em className="lb-row__you"> · You</em>}
              </span>
              <span className="lb-row__value">{r.value.toLocaleString()} <small>{meta.unit}</small></span>
            </div>
          ))
        )}
      </div>

      {board === 'daily_today' && dailyData?.me && !meInTop && (
        <div className="lb-row lb-row--me lb-row--pinned">
          <span className="lb-row__rank">#{dailyData.me.rank}</span>
          <span className="lb-row__name">You</span>
          <span className="lb-row__value">{dailyData.me.ev.toLocaleString()} <small>{meta.unit}</small> <small>· T{dailyData.me.turns}</small></span>
        </div>
      )}

      {board !== 'daily_today' && data?.me && !meInTop && (
        <div className="lb-row lb-row--me lb-row--pinned">
          <span className="lb-row__rank">#{data.me.rank}</span>
          <span className="lb-row__name">You</span>
          <span className="lb-row__value">{data.me.value.toLocaleString()} <small>{meta.unit}</small></span>
        </div>
      )}

      <div className="setup__foot">
        <button type="button" className="mp-back" onClick={() => { AudioManager.play('quit'); onBack(); }}>
          ← Back
        </button>
      </div>
    </div>
  );
}
