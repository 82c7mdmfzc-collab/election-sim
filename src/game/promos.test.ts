import { describe, it, expect } from 'vitest';
import { isCandidateFreeClaimAvailable } from './promos';

describe('isCandidateFreeClaimAvailable', () => {
  const july = new Date('2026-07-15T12:00:00Z');
  const earlyJuly = new Date('2026-07-01T00:00:00Z');
  const lateJuly = new Date('2026-07-31T23:59:59Z');
  const june = new Date('2026-06-30T23:59:59Z');
  const august = new Date('2026-08-01T00:00:00Z');

  it('washington is claimable throughout July', () => {
    expect(isCandidateFreeClaimAvailable('washington', july)).toBe(true);
    expect(isCandidateFreeClaimAvailable('washington', earlyJuly)).toBe(true);
    expect(isCandidateFreeClaimAvailable('washington', lateJuly)).toBe(true);
  });

  it('washington is NOT claimable outside July', () => {
    expect(isCandidateFreeClaimAvailable('washington', june)).toBe(false);
    expect(isCandidateFreeClaimAvailable('washington', august)).toBe(false);
  });

  it('other candidates are never free-claimable, even in July', () => {
    expect(isCandidateFreeClaimAvailable('jfk', july)).toBe(false);
    expect(isCandidateFreeClaimAvailable('trump', july)).toBe(false);
    expect(isCandidateFreeClaimAvailable('farage', july)).toBe(false);
    expect(isCandidateFreeClaimAvailable('tooley', july)).toBe(false);
  });

  it('returns a boolean when no date is supplied (uses now)', () => {
    expect(typeof isCandidateFreeClaimAvailable('washington')).toBe('boolean');
  });
});
