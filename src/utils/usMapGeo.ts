/**
 * Standalone US-state SVG path geometry for the share-card.
 *
 * ElectionMap.tsx renders the live map via <react-simple-maps>, but the share-card
 * must be a single self-contained <svg> (so it can be serialized → PNG via canvas).
 * We therefore project the same `us-atlas` topology ourselves with d3-geo and emit
 * raw `<path d="…">` strings keyed by our StateId.
 *
 * d3-geo + topojson-client are already in the tree as transitive deps of
 * react-simple-maps; no new package is added.
 */
import { geoPath, geoAlbersUsa } from 'd3-geo';
import { feature } from 'topojson-client';
import usAtlas from 'us-atlas/states-10m.json';
import type { StateId } from '../game/types';

// FIPS → our two-letter StateId (mirrors the table in ElectionMap.tsx).
const FIPS_TO_STATE: Record<string, StateId> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
};

export interface StatePath {
  stateId: StateId;
  /** SVG path data, projected into a [width × height] box at the origin. */
  d: string;
}

// Projection + path generation is pure for a given size, so cache per size.
const cache = new Map<string, StatePath[]>();

/**
 * Returns one SVG path per US state, projected (geoAlbersUsa, fit-to-size) into a
 * `width × height` box anchored at (0,0). Caller positions the group with a transform.
 */
export function geoStatePaths(width: number, height: number): StatePath[] {
  const key = `${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const fc = feature(usAtlas, (usAtlas as { objects: { states: unknown } }).objects.states);
  const projection = geoAlbersUsa().fitSize([width, height], fc as never);
  const path = geoPath(projection);

  const out: StatePath[] = [];
  for (const f of fc.features) {
    const fips = String(f.id ?? '').padStart(2, '0');
    const stateId = FIPS_TO_STATE[fips];
    if (!stateId) continue;
    const d = path(f as never);
    if (d) out.push({ stateId, d });
  }

  cache.set(key, out);
  return out;
}
