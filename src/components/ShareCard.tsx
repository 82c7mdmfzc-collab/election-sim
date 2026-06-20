/**
 * ShareCard — the viral end-of-game asset.
 *
 * Pure presentational SVG (no hooks, no store access) so it can be rendered to a
 * static markup string via react-dom/server and rasterized to PNG (see
 * src/utils/shareImage.ts). Keep it self-contained: only system fonts and inline
 * geometry, no external <image>/font refs (those don't load in a detached SVG).
 */
import { geoStatePaths } from '../utils/usMapGeo';

export const SHARE_CARD_W = 1200;
export const SHARE_CARD_H = 630;

// Map sub-region inside the card (header above, footer below — no overlap).
const MAP_W = 1120;
const MAP_H = 392;
const MAP_X = (SHARE_CARD_W - MAP_W) / 2; // 40
const MAP_Y = 172;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const NEUTRAL = '#334155'; // unsecured / contested states

export interface ShareCardProps {
  /** Winner display name, or null for a hung Electoral College. */
  winnerName: string | null;
  /** Winner's electoral votes (ignored when winnerName is null). */
  winnerEV: number;
  /** One-line hook shown in the footer. */
  line: string;
  /** stateId → fill hex for secured states. Missing entries render NEUTRAL. */
  stateColors: Record<string, string>;
}

export function ShareCard({ winnerName, winnerEV, line, stateColors }: ShareCardProps) {
  const paths = geoStatePaths(MAP_W, MAP_H);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${SHARE_CARD_W} ${SHARE_CARD_H}`}
      width={SHARE_CARD_W}
      height={SHARE_CARD_H}
    >
      <rect width={SHARE_CARD_W} height={SHARE_CARD_H} fill="#0b1220" />
      <rect width={SHARE_CARD_W} height={6} fill="#f59e0b" />

      {/* Header */}
      <text
        x={SHARE_CARD_W / 2} y={58} textAnchor="middle"
        fill="#f59e0b" fontFamily={FONT} fontSize={22} fontWeight={700} letterSpacing={6}
      >
        ELECTOR · FINAL RESULTS
      </text>
      <text
        x={SHARE_CARD_W / 2} y={112} textAnchor="middle"
        fill="#f8fafc" fontFamily={FONT} fontSize={48} fontWeight={800}
      >
        {winnerName ?? 'Hung Electoral College'}
      </text>
      <text
        x={SHARE_CARD_W / 2} y={152} textAnchor="middle"
        fill="#facc15" fontFamily={FONT} fontSize={26} fontWeight={700} letterSpacing={2}
      >
        {winnerName ? `${winnerEV} ELECTORAL VOTES` : 'NO MAJORITY — 270 NEEDED'}
      </text>

      {/* Map */}
      <g transform={`translate(${MAP_X}, ${MAP_Y})`}>
        {paths.map((p) => (
          <path
            key={p.stateId}
            d={p.d}
            fill={stateColors[p.stateId] ?? NEUTRAL}
            stroke="#0b1220"
            strokeWidth={0.6}
          />
        ))}
      </g>

      {/* Footer */}
      <text x={40} y={SHARE_CARD_H - 26} fill="#cbd5e1" fontFamily={FONT} fontSize={22} fontWeight={500}>
        {line}
      </text>
      <text
        x={SHARE_CARD_W - 40} y={SHARE_CARD_H - 26} textAnchor="end"
        fill="#94a3b8" fontFamily={FONT} fontSize={20} fontWeight={700}
      >
        playelector.com
      </text>
    </svg>
  );
}
