/**
 * Route Store
 *
 * Zustand store for managing waypoints, routes, playback state, and the
 * single-location editing flow (pending/applied coordinates).
 */

import { create } from 'zustand';
import type { Waypoint, Coordinate, PlaybackState, TravelMode } from '@shared/types/index.js';

/**
 * How map clicks/drags are interpreted.
 */
export type MapInteractionMode =
  | 'navigate'
  | 'select-location'
  | 'draw-route';

export interface SavedRoute {
  id: string;
  name: string;
  createdAt: number;
  travelMode: TravelMode;
  waypoints: Waypoint[];
  roadRouteGeometry: [number, number][] | null;
  roadRouteDistanceMeters: number | null;
  roadRouteDurationSeconds: number | null;
}

interface RouteState {
  /** Current waypoints (user-placed or imported) */
  waypoints: Waypoint[];
  /** Active playback session ID */
  activePlaybackId: string | null;
  /** Current playback state (updated from main process) */
  playbackState: PlaybackState | null;
  /** Playback speed in meters per second */
  speedMetersPerSecond: number;
  /** Whether to loop playback */
  loop: boolean;

  /** How map clicks are interpreted */
  mapInteractionMode: MapInteractionMode;
  /** Coordinate being edited (from map click/drag or manual entry), not yet injected */
  pendingCoordinate: Coordinate | null;
  /** Last coordinate successfully injected into the selected device */
  lastAppliedCoordinate: Coordinate | null;
  /** Readable error from the last location operation */
  locationError: string | null;

  /**
   * Road-following route geometry through the current waypoints, as
   * [longitude, latitude] pairs — resolved via `route:getDirections`.
   * `null` until at least two waypoints exist and a route has resolved;
   * the map falls back to a straight-line preview until then.
   */
  roadRouteGeometry: [number, number][] | null;
  /** Total distance of `roadRouteGeometry`, in meters. */
  roadRouteDistanceMeters: number | null;
  /** Estimated travel time for `roadRouteGeometry`, in seconds. */
  roadRouteDurationSeconds: number | null;
  /** Travel mode used for route creation — drives the routing profile. */
  travelMode: TravelMode;
  /** Car simulation speed in mph (user-selectable, default 30). */
  carSpeedMph: number;
  /** Routes saved locally by the user. */
  savedRoutes: SavedRoute[];
  /** Saved route currently opened for simulation/editing, if any. */
  openedSavedRouteName: string | null;

  /** Whether a simulation is currently running (marker animating along route). */
  isSimulating: boolean;
  /** Current interpolated position of the simulation marker. */
  simulationCoordinate: Coordinate | null;
}

interface RouteActions {
  /** Add a waypoint at the end (ID/index assigned automatically) */
  addWaypoint: (coordinate: Coordinate & { name?: string }) => void;
  /** Remove a waypoint by index */
  removeWaypoint: (index: number) => void;
  /** Update a waypoint at index */
  updateWaypoint: (index: number, waypoint: Partial<Waypoint>) => void;
  /**
   * Update a waypoint by ID rather than index — safer for updates that
   * resolve asynchronously (e.g. reverse geocoding), since the waypoint's
   * index can shift while the request is in flight.
   */
  updateWaypointById: (id: string, waypoint: Partial<Waypoint>) => void;
  /** Clear all waypoints */
  clearWaypoints: () => void;
  /**
   * Fetch (or refresh) the road-following route through the current
   * waypoints. Best-effort: on failure, leaves the previous geometry in
   * place rather than clearing it — a transient network hiccup shouldn't
   * blank out an already-resolved route.
   */
  fetchRoadRoute: () => Promise<void>;
  /** Change the travel mode used for route creation and re-fetch the route. */
  setTravelMode: (mode: TravelMode) => void;
  /** Set car simulation speed in mph. Only affects simulation when travelMode is car. */
  setCarSpeedMph: (mph: number) => void;
  /** Save the current in-progress route locally. */
  saveCurrentRoute: (name: string) => boolean;
  /** Load saved routes from local storage. */
  loadSavedRoutes: () => void;
  /** Delete a saved route by ID. */
  deleteSavedRoute: (routeId: string) => void;
  /** Load a saved route into the route-creation banner for simulation. */
  openSavedRoute: (routeId: string) => void;
  /** Replace all waypoints (e.g., from GPX import) */
  setWaypoints: (waypoints: Waypoint[]) => void;
  /** Reorder waypoints (drag and drop) */
  reorderWaypoints: (fromIndex: number, toIndex: number) => void;
  /** Set playback speed */
  setSpeed: (speedMetersPerSecond: number) => void;
  /** Toggle loop mode */
  setLoop: (loop: boolean) => void;
  /** Set active playback ID */
  setActivePlayback: (playbackId: string | null) => void;
  /** Update playback state from main process */
  updatePlaybackState: (state: PlaybackState | null) => void;
  /** Start playback on selected device */
  startPlayback: (deviceId: string) => Promise<void>;
  /** Stop current playback */
  stopPlayback: (deviceId: string) => Promise<void>;

