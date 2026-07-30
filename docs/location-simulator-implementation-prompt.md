# Signl — Implementation Prompt

> **Status note:** this is the working spec used to build the app (originally under the name "LocationSimulator", now shipping as **Signl**). Stage 1 is done; parts of Stages 2 and 7 are also done, ahead of the original sequencing. Everything else below Stage 1 is still an accurate *plan*, not a description of what exists — read the status callouts inline, and see [README.md](../README.md) for the authoritative current state and [CLAUDE.md](../CLAUDE.md) for repo-navigation guidance. This file is kept as a real spec to keep implementing against, not a historical snapshot.

You are working on an existing Electron desktop application called **Signl**.

The application simulates GPS locations across:

- iOS Simulators
- Android Emulators
- Physical iOS devices
- Physical Android devices
- Embedded Chromium browser (this app's own window)
- External Chromium browsers through CDP

Do not rewrite the existing architecture. Extend the current main-process backends, typed IPC contract, preload bridge, Zustand stores, MapLibre UI, and route playback design.

Do not write automated tests at this stage. Focus on implementation, type safety, error handling, build success, and manual verification.

---

## Existing architecture

The application uses:

- Electron
- Vite (`electron-vite`)
- React 19
- TypeScript (`tsgo`)
- Zustand
- MapLibre GL JS
- Tailwind CSS v4
- HeroUI (react-aria based — **not** shadcn/ui, despite what earlier drafts of this document said)

`@turf/turf` is listed as a dependency but is **not used anywhere in `src/`**. Every route-math need that's actually been implemented so far (see `src/renderer/components/map/geoMath.ts` and `src/main/backends/browserExternal/playbackMath.ts`) uses hand-rolled haversine/equirectangular-projection math instead. If you build the Stage 3 playback manager, either follow that existing precedent or make a deliberate, explained decision to introduce Turf — don't add it silently just because it's in `package.json`.

The architecture is divided into:

```text
Main process
  ├── Device discovery                 src/main/devices/discovery.ts
  ├── Platform-specific device backends src/main/backends/*
  ├── Native CLI and device communication (inside each backend)
  ├── Route playback engine            NOT YET CENTRALIZED — see Stage 3 status below
  └── IPC handlers                     src/main/ipc/handlers.ts + src/main/ipc/handlers/*

Preload process
  └── Typed contextBridge API          src/preload/index.ts → window.api

Renderer process
  ├── Primary nav rail + drawers       src/renderer/components/PrimaryNavigationRail.tsx, drawers/*
  ├── MapLibre map + map-init hooks    src/renderer/screens/MainScreen.tsx, components/map/*
  ├── Location editor                  src/renderer/components/LocationEditor.tsx
  ├── Route drawing/playback banner    src/renderer/components/RouteInstructionBanner.tsx
  └── Zustand stores                   src/renderer/state/{deviceStore,routeStore,mapUiStore}.ts
```

Follow these architectural rules:

1. Keep all native device communication in the Electron main process.
2. Keep route playback timing and interpolation in the main process (see the Stage 3 status note — this rule describes the target design; today's real playback for every backend, browsers included, runs client-side in the renderer instead, which is exactly what this rule says not to do long-term).
3. Send location and playback updates to the renderer through IPC push events.
4. Define all IPC channels and payloads in `src/shared/types/ipc.ts`.
5. Keep platform-specific behavior inside device backend modules.
6. Never invoke `simctl`, `adb`, `idevicelocation`, CDP, or native commands directly from the renderer.
7. Preserve the existing `DeviceBackend` abstraction.
8. Reuse MapLibre; do not add Turf.js without checking the note above first.
9. Do not add automated test code for this implementation.
10. Do not claim physical-device support works unless it has been implemented and manually verified. (Physical iOS location control specifically has a real, unavoidable limitation on iOS 17+ — see `SETUP.md`.)

---

# Feature objective

## Location Injection

Implement:

- Set a single GPS coordinate — ✅ done (`LocationEditor.tsx`, `location:set`)
- Change location manually — ✅ done
- Latitude and longitude — ✅ done
- Altitude, Speed, Heading, Horizontal accuracy — ✅ fields exist end-to-end, but only actually applied on backends whose `DeviceCapabilities` report support (currently none of the real backends support any of these four — iOS Simulator and physical iOS devices only take lat/lng, browsers only take lat/lng/accuracy)
- Lat/Lng text input — 🟡 partial: paste/copy of `"lat, lng"` and simple JSON exists in `LocationEditor.tsx`; the fuller multi-format parser in section 12 below is not built
- GeoJSON import — ❌ not implemented
- GPX import — ❌ mocked (`gpx:import` returns hardcoded waypoints regardless of the file)
- CSV import — ❌ not implemented
- Reset simulated location — ✅ done (`location:reset`)

## Route Simulation

Implement:

- Walking / Running / Cycling / Driving simulation — 🟡 partial: travel-mode selector and per-mode speed exist (`TravelMode`, `DEFAULT_TRAVEL_SPEEDS_MPS`), and it drives the renderer's own client-side simulation loop for every backend (including browsers — see the correction in section 4, the browser backend's own real playback implementation is currently unreachable); it does **not** drive a central main-process manager (see Stage 3)
- Recorded GPS-track replay — ❌ not implemented
- Start, pause, resume, stop, and restart — 🟡 partial: start/stop exist; pause/resume/restart do not
- Continuous route looping — ❌ not implemented
- Jump to any route position — ❌ not implemented
- Playback multipliers such as 0.5x, 1x, 2x, 5x, and 10x — ❌ not implemented (car speed has fixed mph presets instead, which is a different, narrower thing)
- Live progress updates — 🟡 partial: the renderer's local simulation updates its own marker every frame; the `location:progress` push event described in section 18 is defined but never actually emitted by the main process

---

# 1. Shared location types — ✅ done

`src/shared/types/device.ts` already has all of this. Nothing to do here unless you're extending it further.

```ts
export interface Coordinate {
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp?: number;
}
```

Use `latitude` and `longitude` consistently across the application. Platform backends may translate these names internally when required.

```ts
export interface Waypoint extends Coordinate {
  id: string;
  index: number;
  name?: string;
  sourceTimestamp?: number;
  distanceFromPreviousMeters?: number;
  cumulativeDistanceMeters?: number;
}
```

```ts
export type RouteSourceFormat =
  | 'manual'
  | 'latlng'
  | 'geojson'
  | 'gpx'
  | 'csv';
```

```ts
export interface Route {
  id: string;
  name: string;
  sourceFormat: RouteSourceFormat;
  waypoints: Waypoint[];
  totalDistanceMeters: number;
  estimatedDurationMs?: number;
  hasRecordedTimestamps: boolean;
}
```

```ts
export type TravelMode = 'walk' | 'run' | 'bike' | 'car';

export const DEFAULT_TRAVEL_SPEEDS_MPS: Record<TravelMode, number> = {
  walk: 1.4,
  run: 3,
  bike: 5.5,
  car: 13.9,
};

export type PlaybackMultiplier = 0.5 | 1 | 2 | 5 | 10;
```

`Route` and `PlaybackMultiplier` exist in the types file but aren't threaded through the rest of the app yet — `routeStore.ts` tracks waypoints directly rather than wrapping them in a `Route`, and nothing currently reads `PlaybackMultiplier`.

---

# 2. Device capabilities — ✅ done

`DeviceCapabilities` already exists in `src/shared/types/device.ts` and every real backend (`iosSimulator.ts`, `iosDevice.ts`, `browserExternal/catalogue.ts`) reports honest values — the two stub backends (`androidEmulator.ts`, `androidDevice.ts`) report `noCapabilities()`.

```ts
export interface DeviceCapabilities {
  setLocation: boolean;
  resetLocation: boolean;
  routePlayback: boolean;
  pauseRoute: boolean;
  altitude: boolean;
  speed: boolean;
  heading: boolean;
  accuracy: boolean;
}
```

The renderer already uses capabilities to disable unsupported controls (see `LocationEditor.tsx`'s per-field `isDisabled` checks and `TargetList.tsx`'s "No location"/"No routes" subtitle). Keep following that pattern for anything new.

---

# 3. Backend interface — ✅ done, broader than originally spec'd

`src/main/backends/types.ts` already has a `DeviceBackend` interface, and it's larger than the one originally proposed here — it also includes `getCapabilities()` and the route-playback lifecycle methods directly on each backend, rather than only at an orchestration layer:

```ts
interface DeviceBackend {
  name: string;
  getCapabilities(): DeviceCapabilities;
  listDevices(): Promise<Device[]>;
  setLocation(deviceId: string, coordinate: Coordinate): Promise<Coordinate>;
  startRoute(
    deviceId: string,
    options: StartRouteOptions,
    onProgress: RouteProgressCallback,
    onComplete: PlaybackCompleteCallback,
  ): Promise<string>;
  stopRoute(deviceId: string, playbackId: string): Promise<void>;
  reset(deviceId: string): Promise<void>;
}
```

This is a real, deliberate divergence from the "thin backend, smart central manager" design originally proposed below — `browserExternal/index.ts` implements a real backend-owned playback loop (a `setInterval` tick that calls `applyGeolocationToAllPages` and reports progress via the callbacks). **But nothing in the app currently calls it** — see the correction in section 4 below; it's fully-written dead code today, not a working alternate path. If you build the Stage 3 central manager, decide explicitly whether it *replaces* each backend's own `startRoute`/`stopRoute` (which would mean finally wiring `location:startRoute` to call `backend.startRoute()`, making `browserExternal`'s implementation live), or *drives* them by calling `setLocation` repeatedly (which is what the renderer's own simulation loop already does today, client-side, for every backend — see `useRouteSimulation.ts`). Don't build both patterns for the same backend.

```text
RoutePlaybackManager (proposed, not built)
    ↓ produces normalized Coordinate updates
DeviceBackend.setLocation()
    ↓ translates the coordinate for the platform
Target device
```

---

# 4. Central playback manager — ❌ not built

**Current status:** there is no `src/main/playback/` directory and no central playback manager. There are, in fact, **three** separate route-playback code paths in this codebase, and only **one** of them is what actually runs when you click Simulate, for any backend:

1. **The genuinely mocked, unreachable IPC layer.** `location:startRoute`/`location:stopRoute` (`src/main/ipc/handlers/location.ts`) return a fake `playbackId` and a hardcoded stop position — and critically, **they never call `backend.startRoute()`/`backend.stopRoute()` at all**, for any device kind. `routeStore.ts`'s `startPlayback()`/`stopPlayback()` (lines ~413-435) call exactly these mocked channels — but **no component in the renderer calls `startPlayback()`**. It's dead code, wired to nothing. If you go looking for "the Simulate button's handler" here, you won't find it — this is the wrong trail.
2. **A real but currently unreachable backend implementation, for browsers only.** `src/main/backends/browserExternal/index.ts`'s `startRoute` is a fully-working `setInterval` tick that calls `applyGeolocationToAllPages` and reports progress via `onProgress`/`onComplete` — genuinely good code. But since nothing in path 1 ever calls it, and nothing else calls it either, **it never runs in the shipped app today**. `iosSimulatorBackend.startRoute()`, by contrast, is an honest `throw new NotSupportedError(...)` stub — different reason for not working (not built vs. built-but-disconnected), same practical result.
3. **The one path that's actually live**, for every backend without exception, browsers included: the "Simulate" button in `RouteInstructionBanner.tsx` calls `routeStore.ts`'s `startSimulation()`, which does nothing but flip `isSimulating: true` — no IPC call at all. `src/renderer/components/map/useRouteSimulation.ts` watches that flag and runs a `requestAnimationFrame` loop **in the renderer**: each frame it interpolates a position along `roadRouteGeometry`, moves the on-map marker, and — throttled to every 500ms — calls the real `setLocation()` store action (the same one the single-location editor uses), which hits the real `location:set` channel and really applies the location on whichever backend is selected (`xcrun simctl location <udid> set <lat>,<lng>` for iOS Simulator, a CDP geolocation override for browsers, etc.).

Path 3 is why route playback visibly *works* today for every implemented backend, iOS Simulator and browsers alike, despite paths 1 and 2 both being non-functional (mocked or unreachable) — it's a different, unrelated code path that repeatedly calls the *single-location* API fast enough to look like route playback. It has no pause/resume/loop/jump, stops if you navigate away, and puts timing in the renderer instead of the main process — exactly the anti-pattern rule 2 above warns against. There is currently no backend for which route playback is actually backend-owned in the running app, even though `browserExternal` has the code for it.

If you build the central manager, the sections below (4–8) are still the intended design — implement them as originally specified, and make sure you're replacing *all three* paths above, not just the obviously-mocked one, or you'll fix the IPC layer while path 3 keeps quietly doing the real work client-side. Wiring path 1 to actually call `backend.startRoute()` would make `browserExternal`'s existing implementation live with comparatively little new code — that's probably the cheapest first step if you want to make partial progress before building the full manager.

Create:

```text
src/main/playback/RoutePlaybackManager.ts
src/main/playback/types.ts
```

The playback manager owns active sessions:

```ts
private readonly sessions = new Map<string, PlaybackSession>();
```

Use:

```ts
export type PlaybackStatus =
  | 'idle'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'error';
```

Suggested session model:

```ts
interface PlaybackSession {
  playbackId: string;
  deviceId: string;
  route: Route;
  status: PlaybackStatus;
  travelMode: TravelMode;
  baseSpeedMps: number;
  playbackMultiplier: number;
  loop: boolean;
  timingMode: RouteTimingMode;
  updateIntervalMs: number;
  currentDistanceMeters: number;
  currentWaypointIndex: number;
  startedAtMonotonicMs?: number;
  accumulatedElapsedMs: number;
  timer?: NodeJS.Timeout;
}
```

The manager must support:

- Start, Pause, Resume, Stop, Restart
- Loop on/off
- Change playback multiplier
- Change base speed
- Jump to waypoint / progress percentage / route distance / recorded timestamp
- Read current playback state

---

# 5. Playback timing and drift — design not yet applied

**Current status:** the one loop that actually runs (the renderer's `requestAnimationFrame` loop — see the correction in section 4; the browser backend's own `setInterval` loop is real code but currently unreachable) already computes distance from elapsed time rather than accumulating per-tick, so the core anti-drift idea below is already followed where playback exists. What's missing is the monotonic-clock discipline and the central manager to own it.

Playback runs in the main process.

Continue using a timer, but do not advance progress by assuming each callback fires exactly on time.

Use a monotonic clock such as `performance.now()` or `process.hrtime.bigint()`.

Calculate distance from actual elapsed time:

```text
elapsed simulation time × base speed × playback multiplier = expected distance along route
```

Do not use an accumulating calculation such as:

```ts
currentDistance += speed * (intervalMs / 1000);
```

The timer controls update frequency only.

```ts
const DEFAULT_LOCATION_UPDATE_INTERVAL_MS = 1000;
```

Allow configuration where useful.

---

# 6. Smooth route interpolation — done, but not with Turf

**Current status:** the interpolation math this section describes is implemented twice already — `src/renderer/components/map/geoMath.ts` (`distanceBetween`, `interpolateAlongRoute`) and `src/main/backends/browserExternal/playbackMath.ts` (`totalRouteMeters`, `interpolatePosition`) — both hand-rolled, neither using Turf.js. If you centralize this in Stage 3/4, prefer consolidating those two into one shared module over introducing a new dependency; only reach for Turf if you have a concrete need the existing math can't cover (e.g. polygon operations), and say so explicitly.

The original Turf-based plan, for reference:

- Segment distance, cumulative distance, total route distance, position along a line, bearing, nearest route position when jumping.
- Do not jump only between original waypoints.

```ts
const routeLine = turf.lineString(
  waypoints.map(point => [point.longitude, point.latitude]),
);
```

Keep unit conversions explicit:

```text
Turf distance: often kilometers
Application distance: meters
Speed: meters per second
Time: milliseconds
```

Interpolated coordinates may contain `{ latitude, longitude, altitude, speed, heading, accuracy, timestamp }`.

Rules:

- Derive heading from route direction when missing.
- Normalize heading to `0–360`.
- Interpolate altitude when both adjacent points have altitude.
- Preserve or interpolate accuracy where practical.
- Preserve the last valid heading at route completion.

---

# 7. Travel speed and playback multiplier — partially done

**Current status:** travel mode + per-mode base speed exist and work (`TravelMode`, `DEFAULT_TRAVEL_SPEEDS_MPS`, plus a car-specific mph preset selector in `RouteInstructionBanner.tsx`). The separate "playback multiplier" concept (0.5x/1x/2x/5x/10x layered on top of travel speed) does not exist.

Keep these concepts separate:

```text
Travel speed: 1.4 m/s
Playback multiplier: 5x
Effective speed: 7 m/s
```

```ts
effectiveSpeedMps = baseSpeedMps * playbackMultiplier;
```

UI presets: `0.5x`, `1x`, `2x`, `5x`, `10x`. Internally allow any finite positive multiplier.

When speed or multiplier changes during playback:

1. Preserve the current position.
2. Preserve accumulated elapsed playback.
3. Rebase the playback clock.
4. Continue without an unexpected jump.

---

# 8. Recorded GPS track replay — ❌ not implemented

GPX and CSV routes may contain timestamps.

```ts
export type RouteTimingMode =
  | 'constant-speed'
  | 'recorded-timestamps';
```

## Constant-speed mode

Use: selected travel mode, optional custom speed, playback multiplier.

## Recorded-timestamps mode

Use relative source timestamps.

Requirements:

- Normalize the first timestamp to playback time zero.
- Preserve relative timing; apply the playback multiplier.
- Derive speed when speed is absent; preserve altitude.
- Support pause and resume; support jumping by timestamp.
- Detect invalid or backward timestamps.

```ts
interface RecordedTrackOptions {
  compressInactiveGaps: boolean;
  maximumInactiveGapMs?: number;
}
```

Example: compress a 45-minute recording gap to 30 seconds when configured.

---

# 9. Single-location editor — ✅ done

**Current status:** `src/renderer/components/LocationEditor.tsx` already exists and implements this section closely — required lat/lng, optional altitude/speed/heading/accuracy gated per-field on device capabilities, Apply/Reset/Copy/Paste/Use-Map-Selection/Re-send actions, and the same validation ranges listed below (delegated to `src/shared/coordinateValidation.ts`). Nothing to do here unless extending it.

Validation:

```text
Latitude: -90 to 90
Longitude: -180 to 180
Heading: 0 to 360
Speed: >= 0
Accuracy: >= 0
Altitude: any finite number
```

Do not invoke IPC when validation fails.

On Apply: confirm a device is selected → validate → invoke `location:set` → update the current map marker → store the last successfully injected coordinate → show readable backend errors.

---

# 10. Map interaction — ✅ done, different file layout than originally spec'd

**Current status:** there is no `MapCanvas.tsx`. The map lives in `src/renderer/screens/MainScreen.tsx` (a `MapArea` component), with initialization/marker/line logic split into hooks under `src/renderer/components/map/` (`useMapInitialization`, `useLocationMarkers`, `useWaypointMarkers`, `useRouteLines`, `useRouteSimulation`). `MapInteractionMode` exists in `routeStore.ts`, not as a separate export from the map component, with the same three modes below.

```ts
export type MapInteractionMode =
  | 'navigate'
  | 'select-location'
  | 'draw-route';
```

## Select-location mode — ✅ done

Clicking sets pending latitude/longitude; a draggable marker updates pending values on drag end (not on every drag event, matching the spec).

## Draw-route mode — 🟡 partial

Done: each click adds a waypoint; a route line renders (dashed preview, then a solid road-following line once Valhalla resolves it — see `useRouteLines.ts`); start/end get labeled pins.

Not done: waypoint selection, waypoint deletion, waypoint dragging on the map. `routeStore.ts` has `removeWaypoint`/`updateWaypoint`/`reorderWaypoints` actions ready to use, but nothing in the UI currently calls them — waypoints can only be added, never edited or removed, once a route is being drawn (only `clearWaypoints`, which discards the whole route, is wired up).

For large routes — not yet relevant at current route sizes, but keep in mind: render the line through a MapLibre GeoJSON source/layer (already done), don't create a React marker for every point (already done via `useWaypointMarkers.ts`), keep full route data for playback, show markers only for start/end/selected/actively-edited points.

---

# 11. Input formats — ❌ not implemented beyond basic paste

Create or extend:

```text
src/renderer/components/LocationImportDialog.tsx     (does not exist)
src/renderer/components/RouteImportExport.tsx         (does not exist)
src/renderer/components/CsvImportDialog.tsx            (does not exist)
```

Filesystem access and heavy parsing must occur in the main process.

```ts
export interface ParsedLocationData {
  sourceFormat: RouteSourceFormat;
  name?: string;
  coordinates: Coordinate[];
  route?: Route;
  warnings: string[];
}
```

Support: Lat/Lng text, GeoJSON, GPX, CSV.

---

# 12. Lat/Lng text parsing — 🟡 partial

**Current status:** `LocationEditor.tsx`'s Paste action already handles `"lat, lng"`, `"lat lng"`, and simple `{ latitude, longitude }` / `{ lat, lng }` JSON. It does not yet support the labeled `"lat: 42.36, lng: -71.06"` form, the extended JSON shape with altitude/speed/heading/accuracy, or a persisted coordinate-order preference.

Support:

```text
42.3601, -71.0589
42.3601 -71.0589
lat: 42.3601, lng: -71.0589
```

```json
{ "latitude": 42.3601, "longitude": -71.0589 }
```

```json
{ "lat": 42.3601, "lng": -71.0589, "altitude": 20, "speed": 1.4, "heading": 90, "accuracy": 5 }
```

Do not silently reverse ambiguous coordinates. Provide a coordinate-order selector (Latitude,Longitude vs Longitude,Latitude) and persist the last selection locally.

---

# 13. GeoJSON import — ❌ not implemented

Add typed IPC support for `geojson:import` / `geojson:parse` (neither channel exists yet — see the real channel list in section 17).

Support `Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Feature`, `FeatureCollection`.

Behavior: `Point` → location, `MultiPoint` → waypoint collection, `LineString` → route, `MultiLineString` → route segments. Read supported metadata from feature properties.

GeoJSON coordinate order is always `longitude, latitude, altitude`.

Recognize properties: `speed`, `heading`/`bearing`, `accuracy`/`horizontalAccuracy`, `timestamp`/`time`, `name`.

When multiple route candidates exist, allow the user to select one or combine compatible lines.

---

# 14. GPX import and export — ❌ mocked

**Current status:** `gpx:import`/`gpx:export` handlers exist (`src/main/ipc/handlers/gpx.ts`) but return hardcoded mock data regardless of input. `gpx-builder` is a listed dependency but is not imported anywhere in `src/`.

Support `<wpt>`, `<rte>`/`<rtept>`, `<trk>`/`<trkseg>`/`<trkpt>`, `<ele>`, `<time>`, route/track names, multiple track segments. Preserve segment boundaries; do not auto-connect unrelated segments without a warning.

```ts
interface GpxImportResponse {
  routes: Route[];
  standaloneWaypoints: Waypoint[];
  routeName?: string;
  warnings: string[];
}
```

Use a versioned channel such as `gpx:importV2` when changing the current response shape would cause unnecessary breakage — the current `GpxImportResponse` shape (see `src/shared/types/ipc.ts`) is flatter than the one above.

---

# 15. CSV import — ❌ not implemented

Add `csv:preview` / `csv:import` (neither exists yet).

Recognize aliases: `latitude`/`lat`, `longitude`/`longitude_deg`/`lon`/`lng`/`long`, `altitude`/`elevation`/`ele`, `speed`, `heading`/`bearing`/`course`, `accuracy`/`horizontalAccuracy`, `timestamp`/`time`/`recordedAt`, `name`/`label`.

Support comma/tab/semicolon separators, header rows, ISO timestamps, Unix seconds/milliseconds.

Preview must show: detected separator, detected headers, sample rows, detected coordinate columns, optional mappings, warnings. Allow manual column mapping when detection is uncertain. Do not place invalid CSV data into `routeStore`.

---

# 16. Route normalization — ❌ not implemented as a separate layer

Create:

```text
src/main/routes/normalizeRoute.ts
src/main/routes/routeMetrics.ts
src/main/routes/routeInterpolation.ts
```

(None of these exist. `routeStore.ts` does its own lightweight `reindex()` on mutation today; there's no validation/duplicate-detection/timestamp-checking layer.)

Normalize every imported or manually drawn route: validate coordinates, flag/remove invalid points, assign IDs/indexes, calculate segment/cumulative/total distances, detect recorded and backward timestamps, derive missing headings, detect consecutive duplicates, preserve useful source metadata.

Do not remove all repeated points automatically — repeated coordinates with different timestamps may represent stops/dwell time/traffic/stationary work. Only remove duplicates with no meaningful timing or metadata difference.

---

# 17. Typed IPC channels — real channel list differs from the original proposal

**Current status:** `src/shared/types/ipc.ts` has these channels today. Some proposed channels below were never added (playback lifecycle beyond start/stop, GeoJSON, CSV); several channels exist that weren't in the original plan at all (geocoding, directions, tool checking, browser connect/disconnect, system location).

**Actually implemented (`IpcInvokeChannel`):**

| Channel | Purpose |
|---|---|
| `devices:list` | Discover devices across all backends |
| `location:set` | Inject one location |
| `location:reset` | Reset simulation |
| `location:startRoute` / `location:stopRoute` | Start/stop playback (mocked for most backends — see status above) |
| `location:reverseGeocode` | Coordinate → short address, via Nominatim (not in the original plan) |
| `route:getDirections` | Road-following route through waypoints, via Valhalla (not in the original plan) |
| `gpx:import` / `gpx:export` | GPX file I/O (currently mocked) |
| `tools:check` / `tools:install` | CLI tool verification/installation (not in the original plan) |
| `system:getUserLocation` / `system:getHomeLocation` / `system:setHomeLocation` | Map-centering location (not in the original plan) |
| `browsers:connect` / `browsers:disconnect` | External browser CDP session lifecycle (not in the original plan) |

**Proposed but not built:** `location:pauseRoute`, `location:resumeRoute`, `location:restartRoute`, `location:jumpRoute`, `location:updatePlayback`, `location:getPlaybackState`, `location:parseText`, `geojson:import`, `csv:preview`, `csv:import`. If you build Stage 3/4/5, these are still reasonable channel names to use — check `src/shared/types/ipc.ts` first in case naming conventions have drifted since this was written.

Suggested request/jump models for the playback channels, if built:

```ts
export interface StartRouteRequest {
  deviceId: string;
  route: Route;
  travelMode: TravelMode;
  speedMps?: number;
  playbackMultiplier: number;
  loop: boolean;
  timingMode: RouteTimingMode;
  recordedTrackOptions?: RecordedTrackOptions;
  updateIntervalMs?: number;
}

export type RouteJumpPosition =
  | { type: 'waypoint'; waypointIndex: number }
  | { type: 'progress'; progress: number }
  | { type: 'distance'; distanceMeters: number }
  | { type: 'timestamp'; timestamp: number };
```

Use `0–1` internally for progress. Do not mix `0–1` and `0–100`. (The real `StartRouteRequest` in `ipc.ts` today is simpler than the one above — check it before assuming this shape.)

---

# 18. Playback events — defined but not emitted

**Current status:** `location:progress`, `location:playbackComplete`, and `devices:changed` are all declared in `IpcPushChannel` and exposed on `window.api` (`onLocationProgress`, `onPlaybackComplete`, `onDevicesChanged`), but nothing in the main process actually calls `webContents.send` for any of them yet — wiring these up is part of building Stage 3.

Suggested state shape, if built:

```ts
export interface PlaybackState {
  playbackId: string;
  deviceId: string;
  status: PlaybackStatus;
  currentCoordinate?: Coordinate;
  currentWaypointIndex: number;
  totalWaypoints: number;
  currentDistanceMeters: number;
  totalDistanceMeters: number;
  progress: number;
  elapsedSimulationMs: number;
  estimatedRemainingMs?: number;
  baseSpeedMps: number;
  effectiveSpeedMps: number;
  playbackMultiplier: number;
  loop: boolean;
  timingMode: RouteTimingMode;
  error?: string;
}
```

The main process should be authoritative. The renderer may animate visually between events but must reconcile with the next main-process state. (Today the renderer's `PlaybackState` in `routeStore.ts` is simpler and is itself authoritative, since nothing pushes from main — that's the gap Stage 3 closes.)

---

# 19. Preload bridge — ✅ done, different shape than originally spec'd

**Current status:** `src/preload/index.ts` exposes `window.api`, **not** `window.locationSimulator` — that name never existed in the actual codebase; ignore any reference to it elsewhere. The real shape is also flat, not nested into `devices`/`location`/`imports` namespaces:

```ts
window.api = {
  listDevices, getUserLocation, getHomeLocation, setHomeLocation,
  setLocation, startRoute, stopRoute, resetLocation,
  reverseGeocode, getDirections,
  importGpx, exportGpx,
  checkTool, installTool,
  onLocationProgress, onPlaybackComplete, onDevicesChanged,
  connectBrowser, disconnectBrowser,
};
```

The `LocationSimulatorAPI` type exported from `src/preload/index.ts` is the source of truth — check it before assuming a method exists. Every event subscription already returns an unsubscribe function (see `on()` in that file); keep following that pattern for anything new so listeners don't accumulate across remounts.

---

# 20. Zustand route store — mostly done, different shape

**Current status:** `src/renderer/state/routeStore.ts` covers most of this already, but doesn't wrap waypoints in a `Route` object — it tracks `waypoints: Waypoint[]` directly, plus the road-route fields (`roadRouteGeometry`, `roadRouteDistanceMeters`, `roadRouteDurationSeconds`, `travelMode`, `carSpeedMph`) and saved-routes localStorage persistence, none of which were in the original plan. `PlaybackState`/`playbackId` as originally specified don't exist — playback state today is just `isSimulating`/`simulationCoordinate`.

Original suggested shape, for reference against what's actually there:

```ts
interface RouteStoreState {
  route: Route | null;
  currentCoordinate: Coordinate | null;
  pendingCoordinate: Coordinate | null;
  travelMode: TravelMode;
  customSpeedMps: number | null;
  playbackMultiplier: number;
  timingMode: RouteTimingMode;
  loop: boolean;
  playbackId: string | null;
  playbackState: PlaybackState | null;
  mapInteractionMode: MapInteractionMode;
  selectedWaypointIndex: number | null;
  importWarnings: string[];
  error: string | null;
}
```

Do not store timers in Zustand. Do not calculate authoritative progress in Zustand — that's still good advice even though today's client-side simulation loop currently breaks it (see Stage 3 status).

---

# 21. Playback controls — 🟡 partial, different component

**Current status:** there is no `PlaybackControls.tsx`. The equivalent UI is `src/renderer/components/RouteInstructionBanner.tsx`, which already has: travel mode picker (walk/bike/car — no separate "run"), car speed presets, distance/duration summary (from Valhalla), and a Simulate/Stop button. It does **not** have: restart, pause/resume, loop toggle, playback multiplier, a progress slider, current/effective speed display, current-waypoint/total-waypoints display, or remaining-time display.

Suggested layout, if extending it:

```text
[Walk] [Run] [Bike] [Car]
[Restart] [Play/Pause] [Stop] [Loop]
Speed: [1.4 m/s]      Playback: [0.5x] [1x] [2x] [5x] [10x]
Progress: [-------------------]
Distance: 2.4 km / 8.7 km      Waypoints: 18 / 63      Remaining: 12m 30s
```

Behavior: Play starts a new session when none exists / resumes a paused one. Pause preserves progress. Stop ends the session but preserves the route. Restart returns to the beginning. Progress slider invokes the jump channel. Speed/multiplier invoke the update-playback channel. Loop updates the active session immediately.

Disable playback when: no device is selected, no route exists, route has fewer than two valid points, or the target's `capabilities.routePlayback` is false (this last check is already correctly reflected in `TargetList.tsx`'s "No routes" subtitle, but is **not** currently enforced on the Simulate button itself in `RouteInstructionBanner.tsx` — worth checking/fixing if you touch this area).

---

# 22. Device sidebar — ✅ done, different component split

**Current status:** there is no single `DeviceSidebar.tsx`. The equivalent is split across `PrimaryNavigationRail.tsx` (category selection: Simulators/Devices/Browsers), `drawers/{Simulators,Devices,Browsers}Drawer.tsx` → `drawers/TargetList.tsx` (the actual device list, showing name, connection/boot state, and capability caveats), and `SelectedTargetOverlay.tsx` (always-visible selected-device summary with connection state and a "Set User Location" action).

Keep single-target selection — multi-select was never built and there's no indication it's planned.

---

# 23. Backend priorities

There's no README "implementation order" to follow anymore — README.md now documents actual status directly (see its Status table) instead of a priority order. Use that table, or the summary below.

## iOS Simulator — ✅ done

`src/main/backends/iosSimulator.ts`. Uses `xcrun simctl` via `execFile` with argument arrays (no shell string concatenation). Discovery, set, reset all implemented; repeated-injection route playback is driven client-side by the renderer's `useRouteSimulation.ts`, not by this backend itself. Error mapping covers missing Xcode tools, invalid UDID, simulator-not-booted, and timeouts.

## Android Emulator — ❌ stub

`src/main/backends/androidEmulator.ts`. `listDevices()` returns `[]`; everything else throws `NotSupportedError`. `adbkit` is a dependency but isn't imported/exercised anywhere. The adb/telnet `geo fix` approach described in `SETUP.md` works manually outside the app; nothing in the app calls it yet.

## Browser — ✅ done

`src/main/backends/browser.ts` re-exports `browserExternal/` (split into `catalogue.ts`, `cdpTransport.ts`, `portManagement.ts`, `geolocation.ts`, `playbackMath.ts`, `lifecycle.ts`). Both embedded (this app's own window, via its own CDP debugger session) and external (Chrome/Edge/Brave/Arc/Chromium/Vivaldi/Opera, launched or adopted with `--remote-debugging-port`) targets work for discovery and single-location `setLocation`. `startRoute` has a real, complete `setInterval`-based implementation here too — but see the correction in section 4: the IPC layer never calls any backend's `startRoute`, so this code currently never runs. Route "Simulate" works for browsers the same way it does for every other backend, via the renderer's client-side loop, not via this method.

## Physical iOS — ✅ done (discovery + best-effort set location)

`src/main/backends/iosDevice.ts`. Discovery via `idevice_id -l` + `ideviceinfo`. `setLocation`/`reset` via `idevicelocation`, spawned as a persistent process (there's no one-shot "set" command — the running process is the override, killed and respawned to change location). **Real, unavoidable limitation:** on iOS 17+, `idevicelocation` needs a personalized developer disk image only obtainable through an active Xcode pairing session, so `setLocation` can fail there even with everything installed correctly. See `SETUP.md` for the full explanation and for why `pymobiledevice3` (a possible future replacement with a working DVT-based approach for modern iOS) wasn't adopted here — it requires a sudo-privileged background tunnel daemon, which is a real architecture decision, not a drop-in swap.

## Physical Android — ❌ stub

`src/main/backends/androidDevice.ts`. `listDevices()` returns `[]`; everything else throws `NotSupportedError`. The ADB mock-location strategy described below is not implemented.

Use the existing ADB mock-location strategy, if you build this. Clearly communicate requirements: developer options, selected mock-location app, device authorization, companion application installation. Distinguish unauthorized / offline / connected / unsupported-configuration states.

---

# 24. File handling

All file dialogs and filesystem reads must occur in the main process. Do not expose unrestricted Node filesystem access through preload.

Use Electron dialog APIs for: Open GPX, Open GeoJSON, Open CSV, Save GPX, future session export. (None of these dialogs are wired up yet — `gpx:import`/`gpx:export` don't currently open a native file picker at all.)

For large files: parse asynchronously, set reasonable size limits, avoid thousands of separate IPC messages, return normalized data in one response where practical, simplify only the display geometry, never the playback route.

---

# 25. Route display performance — partially relevant today

Maintain a distinction between the full route (used by playback) and a display route (simplified for MapLibre when needed). Do not replace full-resolution playback data with simplified geometry.

Suggested policy: render the full route up to 10,000 points; create a simplified display route above that. (Current routes are drawn manually one click at a time, so this hasn't mattered yet — it becomes relevant once GPX/CSV import can bring in large recorded tracks.)

Use MapLibre sources/layers for route lines (already the pattern — see `useRouteLines.ts`). Use React markers only for current position/start/end/selected/actively-edited waypoints (already the pattern for start/end — see `useWaypointMarkers.ts` — but there's no "selected waypoint" concept yet since waypoints aren't individually selectable in the UI).

---

# 26. Recent manual locations — ❌ not implemented

```ts
interface RecentLocation {
  id: string;
  coordinate: Coordinate;
  label?: string;
  usedAt: number;
}
```

Keep 10–20 recent entries, avoid consecutive duplicates, allow reapplying/deletion, persist locally, don't add playback-generated coordinates to manual history.

---

# 27. Persistence — partially done

**Current status:** saved routes already persist to `localStorage` (`routeStore.ts`, key `location-simulator:saved-routes:v1`), map theme persists (`mapUiStore.ts`), and the "home" location marker persists via the main process (`system:getHomeLocation`/`setHomeLocation`, written to a file under `app.getPath('userData')`). Travel mode, custom speed, playback multiplier, loop preference, timing mode, recent manual locations, last coordinate format, and CSV mapping do not persist yet.

Do not automatically resume playback after restart. Do not automatically inject the previous location after restart.

---

# 28. Error handling — ✅ pattern established, keep following it

`src/main/ipc/handlers/errors.ts`'s `toIpcError()` already does the `NotSupportedError`/`BackendError` → typed `IpcError` mapping described here. Keep raw stack traces and command output in main-process logs, not in renderer-facing messages. Differentiate validation failure / device unavailable / command failure / import failure / playback failure / connection failure, matching the existing error codes in `src/shared/types/ipc.ts`'s `IpcErrorCode`.

---

# 29. Cleanup — partially done

**Current status:** the browser backend already cleans up on disconnect (closes CDP sockets, kills the process if this app launched it, clears the playback interval — see `browserExternal/lifecycle.ts`). There's no app-wide "on quit, stop everything" hook yet, and no handling for "device disconnects mid-playback" beyond what each backend does incidentally.

On application close: stop all playback timers, terminate sessions, remove IPC listeners, close CDP connections, close adb/telnet connections, clean up child processes, avoid timers surviving window destruction.

When the selected device changes: don't silently move the active session to the new device — stop the current session or ask the user clearly.

When a device disconnects during playback: stop injections, mark the session paused/errored, notify the renderer, avoid endlessly launching failing commands.

---

# 30. Implementation stages — actual status

## Stage 1: Shared models and single-location flow — ✅ done

Updated `Coordinate`, capabilities, IPC types, `LocationEditor`, validation, map location selection, `location:set`/`location:reset`, iOS Simulator injection, embedded browser injection.

## Stage 2: Route creation and normalization — 🟡 partial

Done: draw-route mode, road-route distance/duration via Valhalla, travel modes, route rendering (preview + road-following line), route summary in `RouteInstructionBanner`.
Not done: edit/drag/delete individual waypoints in the UI (store actions exist, unused), formal route normalization layer.

## Stage 3: Playback manager — ❌ not built (see section 4 for the full detail)

No central main-process manager. The IPC-level `location:startRoute`/`stopRoute` are mocked and never call into any backend. `browserExternal`'s own `setInterval`-based `startRoute` is fully implemented but unreachable for the same reason. The only playback that actually runs, for every backend including browsers, is a renderer-side `requestAnimationFrame` loop (`useRouteSimulation.ts`) triggered by the Simulate button's `startSimulation()`, which repeatedly calls the single-location `setLocation()` API rather than any route-specific one. No pause/resume/restart/loop/jump. `location:progress` is defined but never emitted.

## Stage 4: Playback controls — 🟡 partial (see section 21)

Travel mode + car speed presets exist. No playback multiplier, loop, progress slider, or remaining-time display.

## Stage 5: File formats — ❌ not built (see sections 11-15)

Lat/Lng paste parsing is partial. GeoJSON, CSV: not started. GPX: mocked, not real.

## Stage 6: Recorded-track mode — ❌ not built (see section 8)

## Stage 7: Remaining backends — 🟡 partial (see section 23)

Done ahead of the original sequencing: external Chromium (discovery + set location; its own `startRoute` is fully written but currently unreachable — see section 4), physical iOS (discovery + best-effort set location, with a real iOS-17+ limitation).
Still stubs: Android Emulator, physical Android.

---

# 31. Likely files — updated to match the actual current tree

Inspect and update:

```text
src/shared/types/device.ts
src/shared/types/ipc.ts
src/shared/types/index.ts

src/main/index.ts
src/main/ipc/handlers.ts              # registration only now — see src/main/ipc/handlers/*
src/main/ipc/handlers/*.ts            # devices, system, location, geo, gpx, tools, browsers
src/main/backends/types.ts
src/main/backends/iosSimulator.ts
src/main/backends/iosDevice.ts
src/main/backends/browser.ts          # re-exports src/main/backends/browserExternal/
src/main/devices/discovery.ts

src/preload/index.ts

src/renderer/App.tsx
src/renderer/state/deviceStore.ts
src/renderer/state/routeStore.ts
src/renderer/state/mapUiStore.ts
src/renderer/screens/MainScreen.tsx
src/renderer/components/map/*.ts      # map hooks, geoMath, waypoint markers
src/renderer/components/RouteInstructionBanner.tsx
src/renderer/components/LocationEditor.tsx
```

Likely new files (still accurate as proposed paths for unbuilt Stage 2-6 work):

```text
src/main/playback/RoutePlaybackManager.ts
src/main/playback/types.ts

src/main/routes/normalizeRoute.ts
src/main/routes/routeMetrics.ts
src/main/routes/routeInterpolation.ts

src/main/importers/parseLocationText.ts
src/main/importers/parseGeoJson.ts
src/main/importers/parseGpx.ts
src/main/importers/parseCsv.ts

src/renderer/components/LocationImportDialog.tsx
src/renderer/components/CsvImportDialog.tsx
src/renderer/components/RouteSummary.tsx
```

(`LocationEditor.tsx` and `RouteImportExport.tsx` were in the original "likely new files" list — the first already exists, the second was never built and there's no dedicated import/export dialog yet; GPX export currently just writes whatever `routeStore` has via the existing Save flow.)

Adapt names to actual repository conventions — in particular, prefer splitting a new area into small per-concern files from the start (see `src/main/ipc/handlers/` and `src/main/backends/browserExternal/` for the established pattern) rather than one large file per stage.

---

# 32. Instructions to the coding agent

Before changing code:

1. Inspect the repository — this file may still be ahead of or behind reality if more work has landed since it was last updated; verify against the actual code, don't trust this document blindly.
2. Confirm which docs actually exist and are current: `README.md`, `SETUP.md`, `CLAUDE.md`.
3. Locate stub handlers (`androidEmulator.ts`, `androidDevice.ts` — both still fully stubbed as of this writing).
4. Locate current `Coordinate`, `Waypoint`, `Route`, and playback-related state in `routeStore.ts`.
5. Inspect `window.api` in `src/preload/index.ts` — it is flat, not nested, and is named `api` not `locationSimulator`.
6. Confirm MapLibre initialization in `useMapInitialization.ts`.
7. Find existing interpolation logic in `geoMath.ts` and `browserExternal/playbackMath.ts` before adding new math or a new dependency.
8. Inspect `NotSupportedError`/`BackendError` in `src/main/backends/types.ts` and `toIpcError()` in `src/main/ipc/handlers/errors.ts`.
9. Inspect installed parsing dependencies — `@turf/turf` and `gpx-builder` are both installed but unused; decide deliberately whether to finally use them or keep the hand-rolled approach already established.
10. Report differences between this document, README.md, and the actual code — this document is a plan, not a source of truth about what exists.

Then provide: existing architecture summary, current implementation status, files to modify, files to create, dependencies to add, README/code inconsistencies found, and an implementation plan for whichever stage you're picking up.

Do not redesign before inspecting the code. Do not add a dependency without explaining why.

After each stage:

1. Run `npm run typecheck:main`, `npm run typecheck:renderer`, and `npx tsc --noEmit -p src/preload/tsconfig.json` (the root `npm run typecheck` alone does not check the preload project — see `CLAUDE.md`).
2. Run lint if configured (none is, as of this writing).
3. Run `npm run build`.
4. Launch (`npm run dev`) and manually verify where possible.
5. Summarize changed files.
6. Report known limitations.
7. Update README.md's Status table and this file's stage-status callouts.
8. Do not add test code yet.
