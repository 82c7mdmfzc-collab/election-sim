/**
 * avatars.ts — free preset profile pictures (country flags, US states, patterns).
 *
 * Each avatar is a self-contained square SVG rendered as a `data:` URI, so it drops
 * straight into the existing <Avatar>/<Portrait> `src` (which circle-crops via
 * object-fit:cover and falls back to initials on an empty/failed src). No image files
 * to source, and crisp at any size. The chosen id is stored on the account (server-
 * owned, like equipped_banner) so other players see it; `''` means "use initials".
 *
 * Flags are intentionally squared, flag-inspired tiles (not exact ratios) because the
 * token is a circle — a 3:2 flag cropped to a circle loses its edges, a square one
 * doesn't. State entries use a clean "plate" (abbreviation + star) that reads clearly
 * at ~40px where detailed state seals turn to mush; the catalog is per-id data, so a
 * real state-flag SVG can replace any plate later without touching callers.
 *
 * Do NOT use flag *emoji* here — the mobile-native CI guard blocks regional-indicator
 * codepoints in source. These are drawn SVGs, which the guard does not flag.
 */

export type AvatarCategory = 'flag' | 'state' | 'pattern';

export interface AvatarDef {
  readonly id: string;
  readonly category: AvatarCategory;
  readonly label: string;
  /** Raw square SVG markup (0 0 60 60), edge-to-edge fill. */
  readonly svg: string;
}

/** Empty id → no avatar → the initials monogram fallback. */
export const DEFAULT_AVATAR_ID = '';

// ── SVG primitives ─────────────────────────────────────────────────────────────
const S = 60; // square viewBox

