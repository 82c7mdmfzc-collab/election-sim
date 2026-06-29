/**
 * playerColors.ts — the active seat palette (normal vs colorblind-safe).
 *
 * The colorblind preference lives in localStorage (utils/localPrefs), but this
 * module deliberately does NOT read it: it exposes a plain mutable flag set by the
 * UI layer (utils/appearance.applyAppearancePrefs) at launch and whenever the
 * Settings toggle changes. Keeping it free of any browser-storage import means
 * src/game stays safe to vendor into the Deno edge function (which has no
 * localStorage) — see [[project_ios_blank_screen_fix]] for why that matters.
 *
 * Every seat-color read (game/colors.ts resolver + the setup-screen candidate
 * chips) routes through playerColorHex(), so flipping the flag recolors the whole
 * app on the next render.
 */

import { PLAYER_COLORS, PLAYER_COLORS_CB, type PlayerColorId } from './candidates';

let colorblindActive = false;

/** Set by utils/appearance from the saved `colorblindMode` pref. */
export function setColorblindPalette(active: boolean): void {
  colorblindActive = active;
}

export function isColorblindPaletteActive(): boolean {
  return colorblindActive;
}

/** Hex for a seat color in the currently-active palette. */
export function playerColorHex(id: PlayerColorId): string {
  return (colorblindActive ? PLAYER_COLORS_CB : PLAYER_COLORS)[id];
}
