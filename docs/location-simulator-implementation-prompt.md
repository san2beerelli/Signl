# LocationSimulator — Implementation Prompt

You are working on an existing Electron desktop application called **LocationSimulator**.

The application simulates GPS locations across:

- iOS Simulators
- Android Emulators
- Physical iOS devices
- Physical Android devices
- Embedded Chromium browser
- External Chromium browsers through CDP

Do not rewrite the existing architecture. Extend the current main-process backends, typed IPC contract, preload bridge, Zustand stores, MapLibre UI, and route playback design.

Do not write automated tests at this stage. Focus on implementation, type safety, error handling, build success, and manual verification.

---

## Existing architecture

The application uses:

- Electron
- Vite
- React
- TypeScript
- Zustand
- MapLibre GL JS
- Turf.js
- Tailwind CSS
- shadcn/ui

The architecture is divided into:

```text
Main process
  ├── Device discovery
  ├── Platform-specific device backends
  ├── Native CLI and device communication
  ├── Route playback engine
  └── IPC handlers

Preload process
  └── Typed contextBridge API

Renderer process
  ├── Device sidebar
  ├── MapLibre map
  ├── Location editor
  ├── Route controls
  ├── Playback controls
  └── Zustand stores
```

Follow these architectural rules:

1. Keep all native device communication in the Electron main process.
2. Keep route playback timing and interpolation in the main process.
3. Send location and playback updates to the renderer through IPC push events.
4. Define all IPC channels and payloads in `src/shared/types/ipc.ts`.
5. Keep platform-specific behavior inside device backend modules.
6. Never invoke `simctl`, `adb`, `idevicelocation`, CDP, or native commands directly from the renderer.
7. Preserve the existing `DeviceBackend` abstraction.
8. Reuse MapLibre and Turf.js.
9. Do not add automated test code for this implementation.
10. Do not claim physical-device support works unless it has been implemented and manually verified.

---

# Feature objective

## Location Injection

Implement:

- Set a single GPS coordinate
- Change location manually
- Latitude and longitude
- Altitude
- Speed
- Heading
- Horizontal accuracy
- Lat/Lng text input
- GeoJSON import
- GPX import
- CSV import
- Reset simulated location

## Route Simulation

Implement:

- Walking simulation
- Running simulation
- Cycling simulation
- Driving simulation
- Recorded GPS-track replay
- Start, pause, resume, stop, and restart
- Continuous route looping
- Jump to any route position
- Playback multipliers such as 0.5x, 1x, 2x, 5x, and 10x
- Live progress updates

---

# 1. Shared location types

Update:

```text
src/shared/types/device.ts
```

Create or extend the normalized coordinate model:

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

Add:

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

Add:

```ts
export type RouteSourceFormat =
  | 'manual'
  | 'latlng'
  | 'geojson'
  | 'gpx'
  | 'csv';
```

Add:

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

Add:

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

---

# 2. Device capabilities

Extend the `Device` model with explicit capabilities:

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

Each discovered device must report its real capabilities.

Example for an iOS Simulator:

```ts
{
  setLocation: true,
  resetLocation: true,
  routePlayback: true,
  pauseRoute: true,
  altitude: false,
  speed: false,
  heading: false,
  accuracy: false
}
```

The renderer must use capabilities to:

- Disable unsupported controls
- Show an explanatory tooltip
- Display warnings before playback
- Avoid sending unsupported properties
- Never silently advertise functionality the backend discards

---

# 3. Backend interface

Update:

```text
src/main/backends/types.ts
```

Extend the current interface while keeping route calculations outside individual backends:

```ts
interface DeviceBackend {
  listDevices(): Promise<Device[]>;

  setLocation(
    deviceId: string,
    coordinate: Coordinate,
  ): Promise<Coordinate>;

  reset(deviceId: string): Promise<void>;
}
```

Playback lifecycle methods may remain at the orchestration/service layer rather than being duplicated by every backend.

Preferred design:

```text
RoutePlaybackManager
    ↓ produces normalized Coordinate updates
DeviceBackend.setLocation()
    ↓ translates the coordinate for the platform
Target device
```

Do not implement separate interpolation logic inside every backend unless a platform absolutely requires a native route mechanism.

---

# 4. Central playback manager

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

