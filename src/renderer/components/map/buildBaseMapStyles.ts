/**
 * Map Style Builder
 *
 * Exports the CARTO GL style URLs for dark and light themes, and a helper
 * that returns the URL for a given theme.
 */

export type MapTheme = 'dark' | 'light';

export const MAP_STYLES: Record<MapTheme, string> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
};

export function buildBaseMapStyle(theme: MapTheme): string {
  return MAP_STYLES[theme];
}
