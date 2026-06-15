/**
 * Player color resolution (2–4 players).
 *
 * Each candidate has a preferred political color. When two chosen candidates
 * prefer the same color, later seats fall back to the next free color in
 * SEAT_ORDER, so every player is always visually distinct.
 */

import { CANDIDATE_MAP, PLAYER_COLORS, type PlayerColorId } from './candidates';

const SEAT_ORDER: PlayerColorId[] = ['red', 'blue', 'green', 'purple'];

export interface ResolvedColor {
  id: PlayerColorId;
  hex: string;
  rgb: [number, number, number];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function make(id: PlayerColorId): ResolvedColor {
  const hex = PLAYER_COLORS[id];
  return { id, hex, rgb: hexToRgb(hex) };
}

/** Assign a distinct color to each player, preferring their candidate color. */
export function assignPlayerColors(
  players: ReadonlyArray<{ id: string; candidateId?: string }>,
): Record<string, ResolvedColor> {
  const used = new Set<PlayerColorId>();
  const out: Record<string, ResolvedColor> = {};

  // Pass 1 — honor each candidate's preferred color when still free.
  for (const p of players) {
    const pref = CANDIDATE_MAP[p.candidateId ?? p.id]?.color;
    if (pref && !used.has(pref)) {
      used.add(pref);
      out[p.id] = make(pref);
    }
  }
  // Pass 2 — fill any remaining seats from the palette.
  for (const p of players) {
    if (out[p.id]) continue;
    const free = SEAT_ORDER.find((c) => !used.has(c)) ?? 'blue';
    used.add(free);
    out[p.id] = make(free);
  }
  return out;
}

export const NEUTRAL_RGB: [number, number, number] = [100, 116, 139];

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function rgbStr([r, g, b]: [number, number, number]): string {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
