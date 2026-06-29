import { describe, it, expect } from 'vitest';
import { renderShareCardSvg, shareLine, dramaticEvent } from '../utils/shareImage';

describe('share-card SVG', () => {
  it('renders winner, EV count, line, branding, and a populated US map', () => {
    const svg = renderShareCardSvg({
      winnerName: 'Kamala Harris',
      winnerEV: 312,
      line: shareLine('Kamala Harris', 312),
      stateColors: { CA: '#2563eb', TX: '#d8233c', FL: '#d8233c' },
      message: 'The map did the math. I simply provided the vibes.',
      marginOver270: 42,
      securedStates: 12,
      coalitions: 3,
      runnerUpEV: 226,
    });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Kamala Harris');
    expect(svg).toContain('312 ELECTORAL VOTES');
    expect(svg).toContain('42 over 270');
    expect(svg).toContain('The map did the math');
    expect(svg).toContain('playelector.com');

    // 50 states + DC project to real <path>s under geoAlbersUsa.
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThan(40);

    // Secured-state fill colors are carried into the map.
    expect(svg).toContain('#2563eb');
  });

  it('handles a hung Electoral College (no winner)', () => {
    const svg = renderShareCardSvg({
      winnerName: null,
      winnerEV: 0,
      line: shareLine(null, 0),
      stateColors: {},
    });

    expect(svg).toContain('Hung Electoral College');
    expect(svg).toContain('NO MAJORITY');
  });

  it('renders a portrait (9:16) variant with the candidate + highlight lines', () => {
    const svg = renderShareCardSvg({
      winnerName: 'Donald Trump',
      winnerEV: 301,
      line: shareLine('Donald Trump', 301),
      stateColors: { TX: '#d8233c' },
      variant: 'portrait',
      subtitle: 'as Donald Trump',
      highlight: '🔒 12 states secured · 🏛 4 coalitions',
      message: 'We checked the map twice. Still my name in very large letters.',
    });

    expect(svg).toContain('viewBox="0 0 1080 1920"');
    expect(svg).toContain('Donald Trump');
    expect(svg).toContain('301 ELECTORAL VOTES');
    expect(svg).toContain('as Donald Trump');
    expect(svg).toContain('We checked the map twice');
    expect(svg).toContain('playelector.com');
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(40);
  });

  it('wraps long victory messages into SVG tspans', () => {
    const svg = renderShareCardSvg({
      winnerName: 'Bobby Tooley',
      winnerEV: 350,
      line: shareLine('Bobby Tooley', 350),
      stateColors: { CA: '#22c55e' },
      message: 'I brought receipts, coalitions, and just enough cash to make the map behave while every battleground tried to make the evening difficult, every coalition demanded a second meeting, and the scoreboard kept asking for one more dramatic pause.',
    });

    expect(svg).toContain('<tspan');
    expect(svg).toContain('I brought receipts');
    expect(svg).toContain('...');
  });
});

describe('dramaticEvent', () => {
  it('summarizes a win with secured states and coalitions', () => {
    expect(dramaticEvent({ winnerName: 'X', secured: 12, coalitions: 3 }))
      .toBe('🔒 12 states called · 🏛 3 coalitions');
  });

  it('uses singular grammar for one of each', () => {
    expect(dramaticEvent({ winnerName: 'X', secured: 1, coalitions: 1 }))
      .toBe('🔒 1 state called · 🏛 1 coalition');
  });

  it('falls back to a generic line when there is no standout', () => {
    expect(dramaticEvent({ winnerName: 'X', secured: 0, coalitions: 0 }))
      .toBe('Wire-to-wire to 270');
  });

  it('handles a hung Electoral College', () => {
    expect(dramaticEvent({ winnerName: null, secured: 0, coalitions: 0 }))
      .toBe('No majority — Deadlocked Election');
  });
});
