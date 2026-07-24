/**
 * Map UI Store
 *
 * Zustand store for the main-screen shell: which primary-rail section is
 * active and whether its drawer is open, plus the map colour theme
 * (dark / light) which is persisted in localStorage. Target selection stays
 * in `deviceStore`; route and playback state stay in `routeStore`. No timers
 * live here — this is pure UI state.
 */

import { create } from 'zustand';
import type { MapTheme } from '@/components/map/buildBaseMapStyles.js';

export type NavSection = 'simulators' | 'devices' | 'browsers' | 'routes' | null;

const MAP_THEME_KEY = 'locationSimulator.mapTheme';

function loadPersistedTheme(): MapTheme {
  let theme: MapTheme = 'dark';
  try {
    const stored = localStorage.getItem(MAP_THEME_KEY);
    if (stored === 'dark' || stored === 'light') theme = stored;
  } catch {
    // localStorage unavailable
  }
  // Apply immediately so HeroUI renders correctly from the very first paint.
  document.documentElement.classList.toggle('dark', theme === 'dark');
  return theme;
}

interface MapUiState {
  /** Which primary-rail section is currently active */
  activeSection: NavSection;
  /** Whether the secondary drawer is open */
  isDrawerOpen: boolean;
  /** Base map colour theme — persisted across sessions */
  mapTheme: MapTheme;
}

interface MapUiActions {
  /**
   * Select a rail section. Selecting the already-active section again
   * collapses the drawer instead of reopening it (matches the primary
   * rail's click-to-toggle behavior).
   */
  selectSection: (section: Exclude<NavSection, null>) => void;
  /** Close the drawer without forgetting which section was active. */
  closeDrawer: () => void;
  /** Toggle the base map between dark and light themes. */
  toggleMapTheme: () => void;
}

export const useMapUiStore = create<MapUiState & MapUiActions>((set, get) => ({
  activeSection: null,
  isDrawerOpen: false,
  mapTheme: loadPersistedTheme(),

  selectSection: (section) => {
    const { activeSection, isDrawerOpen } = get();
    if (activeSection === section && isDrawerOpen) {
      set({ isDrawerOpen: false });
      return;
    }
    set({ activeSection: section, isDrawerOpen: true });
  },

  closeDrawer: () => set({ isDrawerOpen: false }),

  toggleMapTheme: () => {
    const next: MapTheme = get().mapTheme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(MAP_THEME_KEY, next); } catch { /* ignore */ }
    // Drives HeroUI's dark/light mode via the <html> class.
    document.documentElement.classList.toggle('dark', next === 'dark');
    set({ mapTheme: next });
  },
}));
