/**
 * dailyChallenge.ts — deterministic daily-challenge setup (pure, no IO, no deps).
 *
 * Everyone who plays on a given UTC day faces the SAME opposition: a fixed
 * opponent count (1–3), difficulty, and turn timer derived from the date seed.
 * The player still picks their OWN candidate; opponents are auto-assigned as
 * distinct candidates from the seed, skipping the player's pick (solo seats key
 * playerId == candidateId, so a duplicate seat would collide).
 *
 * Gameplay RNG (election timing, bot moves) is intentionally NOT seeded here —
 * v1 fixes the SCENARIO, not the move-by-move outcome. The whole module is pure
 * and deterministic so it is unit-testable (mirrors engine.test.ts / rewards.test.ts).
 */

import { CANDIDATES, type CandidateDef } from './candidates';

// ── Seeded PRNG (xmur3 string-hash → mulberry32 generator) ──────────────────────
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic [0,1) generator seeded by an arbitrary string. */
export function seededRng(seed: string): () => number {
  const seedFn = xmur3(seed);
  return mulberry32(seedFn());
}

// ── Date key (UTC YYYY-MM-DD) ───────────────────────────────────────────────────
export function dailyDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ── Config ──────────────────────────────────────────────────────────────────────
export interface DailyChallengeConfig {
  readonly dateKey: string;
  readonly opponentCount: 1 | 2 | 3;
  /** Daily play skews competitive — medium/hard only (assignable to BotDifficulty). */
  readonly difficulty: 'medium' | 'hard';
  readonly turnTimeLimit: number | null;
}

const DAILY_DIFFICULTIES: readonly ('medium' | 'hard')[] = ['medium', 'hard'];
const DAILY_TIMERS: readonly (number | null)[] = [60, 90, 120, null];

export function getDailyChallengeConfig(dateKey: string): DailyChallengeConfig {
  const rng = seededRng(`elector-daily-cfg:${dateKey}`);
  const opponentCount = (1 + Math.floor(rng() * 3)) as 1 | 2 | 3;
  const difficulty = DAILY_DIFFICULTIES[Math.floor(rng() * DAILY_DIFFICULTIES.length)];
  const turnTimeLimit = DAILY_TIMERS[Math.floor(rng() * DAILY_TIMERS.length)];
  return { dateKey, opponentCount, difficulty, turnTimeLimit };
}

// ── Opponents ─────────────────────────────────────────────────────────────────
/**
 * The day's opponents for a given player candidate: a deterministic seed-shuffle
 * of the roster, excluding the player's own pick, truncated to opponentCount.
 * Deterministic given (dateKey, playerCandidateId); never collides with the pick.
 */
export function resolveDailyOpponents(
  dateKey: string,
  playerCandidateId: string,
  roster: readonly CandidateDef[] = CANDIDATES,
): CandidateDef[] {
  const { opponentCount } = getDailyChallengeConfig(dateKey);
  const pool = roster.filter((c) => c.id !== playerCandidateId);
  const shuffled = shuffleSeeded(pool, seededRng(`elector-daily-opp:${dateKey}`));
  return shuffled.slice(0, Math.min(opponentCount, shuffled.length));
}

/** In-place-safe Fisher–Yates over a copy, using the injected deterministic rng. */
function shuffleSeeded<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
