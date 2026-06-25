/**
 * VersusScreen — the pre-game matchup intro.
 *
 * Shown once when a game starts (set by store.versusPending), before the board.
 * Drops each player's candidate token into the rings of the 2/3/4-player versus
 * artwork, then auto-advances after a beat — or on tap. Covers Solo/bot,
 * pass-and-play, and online (all funnel through startGame/initOnlineGame).
 */
import { useEffect } from 'react';
import { useGameStore } from '../game/store';
import { CANDIDATE_MAP, PLAYER_COLORS } from '../game/candidates';

interface Ring { x: number; y: number; s: number }
// Ring centers + avatar diameter as % of the 16:9 stage (measured from the art).
const LAYOUT: Record<number, { bg: string; rings: Ring[] }> = {
  2: { bg: '/assets/backgrounds/versus_2p.jpg', rings: [{ x: 27, y: 34, s: 15.5 }, { x: 73, y: 34, s: 15.5 }] },
  3: { bg: '/assets/backgrounds/versus_3p.jpg', rings: [{ x: 22, y: 39, s: 12.5 }, { x: 50, y: 39, s: 12.5 }, { x: 78, y: 39, s: 12.5 }] },
  4: { bg: '/assets/backgrounds/versus_4p.jpg', rings: [{ x: 14.5, y: 41, s: 11.5 }, { x: 38.5, y: 41, s: 11.5 }, { x: 61.5, y: 41, s: 11.5 }, { x: 86, y: 41, s: 11.5 }] },
};

const AUTO_ADVANCE_MS = 3000;

export function VersusScreen() {
  const players = useGameStore((s) => s.players);
  const clearVersus = useGameStore((s) => s.clearVersus);
  const layout = LAYOUT[players.length];

  // Auto-advance after a beat; unsupported counts skip straight through.
  useEffect(() => {
    if (!layout) { clearVersus(); return; }
    const t = setTimeout(clearVersus, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [layout, clearVersus]);

  if (!layout) return null;

  return (
    <div className="versus" onClick={clearVersus} role="presentation">
      <div className="versus__stage" style={{ backgroundImage: `url(${layout.bg})` }}>
        {players.slice(0, layout.rings.length).map((p, i) => {
          const c = CANDIDATE_MAP[p.candidateId];
          const ring = layout.rings[i];
          return (
            <div
              key={p.id}
              className="versus__seat"
              style={{ left: `${ring.x}%`, top: `${ring.y}%`, width: `${ring.s}%` }}
            >
              {c?.portraitUrl && (
                <img
                  className="versus__avatar"
                  src={c.portraitUrl}
                  alt=""
                  draggable={false}
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                />
              )}
              <span className="versus__name" style={{ color: PLAYER_COLORS[c?.color ?? 'green'] }}>
                {p.name}
              </span>
            </div>
          );
        })}
        <div className="versus__hint">Tap to continue</div>
      </div>
    </div>
  );
}
