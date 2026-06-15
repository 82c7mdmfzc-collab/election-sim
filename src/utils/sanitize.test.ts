import { describe, it, expect } from 'vitest';
import { sanitizeName } from './sanitize';

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

describe('sanitizeName', () => {
  it('keeps ordinary names intact', () => {
    expect(sanitizeName("Bob O'Brien 3")).toBe("Bob O'Brien 3");
  });

  it('strips angle brackets (defuses HTML-ish payloads)', () => {
    expect(sanitizeName('<img src=x>')).toBe('img src=x');
  });

  it('removes control characters', () => {
    expect(sanitizeName('A' + cp(0x07) + 'BC')).toBe('ABC');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeName('  hi   there  ')).toBe('hi there');
  });

  it('caps length', () => {
    expect(sanitizeName('x'.repeat(50)).length).toBe(20);
  });

  it('strips bidi override / isolate characters', () => {
    // U+202E (RLO) and U+2066 (LRI)
    expect(sanitizeName('abc' + cp(0x202e) + 'def' + cp(0x2066))).toBe('abcdef');
  });

  it('strips zero-width characters and BOM', () => {
    // U+200B (ZWSP), U+200D (ZWJ), U+FEFF (BOM)
    expect(sanitizeName('a' + cp(0x200b) + 'b' + cp(0x200d) + 'c' + cp(0xfeff))).toBe('abc');
  });

  it('strips C1 control characters', () => {
    // U+0085 (NEL)
    expect(sanitizeName('a' + cp(0x0085) + 'b')).toBe('ab');
  });
});
