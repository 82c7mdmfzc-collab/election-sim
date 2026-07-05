import { describe, it, expect } from 'vitest';
import { CANDIDATE_MAP } from './candidates';
import {
  MASTERY_XP_THRESHOLDS,
  masteryProgressForXp,
  masteryLevelUpPreview,
} from './candidateMastery';

const tooley = CANDIDATE_MAP.tooley;       // free candidate, floor level 1, only cash scales
const reagan = CANDIDATE_MAP.ronald_reagan; // strong ≥0.10 modifiers that scale per level
const washington = CANDIDATE_MAP.washington; // deliberately non-scaling kit

describe('masteryProgressForXp', () => {
  it('reports a fresh level-1 candidate at 0% into the first band', () => {
    const p = masteryProgressForXp(tooley, 0);
    expect(p.level).toBe(1);
    expect(p.isMax).toBe(false);
    expect(p.prevThreshold).toBe(0);
    expect(p.nextThreshold).toBe(MASTERY_XP_THRESHOLDS[1]); // 150
    expect(p.pct).toBe(0);
  });

  it('computes fill within the current band', () => {
    const p = masteryProgressForXp(tooley, 75); // halfway to 150
    expect(p.level).toBe(1);
    expect(p.xpIntoLevel).toBe(75);
    expect(p.xpForSpan).toBe(150);
    expect(p.pct).toBe(50);
  });

  it('caps at max level with a full bar and no next band', () => {
    const p = masteryProgressForXp(tooley, 99_999);
    expect(p.level).toBe(5);
    expect(p.isMax).toBe(true);
    expect(p.pct).toBe(100);
    expect(p.xpForSpan).toBe(0);
  });
});

describe('masteryLevelUpPreview', () => {
  it('describes at least a cash gain for a free scaling kit', () => {
    const preview = masteryLevelUpPreview(tooley, 1);
    expect(preview).not.toBeNull();
    expect(preview!.toLevel).toBe(2);
    // Tooley's tiny 0.05 modifiers are below the scaling threshold, so only cash grows.
    expect(preview!.cashDelta).toBeGreaterThan(0);
  });

  it('lists concrete modifier changes for a strong kit (Reagan)', () => {
    const preview = masteryLevelUpPreview(reagan, 2);
    expect(preview).not.toBeNull();
    expect(preview!.toLevel).toBe(3);
    expect(preview!.changes.length).toBeGreaterThan(0);
    // Every listed change is a genuine improvement (from ≠ to).
    for (const c of preview!.changes) expect(c.to).not.toBe(c.from);
  });

  it('returns null at max level', () => {
    expect(masteryLevelUpPreview(tooley, 5)).toBeNull();
  });

  it('returns null for a non-scaling kit (Washington)', () => {
    expect(masteryLevelUpPreview(washington, 1)).toBeNull();
  });
});
