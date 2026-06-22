import { describe, it, expect } from 'vitest';
import { renderShareCardSvg, shareLine, dramaticEvent } from '../utils/shareImage';

describe('share-card SVG', () => {
  it('renders winner, EV count, line, branding, and a populated US map', () => {
    const svg = renderShareCardSvg({
      winnerName: 'Kamala Harris',
      winnerEV: 312,
      line: shareLine('Kamala Harris', 312),
      stateColors: { CA: '#2563eb', TX: '#d8233c', FL: '#d8233c' },
    });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Kamala Harris');
    expect(svg).toContain('312 ELECTORAL VOTES');
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
    });

    expect(svg).toContain('viewBox="0 0 1080 1920"');
    expect(svg).toContain('Donald Trump');
    expect(svg).toContain('301 ELECTORAL VOTES');
    expect(svg).toContain('as Donald Trump');
    expect(svg).toContain('playelector.com');
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(40);
  });
});

describe('dramaticEvent', () => {
  it('summarizes a win with secured states and coalitions', () => {
    expect(dramaticEvent({ winnerName: 'X', secured: 12, coalitions: 3 }))
      .toBe('🔒 12 states secured · 🏛 3 coalitions');
  });

  it('uses singular grammar for one of each', () => {
    expect(dramaticEvent({ winnerName: 'X', secured: 1, coalitions: 1 }))
      .toBe('🔒 1 state secured · 🏛 1 coalition');
  });

  it('falls back to a generic line when there is no standout', () => {
    expect(dramaticEvent({ winnerName: 'X', secured: 0, coalitions: 0 }))
      .toBe('Wire-to-wire to 270');
  });

  it('handles a hung Electoral College', () => {
    expect(dramaticEvent({ winnerName: null, secured: 0, coalitions: 0 }))
      .toBe('No majority — a hung Electoral College');
  });
});