- Start
- Pause
- Resume
- Stop
- Restart
- Loop on/off
- Change playback multiplier
- Change base speed
- Jump to waypoint
- Jump to progress percentage
- Jump to route distance
- Jump to recorded timestamp
- Read current playback state

---

# 5. Playback timing and drift

Playback runs in the main process.

Continue using a timer, but do not advance progress by assuming each callback fires exactly on time.

Use a monotonic clock such as:

```ts
performance.now()
```

or:

```ts
process.hrtime.bigint()
```

Calculate distance from actual elapsed time:

```text
elapsed simulation time
× base speed
× playback multiplier
= expected distance along route
```

Do not use an accumulating calculation such as:

```ts
currentDistance += speed * (intervalMs / 1000);
```

The timer controls update frequency only.

Default:

```ts
const DEFAULT_LOCATION_UPDATE_INTERVAL_MS = 1000;
```

Allow configuration where useful.

---

# 6. Smooth route interpolation

Use Turf.js in the main process for:

- Segment distance
- Cumulative distance
- Total route distance
- Position along a line
- Bearing
- Nearest route position when jumping

Do not jump only between original waypoints.

Build a Turf line:

```ts
const routeLine = turf.lineString(
  waypoints.map(point => [
    point.longitude,
    point.latitude,
  ]),
);
```

Keep unit conversions explicit:

```text
Turf distance: often kilometers
Application distance: meters
Speed: meters per second
Time: milliseconds
```

Interpolated coordinates may contain:

```ts
{
  latitude,
  longitude,
  altitude,
  speed,
  heading,
  accuracy,
  timestamp
}
```

Rules:

- Derive heading from route direction when missing.
- Normalize heading to `0–360`.
- Interpolate altitude when both adjacent points have altitude.
- Preserve or interpolate accuracy where practical.
- Preserve the last valid heading at route completion.

---

# 7. Travel speed and playback multiplier

Keep these concepts separate:

```text
Travel speed: 1.4 m/s
Playback multiplier: 5x
Effective speed: 7 m/s
```

Use:

```ts
effectiveSpeedMps = baseSpeedMps * playbackMultiplier;
```

UI presets:

```text
0.5x
1x
2x
5x
10x
```

Internally allow any finite positive multiplier.

When speed or multiplier changes during playback:

1. Preserve the current position.
2. Preserve accumulated elapsed playback.
3. Rebase the playback clock.
4. Continue without an unexpected jump.

---

# 8. Recorded GPS track replay

GPX and CSV routes may contain timestamps.

Add:

```ts
export type RouteTimingMode =
  | 'constant-speed'
  | 'recorded-timestamps';
```

## Constant-speed mode

Use:

- Selected travel mode
- Optional custom speed
- Playback multiplier

## Recorded-timestamps mode

Use relative source timestamps.

Requirements:

- Normalize the first timestamp to playback time zero.
- Preserve relative timing.
- Apply the playback multiplier.
- Derive speed when speed is absent.
- Preserve altitude.
- Support pause and resume.
- Support jumping by timestamp.
- Detect invalid or backward timestamps.

Add:

```ts
interface RecordedTrackOptions {
  compressInactiveGaps: boolean;
  maximumInactiveGapMs?: number;
}
```

Example: compress a 45-minute recording gap to 30 seconds when configured.

---

# 9. Single-location editor

Create:

```text
src/renderer/components/LocationEditor.tsx
```

Fields:

- Latitude
- Longitude
- Altitude
- Speed
- Heading
- Accuracy

Latitude and longitude are required. Other values are optional.

Actions:

- Apply Location
- Reset Location
- Paste
- Copy
- Use Map Selection
- Re-send Current Location

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

On Apply:

1. Confirm a device is selected.
2. Validate.
3. Invoke `location:set`.
4. Update the current map marker.
5. Store the last successfully injected coordinate.
6. Show readable backend errors.

---

# 10. Map interaction

Update:

```text
src/renderer/components/MapCanvas.tsx
```

Add:

```ts
export type MapInteractionMode =
  | 'navigate'
  | 'select-location'
  | 'draw-route';
```

## Select-location mode

- Clicking sets pending latitude and longitude.
- Show a draggable marker.
- Dragging updates pending values.
- Do not inject on every drag event.
- Inject on drag end or Apply.
- An optional immediate-injection mode may be added.

