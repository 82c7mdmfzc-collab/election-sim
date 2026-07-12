/**
 * appearance.ts — apply the device-local accessibility prefs to the live document.
 *
 * Called once on app launch and again whenever a Settings toggle changes, so the
 * `reduce-motion` / `cb-safe` html classes (consumed by App.css) and the in-game
 * color palette (game/playerColors) always reflect the saved preference.
 */

import { isReducedMotion, isColorblindMode, getSelectedMapTheme } from './localPrefs';
import { setColorblindPalette } from '../game/playerColors';
import { setActiveMapTheme, activeMapThemeId, MAP_THEMES, type MapThemeId } from '../game/mapTheme';

/** True when animations should be skipped: the user's Settings toggle (the
 *  `reduce-motion` html class this module maintains) or the OS-level
 *  prefers-reduced-motion. Exit animations check this to close immediately. */
export function motionReduced(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement.classList.contains('reduce-motion') ||
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  );
}

export function applyAppearancePrefs(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('reduce-motion', isReducedMotion());
  const cb = isColorblindMode();
  root.classList.toggle('cb-safe', cb);
  setColorblindPalette(cb);

  // Board map theme: set the edge-safe flag (ElectionMap reads it) + toggle the
  // `map-theme-<id>` html class (App.css themes the board chrome). Clear every
  // known theme class first so switching themes never stacks stale classes.
  setActiveMapTheme(getSelectedMapTheme());
  const active = activeMapThemeId();
  for (const id of Object.keys(MAP_THEMES) as MapThemeId[]) {
    root.classList.toggle(`map-theme-${id}`, id === active);
  }
}
