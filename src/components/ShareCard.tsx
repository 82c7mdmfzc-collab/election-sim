/**
 * ShareCard — the viral end-of-game asset.
 *
 * Pure presentational SVG (no hooks, no store access) so it can be rendered to a
 * static markup string via react-dom/server and rasterized to PNG (see
 * src/utils/shareImage.ts). Keep it self-contained: only system fonts and inline
 * geometry, no external <image>/font refs (those don't load in a detached SVG).
 *
 * Two formats:
 *   landscape (1200×630) — App Store / OG / link previews (the default).
 *   portrait  (1080×1920, 9:16) — TikTok / Reels / Stories.
 * Colors come from an optional `theme` palette (the share-frame cosmetic); the
 * default palette is the classic navy/gold so existing output is unchanged.
 */
import { geoStatePaths } from '../utils/usMapGeo';

export const SHARE_CARD_W = 1200;
export const SHARE_CARD_H = 630;
export const SHARE_CARD_PORTRAIT_W = 1080;
export const SHARE_CARD_PORTRAIT_H = 1920;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export type ShareCardVariant = 'landscape' | 'portrait';

/** Color palette for the card (matches game/cosmetics.ts ShareFramePalette). */
export interface ShareCardPalette {
  bg: string;
  accent: string;
  heading: string;
  subhead: string;
  neutral: string;
}

const DEFAULT_PALETTE: ShareCardPalette = {
  bg: '#0b1220',
  accent: '#f59e0b',
  heading: '#f8fafc',
  subhead: '#facc15',
  neutral: '#334155',
};

export interface ShareCardProps {
  /** Winner display name, or null for a hung Electoral College. */
  winnerName: string | null;
  /** Winner's electoral votes (ignored when winnerName is null). */
  winnerEV: number;
  /** One-line hook shown in the footer. */
  line: string;
  /** stateId → fill hex for secured states. Missing entries render the neutral fill. */
  stateColors: Record<string, string>;
  /** Card aspect: landscape (default) or portrait 9:16. */
  variant?: ShareCardVariant;
  /** Share-frame theme palette. Defaults to classic navy/gold. */
  theme?: ShareCardPalette;
  /** Candidate identity line, e.g. "as Donald Trump". */
  subtitle?: string;
  /** One-line dramatic highlight, e.g. "🔒 14 states secured · 🏛 3 coalitions". */
  highlight?: string;
  /** Equipped victory speech rendered as a short quote. */
  message?: string;
  /** Winner EV above 270. */
  marginOver270?: number;
  /** Winner's permanently called states. */
  securedStates?: number;
  /** Winner's dominated coalitions. */
  coalitions?: number;
  /** Runner-up final EV total. */
  runnerUpEV?: number;
}

interface Layout {
  w: number; h: number;
  rule: number;
  kickerY: number; kickerSize: number;
  headingY: number; headingSize: number;
  subtitleY: number; subtitleSize: number;
  subheadY: number; subheadSize: number;
  mapX: number; mapY: number; mapW: number; mapH: number;
  statsY: number; statsSize: number;
  messageY: number; messageSize: number; messageWidth: number; messageLines: number;
  highlightY: number; highlightSize: number;
  footerY: number; footerSize: number;
  /** Portrait centers the footer; landscape splits line (left) / brand (right). */
  centerFooter: boolean;
}

const LAYOUTS: Record<ShareCardVariant, Layout> = {
  landscape: {
    w: SHARE_CARD_W, h: SHARE_CARD_H, rule: 6,
    kickerY: 50, kickerSize: 22,
    headingY: 100, headingSize: 46,
    subtitleY: 134, subtitleSize: 22,
    subheadY: 170, subheadSize: 26,
    mapX: 80, mapY: 212, mapW: 1040, mapH: 288,
    statsY: 194, statsSize: 20,
    messageY: 532, messageSize: 22, messageWidth: 92, messageLines: 2,
    highlightY: 584, highlightSize: 20,
    footerY: 606, footerSize: 20,
    centerFooter: false,
  },
  portrait: {
    w: SHARE_CARD_PORTRAIT_W, h: SHARE_CARD_PORTRAIT_H, rule: 10,
    kickerY: 150, kickerSize: 40,
    headingY: 280, headingSize: 88,
    subtitleY: 360, subtitleSize: 46,
    subheadY: 458, subheadSize: 56,
    mapX: 40, mapY: 612, mapW: 1000, mapH: 820,
    statsY: 528, statsSize: 38,
    messageY: 1538, messageSize: 48, messageWidth: 28, messageLines: 3,
    highlightY: 1692, highlightSize: 40,
    footerY: 1812, footerSize: 40,
    centerFooter: true,
  },
};

