import { describe, it, expect } from 'vitest';
import { sanitizeName } from './sanitize';

describe('sanitizeName', () => {
  it('keeps ordinary names intact', () => {
    expect(sanitizeName("Bob O'Brien 3")).toBe("Bob O'Brien 3");
  });

  it('strips angle brackets (defuses HTML-ish payloads)', () => {
    expect(sanitizeName('<img src=x>')).toBe('img src=x');
  });

  it('removes control characters', () => {
    expect(sanitizeName('ABC')).toBe('ABC');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeName('  hi   there  ')).toBe('hi there');
  });

  it('caps length', () => {
    expect(sanitizeName('x'.repeat(50)).length).toBe(20);
  });
});