## Draw-route mode

- Each click adds a waypoint.
- Draw a route line.
- Show start and end markers.
- Allow waypoint selection.
- Allow waypoint deletion.
- Allow waypoint dragging.
- Recalculate metrics after edits.

For large routes:

- Render the line through a MapLibre GeoJSON source and layer.
- Do not create a React marker for every point.
- Keep full route data for playback.
- Show markers only for start, end, selected point, and actively edited points.

---

# 11. Input formats

Create or extend:

```text
src/renderer/components/LocationImportDialog.tsx
src/renderer/components/RouteImportExport.tsx
src/renderer/components/CsvImportDialog.tsx
```

Filesystem access and heavy parsing must occur in the main process.

Use:

```ts
export interface ParsedLocationData {
  sourceFormat: RouteSourceFormat;
  name?: string;
  coordinates: Coordinate[];
  route?: Route;
  warnings: string[];
}
```

Support:

- Lat/Lng text
- GeoJSON
- GPX
- CSV

---

# 12. Lat/Lng text parsing

Support:

```text
42.3601, -71.0589
```

```text
42.3601 -71.0589
```

```text
lat: 42.3601, lng: -71.0589
```

```json
{
  "latitude": 42.3601,
  "longitude": -71.0589
}
```

Also support:

```json
{
  "lat": 42.3601,
  "lng": -71.0589,
  "altitude": 20,
  "speed": 1.4,
  "heading": 90,
  "accuracy": 5
}
```

Do not silently reverse ambiguous coordinates.

Provide a coordinate-order selector:

```text
Latitude, Longitude
Longitude, Latitude
```

Persist the last selection locally.

---

# 13. GeoJSON import

Add typed IPC support for:

```text
geojson:import
geojson:parse
```

Support:

- `Point`
- `MultiPoint`
- `LineString`
- `MultiLineString`
- `Feature`
- `FeatureCollection`

Behavior:

- `Point` becomes a location.
- `MultiPoint` becomes a waypoint collection.
- `LineString` becomes a route.
- `MultiLineString` becomes route segments.
- Read supported metadata from feature properties.

GeoJSON coordinate order is always:

```text
longitude, latitude, altitude
```

Recognize properties such as:

```text
speed
heading
bearing
accuracy
horizontalAccuracy
timestamp
time
name
```

When multiple route candidates exist, allow the user to select one or combine compatible lines.

---

# 14. GPX import and export

Extend current GPX channels.

Support:

- `<wpt>`
- `<rte>`
- `<rtept>`
- `<trk>`
- `<trkseg>`
- `<trkpt>`
- `<ele>`
- `<time>`
- Route and track names
- Multiple track segments

Preserve segment boundaries.

Do not automatically connect unrelated track segments without a warning.

Suggested response:

```ts
interface GpxImportResponse {
  routes: Route[];
  standaloneWaypoints: Waypoint[];
  routeName?: string;
  warnings: string[];
}
```

Use a versioned channel such as `gpx:importV2` when changing the old response would cause unnecessary breakage.

---

# 15. CSV import

Add:

```text
csv:preview
csv:import
```

Recognize aliases:

```text
latitude, lat
longitude, longitude_deg, lon, lng, long
altitude, elevation, ele
speed
heading, bearing, course
accuracy, horizontalAccuracy
timestamp, time, recordedAt
name, label
```

Support:

- Comma-separated
- Tab-separated
- Semicolon-separated
- Header rows
- ISO timestamps
- Unix seconds
- Unix milliseconds

Preview must show:

- Detected separator
- Detected headers
- Sample rows
- Detected coordinate columns
- Optional mappings
- Warnings

Allow manual column mapping when detection is uncertain.

Do not place invalid CSV data into `routeStore`.

---

# 16. Route normalization

Create:

```text
src/main/routes/normalizeRoute.ts
src/main/routes/routeMetrics.ts
src/main/routes/routeInterpolation.ts
```

Normalize every imported or manually drawn route:

- Validate coordinates
- Flag or remove invalid points
- Assign IDs and indexes
- Calculate segment distances
- Calculate cumulative distances
- Calculate total distance
- Detect recorded timestamps
- Detect backward timestamps
- Derive missing headings
- Detect consecutive duplicates
- Preserve useful source metadata