function svg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${inner}</svg>`;
}

/** Horizontal bands, top → bottom. */
function hbands(colors: string[]): string {
  const h = S / colors.length;
  return svg(colors.map((c, i) => `<rect x="0" y="${i * h}" width="${S}" height="${h + 0.5}" fill="${c}"/>`).join(''));
}

/** Vertical bands, hoist → fly. */
function vbands(colors: string[]): string {
  const w = S / colors.length;
  return svg(colors.map((c, i) => `<rect x="${i * w}" y="0" width="${w + 0.5}" height="${S}" fill="${c}"/>`).join(''));
}

/** Nordic (offset) cross. */
function nordic(field: string, cross: string, thick = 11, cx = 24): string {
  return svg(
    `<rect width="${S}" height="${S}" fill="${field}"/>` +
    `<rect x="${cx - thick / 2}" y="0" width="${thick}" height="${S}" fill="${cross}"/>` +
    `<rect x="0" y="${S / 2 - thick / 2}" width="${S}" height="${thick}" fill="${cross}"/>`,
  );
}

/** 5-point star centred at (cx,cy), outer radius r. */
function star(cx: number, cy: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

// ── Country flags (squared, geometric) ──────────────────────────────────────────
const US = svg(
  Array.from({ length: 7 }, (_, i) => `<rect x="0" y="${i * (S / 6.5)}" width="${S}" height="${S / 13}" fill="#b22234"/>`).join('') +
    `<rect width="${S}" height="${S}" fill="#fff"/>` +
    Array.from({ length: 7 }, (_, i) => `<rect x="0" y="${i * (S / 6.5)}" width="${S}" height="${S / 13}" fill="#b22234"/>`).join('') +
    `<rect x="0" y="0" width="26" height="${(S / 13) * 7}" fill="#3c3b6e"/>` +
    star(7, 6, 3, '#fff') + star(15, 6, 3, '#fff') + star(11, 13, 3, '#fff') +
    star(7, 20, 3, '#fff') + star(15, 20, 3, '#fff') + star(19, 13, 3, '#fff'),
);

const UK = svg(
  `<rect width="60" height="60" fill="#012169"/>` +
    `<path d="M0,0 60,60 M60,0 0,60" stroke="#fff" stroke-width="12"/>` +
    `<path d="M0,0 60,60 M60,0 0,60" stroke="#c8102e" stroke-width="5"/>` +
    `<rect x="24" width="12" height="60" fill="#fff"/><rect y="24" width="60" height="12" fill="#fff"/>` +
    `<rect x="26.5" width="7" height="60" fill="#c8102e"/><rect y="26.5" width="60" height="7" fill="#c8102e"/>`,
);

const CANADA = svg(
  `<rect width="60" height="60" fill="#fff"/>` +
    `<rect width="15" height="60" fill="#d52b1e"/><rect x="45" width="15" height="60" fill="#d52b1e"/>` +
    `<polygon points="30,15 31.6,20.5 34.5,19.5 33.4,23 37,22.5 35,25.5 40,26.8 34.6,29 37.5,33.5 32.8,31.8 33.4,37.5 31,36.8 31,43 29,43 29,36.8 26.6,37.5 27.2,31.8 22.5,33.5 25.4,29 20,26.8 25,25.5 23,22.5 26.6,23 25.5,19.5 28.4,20.5" fill="#d52b1e"/>`,
);

const FRANCE = vbands(['#0055a4', '#fff', '#ef4135']);
const ITALY = vbands(['#009246', '#fff', '#ce2b37']);
const IRELAND = vbands(['#169b62', '#fff', '#ff883e']);
const BELGIUM = vbands(['#111', '#f7d417', '#e42313']);
const GERMANY = hbands(['#111', '#dd0000', '#ffce00']);
const NETHERLANDS = hbands(['#ae1c28', '#fff', '#21468b']);
const POLAND = hbands(['#fff', '#dc143c']);
const UKRAINE = hbands(['#0057b7', '#ffd700']);
const SPAIN = svg(
  `<rect width="60" height="60" fill="#c60b1e"/><rect y="15" width="60" height="30" fill="#ffc400"/>`,
);
const INDIA = svg(
  `<rect width="60" height="60" fill="#f93"/><rect y="20" width="60" height="20" fill="#fff"/><rect y="40" width="60" height="20" fill="#128807"/>` +
    `<circle cx="30" cy="30" r="7" fill="none" stroke="#008" stroke-width="1.6"/><circle cx="30" cy="30" r="1.6" fill="#008"/>`,
);
const JAPAN = svg(`<rect width="60" height="60" fill="#fff"/><circle cx="30" cy="30" r="15" fill="#bc002d"/>`);
const SWEDEN = nordic('#006aa7', '#fecc00');
const NORWAY = svg(
  `<rect width="60" height="60" fill="#ba0c2f"/>` +
    `<rect x="18.5" width="12" height="60" fill="#fff"/><rect y="24" width="60" height="12" fill="#fff"/>` +
    `<rect x="21" width="7" height="60" fill="#00205b"/><rect y="26.5" width="60" height="7" fill="#00205b"/>`,
);
const DENMARK = nordic('#c8102e', '#fff');
const FINLAND = nordic('#fff', '#003580');
const SWITZERLAND = svg(
  `<rect width="60" height="60" fill="#d52b1e"/>` +
    `<rect x="25" y="14" width="10" height="32" fill="#fff"/><rect x="14" y="25" width="32" height="10" fill="#fff"/>`,
);
const GREECE = svg(
  Array.from({ length: 9 }, (_, i) => `<rect y="${i * (S / 9)}" width="60" height="${S / 9 + 0.5}" fill="${i % 2 ? '#fff' : '#0d5eaf'}"/>`).join('') +
    `<rect width="${(S / 9) * 5}" height="${(S / 9) * 5}" fill="#0d5eaf"/>` +
    `<rect x="${(S / 9) * 2 - 4}" y="0" width="8" height="${(S / 9) * 5}" fill="#fff"/>` +
    `<rect x="0" y="${(S / 9) * 2.5 - 4}" width="${(S / 9) * 5}" height="8" fill="#fff"/>`,
);
const CHINA = svg(
  `<rect width="60" height="60" fill="#de2910"/>` + star(15, 16, 8, '#ffde00') +
    star(31, 8, 2.6, '#ffde00') + star(37, 14, 2.6, '#ffde00') + star(37, 23, 2.6, '#ffde00') + star(31, 29, 2.6, '#ffde00'),
);
const KOREA = svg(
  `<rect width="60" height="60" fill="#fff"/>` +
    `<path d="M30 15 A15 15 0 0 1 30 45 A7.5 7.5 0 0 0 30 30 A7.5 7.5 0 0 1 30 15 Z" fill="#cd2e3a"/>` +
    `<path d="M30 15 A15 15 0 0 0 30 45 A7.5 7.5 0 0 1 30 30 A7.5 7.5 0 0 0 30 15 Z" fill="#0047a0"/>`,
);
const MEXICO = svg(
  vbands(['#006847', '#fff', '#ce1126']).replace(/^<svg[^>]*>/, '').replace('</svg>', '') +
    `<circle cx="30" cy="30" r="4.5" fill="none" stroke="#8c5a2b" stroke-width="1.4"/>`,
);
const BRAZIL = svg(
  `<rect width="60" height="60" fill="#009c3b"/>` +
    `<polygon points="30,7 53,30 30,53 7,30" fill="#ffdf00"/>` +
    `<circle cx="30" cy="30" r="9" fill="#002776"/>`,
);
const AUSTRALIA = svg(
  `<rect width="60" height="60" fill="#00008b"/>` +
    `<rect width="30" height="30" fill="#012169"/>` +
    `<path d="M0,0 30,30 M30,0 0,30" stroke="#fff" stroke-width="6"/>` +
    `<rect x="12" width="6" height="30" fill="#fff"/><rect y="12" width="30" height="6" fill="#fff"/>` +
    `<rect x="13" width="4" height="30" fill="#c8102e"/><rect y="13" width="30" height="4" fill="#c8102e"/>` +
    star(30, 46, 4, '#fff') + star(46, 14, 3, '#fff') + star(50, 34, 3, '#fff') + star(42, 50, 3, '#fff'),
);

const COUNTRIES: [string, string, string][] = [
  ['us', 'United States', US],
  ['gb', 'United Kingdom', UK],
  ['ca', 'Canada', CANADA],
  ['au', 'Australia', AUSTRALIA],
  ['ie', 'Ireland', IRELAND],
  ['fr', 'France', FRANCE],
  ['de', 'Germany', GERMANY],
  ['it', 'Italy', ITALY],
  ['es', 'Spain', SPAIN],
  ['nl', 'Netherlands', NETHERLANDS],
  ['be', 'Belgium', BELGIUM],
  ['ch', 'Switzerland', SWITZERLAND],
  ['gr', 'Greece', GREECE],
  ['pl', 'Poland', POLAND],
  ['ua', 'Ukraine', UKRAINE],
  ['se', 'Sweden', SWEDEN],
  ['no', 'Norway', NORWAY],
  ['dk', 'Denmark', DENMARK],
  ['fi', 'Finland', FINLAND],
  ['jp', 'Japan', JAPAN],
  ['kr', 'South Korea', KOREA],
  ['cn', 'China', CHINA],
  ['in', 'India', INDIA],
  ['mx', 'Mexico', MEXICO],
  ['br', 'Brazil', BRAZIL],
];

// ── US states ────────────────────────────────────────────────────────────────
// A clean plate: navy field, red lower stripe, white star + postal abbreviation.
// Texas ships as its real Lone Star flag to show the catalog supports real art.
function statePlate(abbr: string): string {
  return svg(
    `<rect width="60" height="60" fill="#0a2a52"/>` +
      `<rect y="41" width="60" height="19" fill="#b22234"/>` +
      star(30, 17, 8, '#fff') +
      `<text x="30" y="55" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="bold" fill="#fff" text-anchor="middle">${abbr}</text>`,
  );
}
const TEXAS = svg(
  `<rect width="60" height="60" fill="#fff"/>` +
    `<rect y="30" width="60" height="30" fill="#bf0a30"/>` +
    `<rect width="22" height="60" fill="#002868"/>` +
    star(11, 30, 8, '#fff'),
);

const STATES: [string, string][] = [
  ['al', 'Alabama'], ['ak', 'Alaska'], ['az', 'Arizona'], ['ar', 'Arkansas'], ['ca', 'California'],
  ['co', 'Colorado'], ['ct', 'Connecticut'], ['de', 'Delaware'], ['fl', 'Florida'], ['ga', 'Georgia'],
  ['hi', 'Hawaii'], ['id', 'Idaho'], ['il', 'Illinois'], ['in', 'Indiana'], ['ia', 'Iowa'],
  ['ks', 'Kansas'], ['ky', 'Kentucky'], ['la', 'Louisiana'], ['me', 'Maine'], ['md', 'Maryland'],
  ['ma', 'Massachusetts'], ['mi', 'Michigan'], ['mn', 'Minnesota'], ['ms', 'Mississippi'], ['mo', 'Missouri'],
  ['mt', 'Montana'], ['ne', 'Nebraska'], ['nv', 'Nevada'], ['nh', 'New Hampshire'], ['nj', 'New Jersey'],
  ['nm', 'New Mexico'], ['ny', 'New York'], ['nc', 'North Carolina'], ['nd', 'North Dakota'], ['oh', 'Ohio'],
  ['ok', 'Oklahoma'], ['or', 'Oregon'], ['pa', 'Pennsylvania'], ['ri', 'Rhode Island'], ['sc', 'South Carolina'],
  ['sd', 'South Dakota'], ['tn', 'Tennessee'], ['tx', 'Texas'], ['ut', 'Utah'], ['vt', 'Vermont'],
  ['va', 'Virginia'], ['wa', 'Washington'], ['wv', 'West Virginia'], ['wi', 'Wisconsin'], ['wy', 'Wyoming'],
];

// ── Abstract / party tiles ─────────────────────────────────────────────────────
const PATTERNS: [string, string, string][] = [
  ['stars', 'Starfield', svg(
    `<rect width="60" height="60" fill="#0a2a52"/>` +
      [ [12, 14], [30, 10], [48, 16], [20, 30], [40, 32], [12, 46], [30, 48], [48, 44] ]
        .map(([x, y], i) => star(x, y, i % 2 ? 3.4 : 2.4, '#ffd451')).join(''),
  )],
  ['stripes', 'Stripes', svg(
    Array.from({ length: 6 }, (_, i) => `<rect y="${i * 10}" width="60" height="10" fill="${i % 2 ? '#c8102e' : '#f4f4f4'}"/>`).join(''),
  )],
  ['red', 'Party Red', svg(`<rect width="60" height="60" fill="#c8102e"/>${star(30, 30, 14, '#fff')}`)],
  ['blue', 'Party Blue', svg(`<rect width="60" height="60" fill="#1d4ed8"/>${star(30, 30, 14, '#fff')}`)],
  ['gold', 'Gold Rush', svg(
    `<defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#ffe89a"/><stop offset="100%" stop-color="#c8891b"/></radialGradient></defs>` +
      `<rect width="60" height="60" fill="url(#g)"/>${star(30, 30, 13, '#7a4f0a')}`,
  )],
  ['ballot', 'Ballot', svg(
    `<rect width="60" height="60" fill="#0d1f3c"/>` +
      `<rect x="14" y="16" width="32" height="28" rx="3" fill="#f4b850"/>` +
      `<path d="M22 30 l5 6 11 -13" fill="none" stroke="#0d1f3c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  )],
];

// ── Catalog ────────────────────────────────────────────────────────────────────
export const AVATARS: readonly AvatarDef[] = [
  ...COUNTRIES.map(([code, label, s]): AvatarDef => ({ id: `flag-${code}`, category: 'flag', label, svg: s })),
  ...STATES.map(([code, label]): AvatarDef => ({
    id: `state-${code}`,
    category: 'state',
    label,
    svg: code === 'tx' ? TEXAS : statePlate(code.toUpperCase()),
  })),
  ...PATTERNS.map(([code, label, s]): AvatarDef => ({ id: `pattern-${code}`, category: 'pattern', label, svg: s })),
];

const BY_ID: Map<string, AvatarDef> = new Map(AVATARS.map((a) => [a.id, a]));

/** Resolve an avatar id to an <img>-ready src. Empty/unknown id → '' (initials). */
export function avatarImageUrl(id: string | null | undefined): string {
  if (!id) return '';
  const def = BY_ID.get(id);
  return def ? `data:image/svg+xml,${encodeURIComponent(def.svg)}` : '';
}

export function avatarLabel(id: string | null | undefined): string {
  return (id && BY_ID.get(id)?.label) || '';
}

export function avatarsByCategory(category: AvatarCategory): AvatarDef[] {
  return AVATARS.filter((a) => a.category === category);
}

export const AVATAR_CATEGORIES: { key: AvatarCategory; label: string }[] = [
  { key: 'flag', label: 'Flags' },
  { key: 'state', label: 'States' },
  { key: 'pattern', label: 'Patterns' },
];
