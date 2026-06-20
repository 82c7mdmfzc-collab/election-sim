import { describe, it, expect } from 'vitest';
import { renderShareCardSvg, shareLine } from '../utils/shareImage';

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
});