Do not remove all repeated points automatically.

Repeated coordinates with different timestamps may represent:

- Stops
- Dwell time
- Traffic
- Stationary field work

Only remove duplicates that contain no meaningful timing or metadata difference.

---

# 17. Typed IPC channels

Update:

```text
src/shared/types/ipc.ts
```

Add or extend:

| Channel | Purpose |
|---|---|
| `location:set` | Inject one location |
| `location:reset` | Reset simulation |
| `location:startRoute` | Start playback |
| `location:pauseRoute` | Pause playback |
| `location:resumeRoute` | Resume playback |
| `location:stopRoute` | Stop playback |
| `location:restartRoute` | Restart route |
| `location:jumpRoute` | Jump to a position |
| `location:updatePlayback` | Change speed, multiplier, or loop |
| `location:getPlaybackState` | Read state |
| `location:parseText` | Parse pasted coordinates |
| `geojson:import` | Import GeoJSON |
| `gpx:import` | Import GPX |
| `gpx:export` | Export GPX |
| `csv:preview` | Preview CSV |
| `csv:import` | Import CSV |

Suggested request:

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
```

Suggested jump model:

```ts
export type RouteJumpPosition =
  | { type: 'waypoint'; waypointIndex: number }
  | { type: 'progress'; progress: number }
  | { type: 'distance'; distanceMeters: number }
  | { type: 'timestamp'; timestamp: number };
```

Use `0–1` internally for progress. Do not mix `0–1` and `0–100`.

---

# 18. Playback events

Continue using:

```text
location:progress
location:playbackComplete
```

Suggested state:

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

The main process is authoritative.

The renderer may animate visually between events, but must reconcile with the next main-process state.

---

# 19. Preload bridge

Update:

```text
src/preload/index.ts
```

Expose a typed API similar to:

```ts
window.locationSimulator = {
  devices: {
    list,
    onChanged,
  },

  location: {
    set,
    reset,
    startRoute,
    pauseRoute,
    resumeRoute,
    stopRoute,
    restartRoute,
    jumpRoute,
    updatePlayback,
    getPlaybackState,
    onProgress,
    onPlaybackComplete,
  },

  imports: {
    parseLocationText,
    importGeoJson,
    importGpx,
    previewCsv,
    importCsv,
  },
};
```

Every event subscription must return an unsubscribe function.

Avoid accumulating IPC listeners when React components remount.

---

# 20. Zustand route store

Update:

```text
src/renderer/state/routeStore.ts
```

Suggested state:

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

Actions:

- `setPendingCoordinate`
- `applyCoordinate`
- `setRoute`
- `clearRoute`
- `addWaypoint`
- `updateWaypoint`
- `removeWaypoint`
- `reorderWaypoint`
- `setTravelMode`
- `setCustomSpeed`
- `setPlaybackMultiplier`
- `setTimingMode`
- `setLoop`
- `setPlaybackState`
- `setMapInteractionMode`
- `setSelectedWaypoint`
- `setImportWarnings`
- `setError`

Do not store timers in Zustand.

Do not calculate authoritative progress in Zustand.

---

# 21. Playback controls

Update:

```text
src/renderer/components/PlaybackControls.tsx
```

Support:

- Walk
- Run
- Bike
- Car
- Restart
- Play
- Pause
- Resume
- Stop
- Loop
- Playback multiplier
- Progress slider
- Current and effective speed
- Current waypoint
- Total waypoints
- Current distance
- Total distance
- Remaining time

Suggested layout:

```text
[Walk] [Run] [Bike] [Car]

[Restart] [Play/Pause] [Stop] [Loop]

Speed: [1.4 m/s]
Playback: [0.5x] [1x] [2x] [5x] [10x]

