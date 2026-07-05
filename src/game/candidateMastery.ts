import { CANDIDATE_PRICE, type CandidateDef } from './candidates';
import type { BotDifficulty } from './types';

export type CandidateLevel = 1 | 2 | 3 | 4 | 5;

export interface CandidateMasteryEntry {
  xp: number;
  level: CandidateLevel;
  gamesFinished: number;
  wins: number;
  bestEv: number;
  fastestWin: number | null;
  maxCoalitions: number;
  maxSecuredStates: number;
  hardWins: number;
  onlineWins: number;
}

export type CandidateMastery = Record<string, CandidateMasteryEntry>;

export interface CandidateMasteryAwardInput {
  candidateId: string | null;
  won: boolean;
  securedStates: number;
  coalitionsDominated: number;
  mode: 'single' | 'bot' | 'daily' | 'online';
  botDifficulty: BotDifficulty | null;
  turns: number;
  electoralVotes: number;
}

export interface CandidateMasteryAward {
  candidateId: string | null;
  xpGained: number;
  previousLevel: CandidateLevel;
  newLevel: CandidateLevel;
  leveledUp: boolean;
}

export const MASTERY_XP_THRESHOLDS = [0, 150, 900, 1800, 4000] as const;

export const MASTERY_TRAINING_COSTS: Record<CandidateLevel, number> = {
  1: 0,
  2: 750,
  3: 2000,
  4: 4500,
  5: 9000,
};

export const DEFAULT_MASTERY_ENTRY: CandidateMasteryEntry = {
  xp: 0,
  level: 1,
  gamesFinished: 0,
  wins: 0,
  bestEv: 0,
  fastestWin: null,
  maxCoalitions: 0,
  maxSecuredStates: 0,
  hardWins: 0,
  onlineWins: 0,
};

function clampInt(v: unknown, min: number, max: number): number {
  return Math.max(min, Math.min(max, typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : min));
}

export function candidateStartingLevel(candidate: CandidateDef): CandidateLevel {
  if (candidate.unlockCost >= CANDIDATE_PRICE.TIER3) return 3;
  if (candidate.unlockCost >= CANDIDATE_PRICE.TIER2) return 2;
  return 1;
}

export function levelForXp(xp: number, floor: CandidateLevel = 1): CandidateLevel {
  const safeXp = clampInt(xp, 0, Number.MAX_SAFE_INTEGER);
  let level: CandidateLevel = floor;
  for (let i = 0; i < MASTERY_XP_THRESHOLDS.length; i++) {
    if (safeXp >= MASTERY_XP_THRESHOLDS[i]) level = Math.max(level, i + 1) as CandidateLevel;
  }
  return Math.min(5, level) as CandidateLevel;
}

export function normalizeCandidateMasteryEntry(
  raw: unknown,
  candidate: CandidateDef,
): CandidateMasteryEntry {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const xp = clampInt(obj.xp, 0, Number.MAX_SAFE_INTEGER);
  const floor = candidateStartingLevel(candidate);
  return {
    xp,
    level: levelForXp(xp, floor),
    gamesFinished: clampInt(obj.gamesFinished, 0, Number.MAX_SAFE_INTEGER),
    wins: clampInt(obj.wins, 0, Number.MAX_SAFE_INTEGER),
    bestEv: clampInt(obj.bestEv, 0, 538),
    fastestWin: typeof obj.fastestWin === 'number' && Number.isFinite(obj.fastestWin)
      ? clampInt(obj.fastestWin, 1, 99)
      : null,
    maxCoalitions: clampInt(obj.maxCoalitions, 0, 20),
    maxSecuredStates: clampInt(obj.maxSecuredStates, 0, 56),
    hardWins: clampInt(obj.hardWins, 0, Number.MAX_SAFE_INTEGER),
    onlineWins: clampInt(obj.onlineWins, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function normalizeCandidateMastery(
  raw: unknown,
  candidates: readonly CandidateDef[],
): CandidateMastery {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.id,
      normalizeCandidateMasteryEntry(obj[candidate.id], candidate),
    ]),
  );
}

export function computeCandidateMasteryXp(input: CandidateMasteryAwardInput): number {
  const hardWin = input.won && input.mode === 'bot'
    && (input.botDifficulty === 'hard' || input.botDifficulty === 'impossible');
  return 10
    + (input.won ? 25 : 0)
    + Math.max(0, input.securedStates)
    + Math.max(0, input.coalitionsDominated) * 5
    + (hardWin ? 10 : 0)
    + (input.won && input.mode === 'online' ? 15 : 0);
}

