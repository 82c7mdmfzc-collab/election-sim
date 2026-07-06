import { describe, it, expect } from 'vitest';
import { compareSemver, isOlder } from './appVersion';

describe('compareSemver', () => {
  it('orders patch versions numerically, not lexically', () => {
    // The load-bearing case: 1.0.10 must be NEWER than 1.0.2.
    expect(compareSemver('1.0.10', '1.0.2')).toBe(1);
    expect(compareSemver('1.0.2', '1.0.10')).toBe(-1);
  });

  it('treats equal versions as equal', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('2.3.4', '2.3.4')).toBe(0);
  });

  it('compares minor before patch', () => {
    expect(compareSemver('1.2.0', '1.10.0')).toBe(-1); // 1.2 < 1.10
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1);
  });

  it('handles differing segment counts', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.1', '1.0')).toBe(1);
    expect(compareSemver('1.2', '1.2.5')).toBe(-1);
  });
});

describe('isOlder', () => {
  it('is true only when strictly older', () => {
    expect(isOlder('1.0.2', '1.0.10')).toBe(true);
    expect(isOlder('1.0.10', '1.0.2')).toBe(false);
    expect(isOlder('1.0.0', '1.0.0')).toBe(false);
  });
});