Progress: [-------------------]
Distance: 2.4 km / 8.7 km
Waypoints: 18 / 63
Remaining: 12m 30s
```

Behavior:

- Play starts a new session when none exists.
- Play resumes a paused session.
- Pause preserves progress.
- Stop ends the session but preserves the route.
- Restart returns to the beginning.
- Progress slider invokes `location:jumpRoute`.
- Speed and multiplier invoke `location:updatePlayback`.
- Loop updates the active session immediately.

Disable playback when:

- No device is selected
- No route exists
- Route has fewer than two valid points
- Target does not support route playback

---

# 22. Device sidebar

Update:

```text
src/renderer/components/DeviceSidebar.tsx
```

Show:

- Device name
- Platform
- Simulator, emulator, physical, or browser type
- Connection status
- Location support
- Route support
- Current playback status
- Backend errors

Keep single-target selection for the initial implementation unless multiple selection already exists.

Design the playback manager so multi-device support can be added later.

---

# 23. Backend priorities

Follow the README implementation order.

## iOS Simulator

Update:

```text
src/main/backends/iosSimulator.ts
```

Use:

```bash
xcrun simctl
```

Implement:

- Discovery
- Set coordinate
- Reset coordinate
- Repeated coordinate injection from `RoutePlaybackManager`

Do not pass a full route to this backend when the playback manager already produces coordinates.

Capture:

- Exit code
- stdout
- stderr
- Timeout
- Missing Xcode tools
- Invalid UDID
- Simulator not booted

Use `spawn` or `execFile` with argument arrays. Avoid shell string concatenation.

## Android Emulator

Update:

```text
src/main/backends/androidEmulator.ts
```

Use the existing adbkit/telnet design.

Keep any longitude/latitude reversal internal to the backend.

The shared model remains `latitude, longitude`.

## Browser

Update:

```text
src/main/backends/browser.ts
```

Support:

- Embedded Electron target
- External Chromium CDP target
- Permission handling
- Coordinate injection
- Reset override
- Reconnection and disconnect handling

Filter unsupported CDP target types.

## Physical iOS

Update:

```text
src/main/backends/iosDevice.ts
```

Use the existing libimobiledevice/`idevicelocation` approach.

Return `NotSupportedError` when:

- Required tools are missing
- iOS version is unsupported
- Developer services are unavailable
- Optional fields cannot be injected

Never pretend success.

## Physical Android

Update:

```text
src/main/backends/androidDevice.ts
```

Use the existing ADB mock-location strategy.

Clearly communicate requirements:

- Developer options
- Selected mock-location app
- Device authorization
- Companion application installation

Distinguish:

- Unauthorized
- Offline
- Connected
- Unsupported configuration

---

# 24. File handling

All file dialogs and filesystem reads must occur in the main process.

Do not expose unrestricted Node filesystem access through preload.

Use Electron dialog APIs for:

- Open GPX
- Open GeoJSON
- Open CSV
- Save GPX
- Future session export

For large files:

- Parse asynchronously
- Set reasonable size limits
- Avoid thousands of separate IPC messages
- Return normalized data in one response where practical
- Simplify only the display geometry, never the playback route

---

# 25. Route display performance

Maintain:

```text
Full route
  Used by playback

Display route
  Simplified for MapLibre when needed
```

Do not replace full-resolution playback data with simplified geometry.

Suggested policy:

```text
Up to 10,000 points:
Render full route.