export function applyCandidateMasteryResult(
  current: CandidateMastery,
  candidate: CandidateDef | null,
  input: CandidateMasteryAwardInput,
): { mastery: CandidateMastery; award: CandidateMasteryAward } {
  if (!candidate) {
    return {
      mastery: current,
      award: { candidateId: null, xpGained: 0, previousLevel: 1, newLevel: 1, leveledUp: false },
    };
  }
  const previous = normalizeCandidateMasteryEntry(current[candidate.id], candidate);
  const xpGained = computeCandidateMasteryXp(input);
  const xp = previous.xp + xpGained;
  const next: CandidateMasteryEntry = {
    xp,
    level: levelForXp(xp, candidateStartingLevel(candidate)),
    gamesFinished: previous.gamesFinished + 1,
    wins: previous.wins + (input.won ? 1 : 0),
    bestEv: Math.max(previous.bestEv, input.electoralVotes),
    fastestWin: input.won
      ? previous.fastestWin == null ? input.turns : Math.min(previous.fastestWin, input.turns)
      : previous.fastestWin,
    maxCoalitions: Math.max(previous.maxCoalitions, input.coalitionsDominated),
    maxSecuredStates: Math.max(previous.maxSecuredStates, input.securedStates),
    hardWins: previous.hardWins + (
      input.won && input.mode === 'bot' && (input.botDifficulty === 'hard' || input.botDifficulty === 'impossible') ? 1 : 0
    ),
    onlineWins: previous.onlineWins + (input.won && input.mode === 'online' ? 1 : 0),
  };
  return {
    mastery: { ...current, [candidate.id]: next },
    award: {
      candidateId: candidate.id,
      xpGained,
      previousLevel: previous.level,
      newLevel: next.level,
      leveledUp: next.level > previous.level,
    },
  };
}

function tuneStat(value: number, level: CandidateLevel): number {
  const step = level - 1;
  if (value >= 0.20) return Math.min(0.30, Number((value + step * 0.025).toFixed(3)));
  if (value >= 0.10) return Math.min(value + 0.05, Number((value + step * 0.0125).toFixed(3)));
  if (value > 0) return value;
  if (value < 0) return Math.min(0, Number((value + step * 0.005).toFixed(3)));
  return 0;
}

function tuneMap(stats: Record<string, number>, level: CandidateLevel): Record<string, number> {
  return Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, tuneStat(value, level)]));
}

export function candidateAtLevel(candidate: CandidateDef, level: CandidateLevel): CandidateDef {
  const floor = candidateStartingLevel(candidate);
  const safeLevel = Math.max(floor, Math.min(5, level)) as CandidateLevel;
  const step = safeLevel - 1;
  const statsScale = candidate.id !== 'washington';
  return {
    ...candidate,
    startingCash: candidate.startingCash + (statsScale ? step * 3 : 0),
    baseIncome: candidate.baseIncome,
    affinities: statsScale ? tuneMap(candidate.affinities, safeLevel) : { ...candidate.affinities },
    payoutModifiers: statsScale ? tuneMap(candidate.payoutModifiers, safeLevel) : { ...candidate.payoutModifiers },
  };
}

export function candidateAtMastery(candidate: CandidateDef, mastery: CandidateMastery): CandidateDef {
  const entry = normalizeCandidateMasteryEntry(mastery[candidate.id], candidate);
  return candidateAtLevel(candidate, entry.level);
}

export interface NextMasteryTarget {
  candidateId: string;
  candidateName: string;
  level: CandidateLevel;
  xp: number;
  nextLevel: CandidateLevel;
  xpNeeded: number;
  progressPct: number;
}

export interface CandidateMasteryTrainingOffer {
  candidateId: string;
  nextLevel: CandidateLevel;
  xpNeeded: number;
  cost: number;
}

export function candidateMasteryTrainingOffer(
  candidate: CandidateDef,
  mastery: CandidateMastery,
): CandidateMasteryTrainingOffer | null {
  const entry = normalizeCandidateMasteryEntry(mastery[candidate.id], candidate);
  if (entry.level >= 5) return null;
  const nextLevel = (entry.level + 1) as CandidateLevel;
  const nextXp = MASTERY_XP_THRESHOLDS[nextLevel - 1];
  return {
    candidateId: candidate.id,
    nextLevel,
    xpNeeded: Math.max(0, nextXp - entry.xp),
    cost: MASTERY_TRAINING_COSTS[nextLevel],
  };
}

// ── Progress + benefit helpers (UI clarity) ───────────────────────────────────

