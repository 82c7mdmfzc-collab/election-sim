/**
 * modifiers.ts — the game-modifier catalog + rolling (pure, edge-safe).
 *
 * A "modifier" is a rule twist applied for a whole game. Every game has a 40%
 * chance of one; the Daily Challenge gets a deterministic one per day; online
 * "Crazy Mode" guarantees two. Effects live on GameState.modifiers (see
 * types.GameModifiers); the reveal + HUD read GameState.activeModifierIds.
 *
 * No DOM / localStorage / Date.now here — this module is vendored into the Deno
 * resolve-turn edge function (the server rolls online modifiers). Callers inject
 * the RNG (`rand`) and the clock (`nowMs`) so the module stays deterministic and
 * testable. See [[project_ios_blank_screen_fix]] for why src/game must stay pure.
 */

import type { GameModifiers, GameState, PlayerState } from './types';
import { seededRng } from './dailyChallenge';

export interface ModifierDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** True for modifiers that add a genuinely new mechanic (vs a numeric tweak). */
  readonly isNewMechanic?: boolean;
  /** The effect merged into GameModifiers when this modifier is active. */
  readonly effect: GameModifiers;
}

/** 40% of games roll a modifier. */
export const MODIFIER_CHANCE = 0.4;

/** Crazy Mode (online, 2 guaranteed modifiers) is available until this instant. */
export const CRAZY_MODE_END_MS = Date.parse('2026-08-21T00:00:00Z'); // through Aug 20 UTC

export const MODIFIERS: readonly ModifierDef[] = [
  // ── Numeric tweaks ─────────────────────────────────────────────────────────
  { id: 'coalition_windfall', name: 'Coalition Windfall', description: 'Coalition payouts are doubled.', effect: { coalitionPayoutMult: 2 } },
  { id: 'megastate_fire_sale', name: 'Megastate Fire Sale', description: 'CA, FL, TX & NY rungs cost 25% less.', effect: { megastateCostMult: 0.75 } },
  { id: 'grassroots', name: 'Grassroots', description: 'Every non-megastate rung costs 20% less.', effect: { nonMegastateCostMult: 0.8 } },
  { id: 'war_chest', name: 'War Chest', description: 'Everyone starts with +$400k.', effect: { startingCashBonus: 400 } },
  { id: 'lobby_frenzy', name: 'Lobby Frenzy', description: 'National lobby bonuses are doubled.', effect: { nationalBonusMult: 2 } },
  { id: 'high_turnout', name: 'High Turnout', description: 'Campaign income is 50% higher.', effect: { incomeMult: 1.5 } },
  { id: 'snap_election', name: 'Snap Election', description: 'The election can fire from turn 6.', effect: { electionStartTurn: 6 } },
  { id: 'landslide_line', name: 'Landslide Line', description: 'Only 250 electoral votes are needed to win.', effect: { winThreshold: 250 } },
  // ── New mechanics ──────────────────────────────────────────────────────────
  { id: 'ground_game', name: 'Ground Game', description: 'No entry cap — buy as many rungs as you can afford on a state’s first turn.', isNewMechanic: true, effect: { entryCapLifted: true } },
  { id: 'october_surprise', name: 'October Surprise', description: 'Each round, the tightest race loses a rung for its leader.', isNewMechanic: true, effect: { octoberSurprise: true } },
];

export const MODIFIER_MAP: Record<string, ModifierDef> =
  Object.fromEntries(MODIFIERS.map((m) => [m.id, m]));

const MULT_MIN = 0.5;
const MULT_MAX = 4;

/** Clamp a GameModifiers object to safe ranges (it can ride in tamperable lobby jsonb). */
export function normalizeModifiers(m: GameModifiers): GameModifiers {
  const clampMult = (v: number | undefined) =>
    v == null ? undefined : Math.max(MULT_MIN, Math.min(MULT_MAX, v));
  const out: GameModifiers = {};
  if (m.coalitionPayoutMult != null) out.coalitionPayoutMult = clampMult(m.coalitionPayoutMult);
  if (m.nationalBonusMult != null) out.nationalBonusMult = clampMult(m.nationalBonusMult);
  if (m.incomeMult != null) out.incomeMult = clampMult(m.incomeMult);
  if (m.megastateCostMult != null) out.megastateCostMult = clampMult(m.megastateCostMult);
  if (m.nonMegastateCostMult != null) out.nonMegastateCostMult = clampMult(m.nonMegastateCostMult);
  if (m.startingCashBonus != null) out.startingCashBonus = Math.max(0, Math.min(2000, Math.round(m.startingCashBonus)));
  if (m.electionStartTurn != null) out.electionStartTurn = Math.max(4, Math.min(10, Math.round(m.electionStartTurn)));
  if (m.winThreshold != null) out.winThreshold = Math.max(230, Math.min(300, Math.round(m.winThreshold)));
  if (m.entryCapLifted) out.entryCapLifted = true;
  if (m.octoberSurprise) out.octoberSurprise = true;
  return out;
}

/** Merge the effects of the given modifier ids into one clamped GameModifiers. */
export function buildModifiers(ids: readonly string[]): GameModifiers {
  const merged: GameModifiers = {};
  for (const id of ids) {
    const def = MODIFIER_MAP[id];
    if (def) Object.assign(merged, def.effect);
  }
  return normalizeModifiers(merged);
}

/** True when this game should roll a modifier (`rand` injected for determinism/tests). */
export function rollHitsChance(rand: () => number): boolean {
  return rand() < MODIFIER_CHANCE;
}

/** Pick `count` distinct modifier ids, excluding `exclude`, using `rand`. */
export function rollModifierIds(count: number, exclude: readonly string[], rand: () => number): string[] {
  const pool = MODIFIERS.map((m) => m.id).filter((id) => !exclude.includes(id));
  const picked: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rand() * pool.length);
    picked.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
  }
  return picked;
}

/** The one deterministic modifier for a given daily-challenge date (never random). */
export function dailyModifierId(dateKey: string): string {
  const rng = seededRng(`elector-daily-modifier:${dateKey}`);
  return MODIFIERS[Math.floor(rng() * MODIFIERS.length)].id;
}

export function isCrazyModeAvailable(nowMs: number): boolean {
  return nowMs < CRAZY_MODE_END_MS;
}

/** Add a modifier's starting-cash bonus to every seat (War Chest). Mutates players. */
export function applyStartingCashBonus(players: PlayerState[], modifiers: GameModifiers | undefined): void {
  const bonus = modifiers?.startingCashBonus ?? 0;
  if (bonus <= 0) return;
  for (const p of players) p.nationalCash += bonus;
}

/**
 * Stamp rolled modifiers onto a freshly-created game state: sets `modifiers` +
 * `activeModifierIds` and applies any starting-cash bonus. Returns the same state
 * (mutated in place — only ever called on a brand-new state). Empty ids = no-op.
 */
export function applyRolledModifiers(state: GameState, ids: readonly string[]): GameState {
  if (ids.length === 0) return state;
  const modifiers = buildModifiers(ids);
  applyStartingCashBonus(state.players, modifiers);
  state.modifiers = modifiers;
  state.activeModifierIds = [...ids];
  return state;
}
