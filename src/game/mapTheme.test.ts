import { describe, it, expect, afterEach } from 'vitest';
import {
  MAP_THEMES,
  DEFAULT_MAP_THEME_ID,
  setActiveMapTheme,
  activeMapThemeId,
  mapThemeNeutral,
} from './mapTheme';
import { isBannerId, isCosmeticAvailable, purchasableCosmetics } from './cosmetics';

afterEach(() => setActiveMapTheme(DEFAULT_MAP_THEME_ID));

describe('mapTheme', () => {
  it('defaults to classic with the original neutral fills', () => {
    expect(activeMapThemeId()).toBe('classic');
    expect(mapThemeNeutral(true)).toEqual([246, 248, 250]); // unchanged native default
    expect(mapThemeNeutral(false)).toEqual([100, 116, 139]); // unchanged web default
  });

  it('switches the active neutral when a theme is equipped', () => {
    setActiveMapTheme('theme_midnight_gold');
    expect(activeMapThemeId()).toBe('theme_midnight_gold');
    expect(mapThemeNeutral(true)).toEqual([...MAP_THEMES.theme_midnight_gold.neutralNative]);
  });

  it('falls back to the default for an unknown/stale theme id', () => {
    setActiveMapTheme('does_not_exist');
    expect(activeMapThemeId()).toBe(DEFAULT_MAP_THEME_ID);
  });
});

describe('cosmetics catalog', () => {
  it('recognizes profile banner ids only', () => {
    expect(isBannerId('banner_laurel')).toBe(true);
    expect(isBannerId('theme_dusk')).toBe(false); // a map theme, not a banner
    expect(isBannerId('')).toBe(false);
    expect(isBannerId('nope')).toBe(false);
  });

  it('hides season-exclusive rewards from the shop rails', () => {
    const themes = purchasableCosmetics('map_theme').map((c) => c.id);
    expect(themes).toContain('theme_dusk');
    expect(themes).toContain('theme_marble');
    expect(themes).not.toContain('theme_midnight_gold'); // season-only
    const banners = purchasableCosmetics('profile_banner').map((c) => c.id);
    expect(banners).toContain('banner_laurel');
    expect(banners).not.toContain('banner_gilded'); // season-only
  });

  it('gates priced cosmetics behind their unlock token', () => {
    expect(isCosmeticAvailable('theme_dusk', [])).toBe(false);
    expect(isCosmeticAvailable('theme_dusk', ['cosmetic:theme_dusk'])).toBe(true);
  });
});
