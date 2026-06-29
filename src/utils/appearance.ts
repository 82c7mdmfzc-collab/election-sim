/**
 * appearance.ts — apply the device-local accessibility prefs to the live document.
 *
 * Called once on app launch and again whenever a Settings toggle changes, so the
 * `reduce-motion` / `cb-safe` html classes (consumed by App.css) and the in-game
 * color palette (game/playerColors) always reflect the saved preference.
 */

import { isReducedMotion, isColorblindMode } from './localPrefs';
import { setColorblindPalette } from '../game/playerColors';

export function applyAppearancePrefs(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('reduce-motion', isReducedMotion());
  const cb = isColorblindMode();
  root.classList.toggle('cb-safe', cb);
  setColorblindPalette(cb);
}