  /** Change how map clicks are interpreted */
  setMapInteractionMode: (mode: MapInteractionMode) => void;
  /** Set/replace the pending (not yet injected) coordinate */
  setPendingCoordinate: (coordinate: Coordinate | null) => void;
  /** Clear the location error */
  clearLocationError: () => void;
  /**
   * Inject a coordinate into a device.
   * On success stores the coordinate as actually applied by the backend.
   * Returns true on success; on failure stores a readable error.
   */
  setLocation: (deviceId: string, coordinate: Coordinate) => Promise<boolean>;
  /** Reset the device to its real location. Returns true on success. */
  resetLocation: (deviceId: string) => Promise<boolean>;

  /** Start the route simulation (marker animates along roadRouteGeometry). */
  startSimulation: () => void;
  /** Stop the route simulation. */
  stopSimulation: () => void;
  /** Update the current simulated marker position (called from animation loop). */
  setSimulationCoordinate: (coord: Coordinate | null) => void;
}

/** Default walking speed: ~1.4 m/s (~5 km/h) */
const DEFAULT_SPEED = 1.4;
const SAVED_ROUTES_STORAGE_KEY = 'location-simulator:saved-routes:v1';

/** Assigns sequential indexes after any list mutation. */
const reindex = (waypoints: Waypoint[]): Waypoint[] => waypoints.map((wp, index) => ({ ...wp, index }));

let waypointCounter = 0;
const nextWaypointId = (): string => {
  waypointCounter += 1;
  return `wp-${Date.now()}-${waypointCounter}`;
};

let savedRouteCounter = 0;
const nextSavedRouteId = (): string => {
  savedRouteCounter += 1;
  return `route-${Date.now()}-${savedRouteCounter}`;
};

const cloneWaypoints = (waypoints: Waypoint[]): Waypoint[] => waypoints.map((wp) => ({ ...wp }));

const cloneRouteGeometry = (geometry: [number, number][] | null): [number, number][] | null =>
  geometry ? geometry.map(([lng, lat]) => [lng, lat] as [number, number]) : null;

const parseSavedRoutes = (raw: string): SavedRoute[] => {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];

  const result: SavedRoute[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const route = item as Partial<SavedRoute>;
    if (
      typeof route.id === 'string' &&
      typeof route.name === 'string' &&
      typeof route.createdAt === 'number' &&
      typeof route.travelMode === 'string' &&
      Array.isArray(route.waypoints)
    ) {
      result.push({
        id: route.id,
        name: route.name,
        createdAt: route.createdAt,
        travelMode: route.travelMode as TravelMode,
        waypoints: reindex(cloneWaypoints(route.waypoints as Waypoint[])),
        roadRouteGeometry: cloneRouteGeometry(route.roadRouteGeometry ?? null),
        roadRouteDistanceMeters:
          typeof route.roadRouteDistanceMeters === 'number' ? route.roadRouteDistanceMeters : null,
        roadRouteDurationSeconds:
          typeof route.roadRouteDurationSeconds === 'number' ? route.roadRouteDurationSeconds : null,
      });
    }
  }

  return result;
};

const persistSavedRoutes = (routes: SavedRoute[]): void => {
  localStorage.setItem(SAVED_ROUTES_STORAGE_KEY, JSON.stringify(routes));
};

