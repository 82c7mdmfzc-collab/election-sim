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
import {
  fetchLeaderboardRemote,
  BOARD_META,
  type LeaderboardBoard,
  type LeaderboardResult,
} from '../game/leaderboard';

const BOARDS: LeaderboardBoard[] = ['wins_all', 'wins_month', 'wins_week', 'streak'];
const MEDALS = ['🥇', '🥈', '🥉'];

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const [board, setBoard] = useState<LeaderboardBoard>('wins_all');
  const [data, setData] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    void fetchLeaderboardRemote(board).then((res) => {
      if (!live) return;
      if (!res) {
        setError(true);
        setData(null);
      } else {
        setData(res);
      }
      setLoading(false);
    });
    return () => { live = false; };
  }, [board]);

  const meta = BOARD_META[board];
  const meInTop = data?.rows.some((r) => r.isMe) ?? false;

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
            {BOARD_META[b].label}
          </button>
        ))}
      </div>

      <div className="lb-sub">{meta.sub}</div>

      <div className="lb-list">
        {loading ? (
          <div className="lb-state">Loading…</div>
        ) : error ? (
          <div className="lb-state">Couldn’t load the leaderboard. Check your connection and try again.</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="lb-state">No ranked players yet. Win a game to claim a spot!</div>
        ) : (
          data.rows.map((r) => (
            <div key={`${r.rank}-${r.name}`} className={`lb-row${r.isMe ? ' lb-row--me' : ''}`}>
              <span className="lb-row__rank">{r.rank <= 3 ? MEDALS[r.rank - 1] : `#${r.rank}`}</span>
              <span className="lb-row__name">
                {r.name}
                {r.isMe && <em className="lb-row__you"> · You</em>}
              </span>
              <span className="lb-row__value">{r.value.toLocaleString()} <small>{meta.unit}</small></span>
            </div>
          ))
        )}
      </div>

      {data?.me && !meInTop && (
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