function wrapSvgText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }

    if (line) lines.push(line);
    line = word.length > maxChars ? `${word.slice(0, Math.max(0, maxChars - 3))}...` : word;
    if (lines.length >= maxLines) break;
  }

  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length > 0 && words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\.*$/, '')}...`;
  }
  return lines.slice(0, maxLines);
}

export function ShareCard({
  winnerName,
  winnerEV,
  line,
  stateColors,
  variant = 'landscape',
  theme = DEFAULT_PALETTE,
  subtitle,
  highlight,
  message,
  marginOver270,
  securedStates,
  coalitions,
  runnerUpEV,
}: ShareCardProps) {
  const L = LAYOUTS[variant];
  const paths = geoStatePaths(L.mapW, L.mapH);
  const cx = L.w / 2;
  const messageLines = message ? wrapSvgText(`"${message}"`, L.messageWidth, L.messageLines) : [];
  const stats = winnerName
    ? [
        `${Math.max(0, marginOver270 ?? winnerEV - 270)} over 270`,
        securedStates != null ? `${securedStates} states called` : null,
        coalitions != null ? `${coalitions} coalitions` : null,
        runnerUpEV != null ? `Runner-up ${runnerUpEV} EV` : null,
      ].filter(Boolean).join(' · ')
    : 'Nobody reached the 270 EV threshold';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${L.w} ${L.h}`}
      width={L.w}
      height={L.h}
    >
      <rect width={L.w} height={L.h} fill={theme.bg} />
      <rect width={L.w} height={L.rule} fill={theme.accent} />

      {/* Header */}
      <text
        x={cx} y={L.kickerY} textAnchor="middle"
        fill={theme.accent} fontFamily={FONT} fontSize={L.kickerSize} fontWeight={700} letterSpacing={6}
      >
        ELECTOR · FINAL RESULTS
      </text>
      <text
        x={cx} y={L.headingY} textAnchor="middle"
        fill={theme.heading} fontFamily={FONT} fontSize={L.headingSize} fontWeight={800}
      >
        {winnerName ?? 'Hung Electoral College'}
      </text>
      {subtitle && (
        <text
          x={cx} y={L.subtitleY} textAnchor="middle"
          fill={theme.subhead} fontFamily={FONT} fontSize={L.subtitleSize} fontWeight={600} opacity={0.85}
        >
          {subtitle}
        </text>
      )}
      <text
        x={cx} y={L.subheadY} textAnchor="middle"
        fill={theme.subhead} fontFamily={FONT} fontSize={L.subheadSize} fontWeight={700} letterSpacing={2}
      >
        {winnerName ? `${winnerEV} ELECTORAL VOTES` : 'NO MAJORITY — 270 NEEDED'}
      </text>
      <text
        x={cx} y={L.statsY} textAnchor="middle"
        fill="#cbd5e1" fontFamily={FONT} fontSize={L.statsSize} fontWeight={700}
      >
        {stats}
      </text>

      {/* Map */}
      <g transform={`translate(${L.mapX}, ${L.mapY})`}>
        {paths.map((p) => (
          <path
            key={p.stateId}
            d={p.d}
            fill={stateColors[p.stateId] ?? theme.neutral}
            stroke={theme.bg}
            strokeWidth={0.6}
          />
        ))}
      </g>

      {/* Dramatic highlight */}
      {highlight && (
        <text
          x={cx} y={L.highlightY} textAnchor="middle"
          fill={theme.accent} fontFamily={FONT} fontSize={L.highlightSize} fontWeight={700}
        >
          {highlight}
        </text>
      )}

      {messageLines.length > 0 && (
        <text
          x={cx} y={L.messageY} textAnchor="middle"
          fill={theme.heading} fontFamily={FONT} fontSize={L.messageSize} fontWeight={650}
        >
          {messageLines.map((m, i) => (
            <tspan key={i} x={cx} dy={i === 0 ? 0 : L.messageSize * 1.25}>{m}</tspan>
          ))}
        </text>
      )}

      {/* Footer */}
      {L.centerFooter ? (
        <>
          <text x={cx} y={L.footerY} textAnchor="middle" fill="#cbd5e1" fontFamily={FONT} fontSize={L.footerSize} fontWeight={500}>
            {line}
          </text>
          <text x={cx} y={L.footerY + 56} textAnchor="middle" fill="#94a3b8" fontFamily={FONT} fontSize={36} fontWeight={700}>
            playelector.com
          </text>
        </>
      ) : (
        <>
          <text x={40} y={L.footerY} fill="#cbd5e1" fontFamily={FONT} fontSize={L.footerSize + 2} fontWeight={500}>
            {line}
          </text>
          <text x={L.w - 40} y={L.footerY} textAnchor="end" fill="#94a3b8" fontFamily={FONT} fontSize={20} fontWeight={700}>
            playelector.com
          </text>
        </>
      )}
    </svg>
  );
}
