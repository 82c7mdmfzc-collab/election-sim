import { describe, expect, it } from 'vitest';
import {
  applyCandidateMasteryResult,
  candidateAtLevel,
  candidateStartingLevel,
  candidateMasteryTrainingOffer,
  computeCandidateMasteryXp,
  levelForXp,
  nextCandidateMasteryTarget,
  normalizeCandidateMastery,
} from './candidateMastery';
import { CANDIDATE_MAP, CANDIDATES } from './candidates';

function positiveStats(candidate: { affinities: Record<string, number>; payoutModifiers: Record<string, number> }) {
  return [
    ...Object.values(candidate.affinities),
    ...Object.values(candidate.payoutModifiers),
  ].filter((v) => v > 0);
}

describe('candidateMastery', () => {
  it('sets starting levels by unlock tier', () => {
    expect(candidateStartingLevel(CANDIDATE_MAP.trump)).toBe(1);
    expect(candidateStartingLevel(CANDIDATE_MAP.ronald_reagan)).toBe(2);
    expect(candidateStartingLevel(CANDIDATE_MAP.farage)).toBe(3);
  });

  it('derives levels from xp while respecting the candidate floor', () => {
    expect(levelForXp(0, 1)).toBe(1);
    expect(levelForXp(150, 1)).toBe(2);
    expect(levelForXp(899, 1)).toBe(2);
    expect(levelForXp(900, 1)).toBe(3);
    expect(levelForXp(0, 2)).toBe(2);
    expect(levelForXp(9999, 1)).toBe(5);
  });

  it('keeps strong-game level targets in the intended bands', () => {
    const strongLow = 68;
    const strongHigh = 80;
    expect(Math.ceil(900 / strongHigh)).toBeGreaterThanOrEqual(10);
    expect(Math.ceil(900 / strongLow)).toBeLessThanOrEqual(15);
    expect(Math.ceil(1800 / strongHigh)).toBeGreaterThanOrEqual(22);
    expect(Math.ceil(1800 / strongLow)).toBeLessThanOrEqual(30);
    expect(Math.ceil(4000 / strongHigh)).toBeGreaterThanOrEqual(50);
    expect(Math.ceil(4000 / strongLow)).toBeLessThanOrEqual(59);
  });

  it('computes xp from the requested formula', () => {
    expect(computeCandidateMasteryXp({
      candidateId: 'trump',
      won: true,
      securedStates: 8,
      coalitionsDominated: 3,
      mode: 'bot',
      botDifficulty: 'hard',
      turns: 12,
      electoralVotes: 320,
    })).toBe(68);
  });

  it('updates counters and reports level-ups', () => {
    const mastery = normalizeCandidateMastery({ trump: { xp: 149 } }, CANDIDATES);
    const result = applyCandidateMasteryResult(mastery, CANDIDATE_MAP.trump, {
      candidateId: 'trump',
      won: true,
      securedStates: 10,
      coalitionsDominated: 4,
      mode: 'online',
      botDifficulty: null,
      turns: 11,
      electoralVotes: 360,
    });
    expect(result.award.xpGained).toBe(80);
    expect(result.award.leveledUp).toBe(true);
    expect(result.award.previousLevel).toBe(1);
    expect(result.mastery.trump.level).toBe(2);
    expect(result.mastery.trump.onlineWins).toBe(1);
    expect(result.mastery.trump.fastestWin).toBe(11);
  });

  it('keeps level 1 positive stats in the intended range', () => {
    for (const candidate of CANDIDATES) {
      const positives = positiveStats(candidate);
      expect(Math.max(0, ...positives)).toBeLessThanOrEqual(0.20);
      expect(positives.filter((v) => v === 0.20).length).toBeLessThanOrEqual(3);
    }
  });

  it('caps level 5 signatures without turning every stat into a signature', () => {
    for (const candidate of CANDIDATES) {
      const leveled = candidateAtLevel(candidate, 5);
      const positives = positiveStats(leveled);
      expect(Math.max(0, ...positives)).toBeLessThanOrEqual(0.30);
      expect(positives.filter((v) => v === 0.30).length).toBeLessThanOrEqual(3);
    }
  });

  it('makes Farage great at level 5 without being game breaking', () => {
    const leveled = candidateAtLevel(CANDIDATE_MAP.farage, 5);
    const positives = positiveStats(leveled);
    expect(leveled.payoutModifiers['Big Conservative']).toBe(0.30);
    expect(positives.filter((v) => v === 0.30).length).toBe(3);
    expect(positives.filter((v) => v < 0.30).every((v) => v >= 0.15 && v <= 0.20)).toBe(true);
  });

  it('improves positive stats, lightly softens penalties, and modestly boosts cash by level', () => {
    const base = CANDIDATE_MAP.harris;
    const leveled = candidateAtLevel(base, 5);
    expect(leveled.startingCash).toBe(base.startingCash + 12);
    expect(leveled.baseIncome).toBe(base.baseIncome);
    expect(leveled.affinities.Environmental).toBeGreaterThan(base.affinities.Environmental);
    expect(leveled.affinities['Big Conservative']).toBeGreaterThan(base.affinities['Big Conservative']);
    expect(leveled.affinities['Big Conservative']).toBeLessThan(0);
    expect(leveled.affinities['Big Conservative']).toBe(-0.23);
  });

  it('leaves Washington net-neutral at every level', () => {
    const base = CANDIDATE_MAP.washington;
    const leveled = candidateAtLevel(base, 5);
    expect(leveled.startingCash).toBe(base.startingCash);
    expect(leveled.baseIncome).toBe(base.baseIncome);
    expect(leveled.affinities).toEqual(base.affinities);
    expect(leveled.payoutModifiers).toEqual(base.payoutModifiers);
  });

  it('finds the nearest unfinished mastery target', () => {
    const mastery = normalizeCandidateMastery({ trump: { xp: 149 } }, CANDIDATES);
    const target = nextCandidateMasteryTarget(mastery, CANDIDATES);
    expect(target?.candidateId).toBe('trump');
    expect(target?.xpNeeded).toBe(1);
  });

  it('prices candidate training by next level', () => {
    const mastery = normalizeCandidateMastery({ trump: { xp: 899 } }, CANDIDATES);
    const offer = candidateMasteryTrainingOffer(CANDIDATE_MAP.trump, mastery);
    expect(offer).toMatchObject({ nextLevel: 3, xpNeeded: 1, cost: 2000 });
  });
});