Above 10,000 points:
Create a simplified display route.
```

Use MapLibre sources and layers for:

- Route line
- Completed route
- Remaining route
- Imported point collections

Use React markers only for:

- Current position
- Start
- End
- Selected waypoint
- Actively edited waypoint

---

# 26. Recent manual locations

Store:

```ts
interface RecentLocation {
  id: string;
  coordinate: Coordinate;
  label?: string;
  usedAt: number;
}
```

Requirements:

- Keep 10–20 recent entries
- Avoid consecutive duplicates
- Allow reapplying
- Allow deletion
- Persist locally
- Do not add playback-generated coordinates to manual history

---

# 27. Persistence

Persist:

- Last travel mode
- Custom speed
- Playback multiplier
- Loop preference
- Timing mode
- Recent manual locations
- Last coordinate format
- CSV mapping
- Appropriate map interaction preference

Do not automatically resume playback after restart.

Do not automatically inject the previous location after restart.

---

# 28. Error handling

Provide readable errors such as:

```text
No device is selected.
The selected simulator is not booted.
This target does not support altitude simulation.
The GPX file does not contain a route or track.
Latitude must be between -90 and 90.
The browser CDP connection was lost.
The route contains fewer than two valid points.
The physical iOS location service is unavailable.
```

Keep raw stack traces and command output in main-process logs.

Use `NotSupportedError` for unsupported features.

Differentiate:

- Validation failure
- Device unavailable
- Command failure
- Import failure
- Playback failure
- Connection failure

---

# 29. Cleanup

On application close:

- Stop all playback timers
- Terminate sessions
- Remove IPC listeners
- Close CDP connections
- Close adb/telnet connections
- Clean up child processes
- Avoid timers surviving window destruction

When the selected device changes:

- Do not silently move the active session to the new device.
- Stop the current session or ask the user clearly.

When a device disconnects during playback:

1. Stop injections.
2. Mark the session paused or errored.
3. Notify the renderer.
4. Avoid endlessly launching failing commands.

---

# 30. Implementation stages

## Stage 1: Shared models and single-location flow

Implement:

- Updated `Coordinate`
- Capabilities
- IPC types
- `LocationEditor`
- Validation
- Map location selection
- `location:set`
- `location:reset`
- iOS Simulator injection
- Embedded browser injection where possible

Finish and manually verify this flow before route playback.

## Stage 2: Route creation and normalization

Implement:

- Draw-route mode
- Add, edit, drag, and delete waypoints
- Route normalization
- Distance and bearing
- Travel modes
- Route rendering
- Route summary

## Stage 3: Playback manager

Implement:

- Main-process manager
- Smooth interpolation
- Start
- Pause
- Resume
- Stop
- Restart
- Progress events
- Completion events
- Main-process authoritative state

## Stage 4: Playback controls

Implement:

- Walk, run, bike, car
- Custom speed
- 0.5x, 1x, 2x, 5x, 10x
- Loop
- Progress slider
- Jump by progress
- Distance and remaining time

## Stage 5: File formats

Implement:

- Lat/Lng parsing
- GeoJSON
- GPX import/export
- CSV preview and mapping
- Recorded timestamp detection

## Stage 6: Recorded-track mode

Implement:

- Original relative timing
- Derived speed
- Gap compression
- Timestamp jump
- Original and adjusted duration

## Stage 7: Remaining backends

Implement:

- Android Emulator
- External Chromium
- Physical Android
- Physical iOS

Represent limitations through capabilities and `NotSupportedError`.

---

# 31. Likely files

Inspect and update:

```text
src/shared/types/device.ts
src/shared/types/ipc.ts
src/shared/types/index.ts

src/main/index.ts
src/main/ipc/handlers.ts
src/main/backends/types.ts
src/main/backends/iosSimulator.ts
src/main/backends/browser.ts
src/main/devices/discovery.ts

src/preload/index.ts

src/renderer/App.tsx
src/renderer/state/deviceStore.ts
src/renderer/state/routeStore.ts
src/renderer/components/DeviceSidebar.tsx
src/renderer/components/MapCanvas.tsx
src/renderer/components/PlaybackControls.tsx
src/renderer/components/RouteImportExport.tsx
```

Likely new files:

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

src/renderer/components/LocationEditor.tsx
src/renderer/components/LocationImportDialog.tsx
src/renderer/components/CsvImportDialog.tsx
src/renderer/components/RouteSummary.tsx
```

Adapt names to actual repository conventions.

---

# 32. Instructions to the coding agent

Before changing code:

1. Inspect the repository.
2. Confirm which README files actually exist.
3. Locate stub handlers.
4. Locate current `Coordinate`, `Waypoint`, `Route`, and `PlaybackState`.
5. Inspect the preload API.
6. Confirm MapLibre initialization.
7. Find any existing interpolation logic.
8. Inspect error classes.
9. Inspect installed parsing dependencies.
10. Report differences between README and code.

Then provide:

- Existing architecture summary
- Current implementation status
- Files to modify
- Files to create
- Dependencies to add
- README/code inconsistencies
- Stage 1 implementation plan

Do not redesign before inspecting the code.

Do not add a dependency without explaining why.

After each stage:

1. Run `pnpm typecheck`.
2. Run lint if configured.
3. Run `pnpm build`.
4. Launch and manually verify where possible.
5. Summarize changed files.
6. Report known limitations.
7. Update the README checklist.
8. Do not add test code yet.

Begin with **Stage 1 only**. Do not implement all stages in one large change.
