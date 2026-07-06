export interface DailyScoreInput {
  userId?: string;
  name?: string;
  dateKey: string;
  won: boolean;
  ev: number;
  turns: number;
  securedStates: number;
  coalitions: number;
  submittedAt: string;
}

export interface DailyLeaderboardRow {
  rank: number;
  name: string;
  won: boolean;
  ev: number;
  turns: number;
  securedStates: number;
  coalitions: number;
  /** Equipped profile-banner cosmetic id ('' = none). See components/ProfileBanner. */
  banner: string;
  /** Chosen avatar preset id ('' = initials). See game/avatars.ts. */
  avatar: string;
  isMe: boolean;
}

export interface DailyLeaderboardResult {
  rows: DailyLeaderboardRow[];
  me: DailyLeaderboardRow | null;
}

export function compareDailyScores(a: DailyScoreInput, b: DailyScoreInput): number {
  if (a.won !== b.won) return a.won ? -1 : 1;
  if (a.ev !== b.ev) return b.ev - a.ev;
  if (a.turns !== b.turns) return a.turns - b.turns;
  if (a.securedStates !== b.securedStates) return b.securedStates - a.securedStates;
  if (a.coalitions !== b.coalitions) return b.coalitions - a.coalitions;
  return Date.parse(a.submittedAt) - Date.parse(b.submittedAt);
}

export function isBetterDailyScore(next: DailyScoreInput, current: DailyScoreInput | null): boolean {
  if (!current) return true;
  return compareDailyScores(next, current) < 0;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseDailyRow(v: unknown): DailyLeaderboardRow | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const name = typeof r.name === 'string' && r.name ? r.name : null;
  if (!name) return null;
  return {
    rank: num(r.rank),
    name,
    won: r.won === true,
    ev: num(r.ev),
    turns: num(r.turns),
    securedStates: num(r.securedStates),
    coalitions: num(r.coalitions),
    banner: typeof r.banner === 'string' ? r.banner : '',
    avatar: typeof r.avatar === 'string' ? r.avatar : '',
    isMe: r.isMe === true,
  };
}

export function parseDailyLeaderboardResult(data: unknown): DailyLeaderboardResult {
  if (!data || typeof data !== 'object') return { rows: [], me: null };
  const obj = data as Record<string, unknown>;
  const rows = Array.isArray(obj.top)
    ? obj.top.map(parseDailyRow).filter((row): row is DailyLeaderboardRow => row !== null)
    : [];
  return { rows, me: parseDailyRow(obj.me) };
}