export const useRouteStore = create<RouteState & RouteActions>((set, get) => ({
  waypoints: [],
  activePlaybackId: null,
  playbackState: null,
  speedMetersPerSecond: DEFAULT_SPEED,
  loop: false,

  mapInteractionMode: 'select-location',
  pendingCoordinate: null,
  lastAppliedCoordinate: null,
  locationError: null,
  roadRouteGeometry: null,
  roadRouteDistanceMeters: null,
  roadRouteDurationSeconds: null,
  travelMode: 'car',
  carSpeedMph: 30,
  savedRoutes: [],
  openedSavedRouteName: null,
  isSimulating: false,
  simulationCoordinate: null,

  addWaypoint: (coordinate) =>
    set((state) => ({
      waypoints: [
        ...state.waypoints,
        { ...coordinate, id: nextWaypointId(), index: state.waypoints.length },
      ],
    })),

  removeWaypoint: (index) =>
    set((state) => ({
      waypoints: reindex(state.waypoints.filter((_, i) => i !== index)),
    })),

  updateWaypoint: (index, updates) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp, i) =>
        i === index ? { ...wp, ...updates } : wp
      ),
    })),

  updateWaypointById: (id, updates) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) => (wp.id === id ? { ...wp, ...updates } : wp)),
    })),

  clearWaypoints: () =>
    set({
      waypoints: [],
      activePlaybackId: null,
      playbackState: null,
      roadRouteGeometry: null,
      roadRouteDistanceMeters: null,
      roadRouteDurationSeconds: null,
      openedSavedRouteName: null,
      isSimulating: false,
      simulationCoordinate: null,
    }),

  fetchRoadRoute: async () => {
    const { waypoints, travelMode } = get();
    if (waypoints.length < 2) {
      set({ roadRouteGeometry: null, roadRouteDistanceMeters: null, roadRouteDurationSeconds: null });
      return;
    }
    try {
      const response = await window.api.getDirections({
        coordinates: waypoints.map((wp) => ({
          latitude: wp.latitude,
          longitude: wp.longitude,
        })),
        travelMode,
      });
      if (response.success && response.geometry) {
        set({
          roadRouteGeometry: response.geometry,
          roadRouteDistanceMeters: response.distanceMeters ?? null,
          roadRouteDurationSeconds: response.durationSeconds ?? null,
        });
      }
    } catch {
      // Best-effort — the straight-line fallback stays visible.
    }
  },

  setTravelMode: (travelMode) => {
    set({ travelMode });
    void get().fetchRoadRoute();
  },

  setCarSpeedMph: (carSpeedMph) => set({ carSpeedMph }),

  saveCurrentRoute: (name) => {
    const state = get();
    const trimmedName = name.trim();
    if (!trimmedName) {
      set({ locationError: 'Please enter a route name.' });
      return false;
    }
    if (state.waypoints.length < 2) {
      set({ locationError: 'Add at least two points before saving a route.' });
      return false;
    }

    const newRoute: SavedRoute = {
      id: nextSavedRouteId(),
      name: trimmedName,
      createdAt: Date.now(),
      travelMode: state.travelMode,
      waypoints: reindex(cloneWaypoints(state.waypoints)),
      roadRouteGeometry: cloneRouteGeometry(state.roadRouteGeometry),
      roadRouteDistanceMeters: state.roadRouteDistanceMeters,
      roadRouteDurationSeconds: state.roadRouteDurationSeconds,
    };
    const updatedRoutes = [newRoute, ...state.savedRoutes];

    try {
      persistSavedRoutes(updatedRoutes);
      set({ savedRoutes: updatedRoutes, locationError: null });
      return true;
    } catch (error) {
      console.error('[RouteStore] Failed to save route:', error);
      set({ locationError: 'Failed to save route locally.' });
      return false;
    }
  },

  loadSavedRoutes: () => {
    try {
      const raw = localStorage.getItem(SAVED_ROUTES_STORAGE_KEY);
      if (!raw) {
        set({ savedRoutes: [] });
        return;
      }
      const routes = parseSavedRoutes(raw);
      set({ savedRoutes: routes, locationError: null });
    } catch (error) {
      console.error('[RouteStore] Failed to load saved routes:', error);
      set({ savedRoutes: [], locationError: 'Failed to load saved routes.' });
    }
  },

  deleteSavedRoute: (routeId) => {
    const { savedRoutes } = get();
    const updatedRoutes = savedRoutes.filter((route) => route.id !== routeId);
    if (updatedRoutes.length === savedRoutes.length) return;

    try {
      persistSavedRoutes(updatedRoutes);
      set({ savedRoutes: updatedRoutes, locationError: null });
    } catch (error) {
      console.error('[RouteStore] Failed to delete saved route:', error);
      set({ locationError: 'Failed to delete saved route.' });
    }
  },

  openSavedRoute: (routeId) => {
    const route = get().savedRoutes.find((saved) => saved.id === routeId);
    if (!route) {
      set({ locationError: 'Saved route not found.' });
      return;
    }

    set({
      waypoints: reindex(cloneWaypoints(route.waypoints)),
      travelMode: route.travelMode,
      roadRouteGeometry: cloneRouteGeometry(route.roadRouteGeometry),
      roadRouteDistanceMeters: route.roadRouteDistanceMeters,
      roadRouteDurationSeconds: route.roadRouteDurationSeconds,
      openedSavedRouteName: route.name,
      mapInteractionMode: 'draw-route',
      isSimulating: false,
      simulationCoordinate: null,
      locationError: null,
    });

    if (!route.roadRouteGeometry || route.roadRouteGeometry.length < 2) {
      void get().fetchRoadRoute();
    }
  },

  setWaypoints: (waypoints) => set({ waypoints: reindex(waypoints) }),

  reorderWaypoints: (fromIndex, toIndex) =>
    set((state) => {
      const waypoints = [...state.waypoints];
      const [removed] = waypoints.splice(fromIndex, 1);
      if (removed) {
        waypoints.splice(toIndex, 0, removed);
      }
      return { waypoints: reindex(waypoints) };
    }),

  setSpeed: (speedMetersPerSecond) => set({ speedMetersPerSecond }),

  setLoop: (loop) => set({ loop }),

  setActivePlayback: (playbackId) => set({ activePlaybackId: playbackId }),

  updatePlaybackState: (playbackState) => set({ playbackState }),

  startPlayback: async (deviceId) => {
    const { waypoints, speedMetersPerSecond, loop } = get();
    if (waypoints.length < 2) {
      set({ locationError: 'The route contains fewer than two valid points.' });
      return;
    }

    const response = await window.api.startRoute({
      deviceId,
      waypoints,
      speedMetersPerSecond,
      loop,
    });

    if (response.success && response.playbackId) {
      set({ activePlaybackId: response.playbackId });
    }
  },

  stopPlayback: async (deviceId) => {
    await window.api.stopRoute({ deviceId });
    set({ activePlaybackId: null, playbackState: null });
  },

  setMapInteractionMode: (mapInteractionMode) => set({ mapInteractionMode }),

  setPendingCoordinate: (pendingCoordinate) => set({ pendingCoordinate }),

  clearLocationError: () => set({ locationError: null }),

  startSimulation: () => set({ isSimulating: true, simulationCoordinate: null }),

  stopSimulation: () => set({ isSimulating: false }),

  setSimulationCoordinate: (simulationCoordinate) => set({ simulationCoordinate }),

  setLocation: async (deviceId, coordinate) => {
    try {
      const response = await window.api.setLocation({ deviceId, coordinate });
      if (response.success) {
        set({
          lastAppliedCoordinate: response.coordinate ?? coordinate,
          locationError: null,
        });
        return true;
      }
      set({ locationError: response.error?.message ?? 'Failed to set location.' });
      return false;
    } catch (error) {
      set({
        locationError: error instanceof Error ? error.message : 'Failed to set location.',
      });
      return false;
    }
  },

  resetLocation: async (deviceId) => {
    try {
      const response = await window.api.resetLocation({ deviceId });
      if (response.success) {
        set({ lastAppliedCoordinate: null, locationError: null });
        return true;
      }
      set({ locationError: response.error?.message ?? 'Failed to reset location.' });
      return false;
    } catch (error) {
      set({
        locationError: error instanceof Error ? error.message : 'Failed to reset location.',
      });
      return false;
    }
  },
}));
