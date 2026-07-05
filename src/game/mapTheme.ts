/**
 * mapTheme.ts — the active board palette for the election map.
 *
 * A `map_theme` cosmetic recolors the neutral (un-contested) state fill and the
 * board chrome. Like game/playerColors, this module deliberately does NOT read
 * localStorage: it exposes a plain mutable flag set by the UI layer
 * (utils/appearance.applyAppearancePrefs) at launch and whenever the equipped
 * theme changes, so src/game stays safe to vendor into the Deno edge function
 * (which has no localStorage) — see [[project_ios_blank_screen_fix]].
 *
 * ElectionMap.stateColor() reads mapThemeNeutral() for the empty-state fill; the
 * board background/water is themed in App.css via the `html.map-theme-<id>` class
 * that appearance.ts toggles alongside setting this flag.
 *
 * Themes are PURELY visual (Guideline: cosmetics never affect gameplay).
 */

export type MapThemeId = 'classic' | 'theme_dusk' | 'theme_marble' | 'theme_midnight_gold';

export interface MapThemeDef {
  readonly id: MapThemeId;
  readonly name: string;
  /** Empty-state fill on the light "native" board look, RGB. */
  readonly neutralNative: readonly [number, number, number];
  /** Empty-state fill on the dark web board look, RGB. */
  readonly neutralWeb: readonly [number, number, number];
}

export const DEFAULT_MAP_THEME_ID: MapThemeId = 'classic';

/** Neutral fills for `classic` match the original hard-coded ElectionMap values,
 *  so the default board render is unchanged when no theme is equipped. */
export const MAP_THEMES: Record<MapThemeId, MapThemeDef> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    neutralNative: [246, 248, 250],
    neutralWeb: [100, 116, 139],
  },
  theme_dusk: {
    id: 'theme_dusk',
    name: 'Dusk',
    neutralNative: [244, 233, 236], // warm plum-tinted ivory
    neutralWeb: [120, 104, 122],
  },
  theme_marble: {
    id: 'theme_marble',
    name: 'Marble',
    neutralNative: [240, 238, 230], // ivory board
    neutralWeb: [110, 116, 126],
  },
  theme_midnight_gold: {
    id: 'theme_midnight_gold',
    name: 'Midnight Gold',
    neutralNative: [42, 52, 74], // near-black navy board (a dark theme even on native)
    neutralWeb: [46, 56, 80],
  },
};

let activeThemeId: MapThemeId = DEFAULT_MAP_THEME_ID;

/** Set by utils/appearance from the equipped `selectedMapTheme` pref. Unknown
 *  ids fall back to the default so a stale/removed theme never breaks the board. */
export function setActiveMapTheme(id: string): void {
  activeThemeId = (id in MAP_THEMES ? (id as MapThemeId) : DEFAULT_MAP_THEME_ID);
}

export function activeMapThemeId(): MapThemeId {
  return activeThemeId;
}

/** Empty-state fill RGB for the active theme, for the current board look. */
export function mapThemeNeutral(nativeLook: boolean): [number, number, number] {
  const t = MAP_THEMES[activeThemeId] ?? MAP_THEMES[DEFAULT_MAP_THEME_ID];
  const [r, g, b] = nativeLook ? t.neutralNative : t.neutralWeb;
  return [r, g, b];
}