export interface MasteryProgress {
  level: CandidateLevel;
  xp: number;
  /** True once the candidate is level 5 (no further XP band). */
  isMax: boolean;
  /** XP total at the start of the current level. */
  prevThreshold: number;
  /** XP total that unlocks the next level (== prevThreshold at max). */
  nextThreshold: number;
  /** XP earned into the current level band. */
  xpIntoLevel: number;
  /** Width of the current level band (0 at max). */
  xpForSpan: number;
  /** 0–100 fill within the current level (100 at max). */
  pct: number;
}

/** Where a raw XP value sits within a candidate's level bands (respects the paid
 *  starting-level floor). Drives XP bars on the stats modal + victory reveal. */
export function masteryProgressForXp(candidate: CandidateDef, xp: number): MasteryProgress {
  const thresholds: readonly number[] = MASTERY_XP_THRESHOLDS;
  const floor = candidateStartingLevel(candidate);
  const safeXp = clampInt(xp, 0, Number.MAX_SAFE_INTEGER);
  const level = levelForXp(safeXp, floor);
  const isMax = level >= 5;
  const prevThreshold = thresholds[level - 1] ?? 0;
  const nextThreshold = isMax ? prevThreshold : (thresholds[level] ?? prevThreshold);
  const xpForSpan = Math.max(0, nextThreshold - prevThreshold);
  const xpIntoLevel = Math.max(0, safeXp - prevThreshold);
  const pct = isMax ? 100 : Math.max(0, Math.min(100, Math.round((xpIntoLevel / Math.max(1, xpForSpan)) * 100)));
  return { level, xp: safeXp, isMax, prevThreshold, nextThreshold, xpIntoLevel, xpForSpan, pct };
}

export function masteryProgress(candidate: CandidateDef, mastery: CandidateMastery): MasteryProgress {
  const entry = normalizeCandidateMasteryEntry(mastery[candidate.id], candidate);
  return masteryProgressForXp(candidate, entry.xp);
}

export interface MasteryStatChange {
  /** Group id the modifier applies to. */
  key: string;
  kind: 'cost' | 'payout';
  from: number;
  to: number;
}

export interface MasteryLevelBenefits {
  fromLevel: CandidateLevel;
  toLevel: CandidateLevel;
  /** Extra starting cash gained at the next level. */
  cashDelta: number;
  changes: MasteryStatChange[];
}

/** What improves when this candidate goes from `level` to `level + 1`, computed by
 *  diffing candidateAtLevel(). Returns null at max level or for non-scaling kits
 *  (Washington), so the stats modal can show a clean "already maxed / neutral" note. */
export function masteryLevelUpPreview(
  candidate: CandidateDef,
  level: CandidateLevel,
): MasteryLevelBenefits | null {
  if (level >= 5) return null;
  const toLevel = (level + 1) as CandidateLevel;
  const before = candidateAtLevel(candidate, level);
  const after = candidateAtLevel(candidate, toLevel);
  const changes: MasteryStatChange[] = [];
  const collect = (kind: 'cost' | 'payout', a: Record<string, number>, b: Record<string, number>) => {
    for (const key of Object.keys(b)) {
      const from = a[key] ?? 0;
      const to = b[key] ?? 0;
      if (Math.abs(to - from) > 1e-9) changes.push({ key, kind, from, to });
    }
  };
  collect('cost', before.affinities, after.affinities);
  collect('payout', before.payoutModifiers, after.payoutModifiers);
  const cashDelta = after.startingCash - before.startingCash;
  if (cashDelta === 0 && changes.length === 0) return null; // no scaling (e.g. Washington)
  return { fromLevel: level, toLevel, cashDelta, changes };
}

export function nextCandidateMasteryTarget(
  mastery: CandidateMastery,
  candidates: readonly CandidateDef[],
): NextMasteryTarget | null {
  const targets: NextMasteryTarget[] = [];
  for (const candidate of candidates) {
    const entry = normalizeCandidateMasteryEntry(mastery[candidate.id], candidate);
    if (entry.level >= 5) continue;
    const nextLevel = (entry.level + 1) as CandidateLevel;
    const nextXp = MASTERY_XP_THRESHOLDS[nextLevel - 1];
    const prevXp = MASTERY_XP_THRESHOLDS[entry.level - 1];
    const span = Math.max(1, nextXp - prevXp);
    targets.push({
        candidateId: candidate.id,
        candidateName: candidate.name,
        level: entry.level,
        xp: entry.xp,
        nextLevel,
        xpNeeded: Math.max(0, nextXp - entry.xp),
        progressPct: Math.max(0, Math.min(100, Math.round(((entry.xp - prevXp) / span) * 100))),
    });
  }
  targets.sort((a, b) => a.xpNeeded - b.xpNeeded);
  return targets[0] ?? null;
}
