# LocationSimulator

A cross-platform desktop application for simulating GPS locations across iOS Simulators, Android Emulators, physical iOS/Android devices, and Chromium-based browsers — designed for testing location-aware applications during development.

## Architecture Overview

### Process Model

LocationSimulator uses Electron's two-process architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Process                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    IPC Handlers                          │    │
│  │  devices:list, location:set, location:startRoute, etc.  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Device Backends                        │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────────┐    │   │
│  │  │ iOS Sim    │ │ iOS Device │ │ Android Emulator   │    │   │
│  │  │ (simctl)   │ │ (libimob)  │ │ (adbkit/telnet)    │    │   │
│  │  └────────────┘ └────────────┘ └────────────────────┘    │   │
│  │  ┌────────────┐ ┌──────────────────────────────────┐     │   │
│  │  │ Android    │ │ Browser (embedded/external CDP) │     │   │
│  │  │ Device     │ └──────────────────────────────────┘     │   │
│  │  └────────────┘                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                      IPC (contextBridge)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      Renderer Process                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ DeviceSide- │  │ MapCanvas   │  │ PlaybackControls        │  │
│  │ bar         │  │ (MapLibre)  │  │ RouteImportExport       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Zustand Stores                         │   │
│  │  deviceStore (devices, selection)                         │   │
│  │  routeStore (waypoints, playback state, speed)            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Split?

1. **Main Process Owns Device I/O**: All native CLI interactions (`xcrun simctl`, `adb`, `idevicelocation`) happen in the main process. This keeps the renderer process lightweight and ensures device commands aren't affected by UI throttling.

2. **Main Process Owns Playback Timing**: Route playback interpolation runs in the main process via setInterval. This prevents timing drift that would occur if the renderer managed playback (browser tabs throttle when backgrounded).

3. **Renderer Receives Push Events**: During playback, the main process streams `location:progress` events to the renderer so the map marker updates smoothly.

4. **Typed IPC Contract**: All IPC channels are defined in `src/shared/types/ipc.ts` with discriminated unions. Both processes import these types, so TypeScript catches mismatches at compile time.

### Backend Design

Each device platform has its own backend module implementing a common interface:

```typescript
interface DeviceBackend {
  listDevices(): Promise<Device[]>;
  // Returns the coordinate as actually applied (unsupported fields omitted)
  setLocation(deviceId: string, coordinate: Coordinate): Promise<Coordinate>;
  startRoute(deviceId: string, options: StartRouteOptions, ...): Promise<string>;
  stopRoute(deviceId: string, playbackId: string): Promise<void>;
  reset(deviceId: string): Promise<void>;
}
```

Backends throw `NotSupportedError` for operations they can't perform (e.g., physical iOS devices may not support variable-speed playback). The UI checks device capabilities to show/hide controls appropriately.

### State Management

Uses Zustand (not Redux) for simplicity:

- **deviceStore**: Tracks discovered devices, selected device, loading/error states
- **routeStore**: Tracks waypoints, playback state, speed settings, loop mode

Both stores are React hooks that components subscribe to. Changes trigger re-renders only in subscribing components.

### Map & Routing

- **MapLibre GL JS**: Renders the interactive map
- **Turf.js**: Calculates route distances, interpolates positions along routes, computes bearing between points
- **buildBaseMapStyles.ts**: Placeholder for custom map style (currently uses OSM raster tiles)

## Directory Structure

```
/src
  /main
    index.ts                   # App bootstrap, window creation
    /ipc
      handlers.ts              # IPC handler registration
    /backends
      types.ts                 # DeviceBackend interface
      iosSimulator.ts          # xcrun simctl wrapper
      iosDevice.ts             # libimobiledevice wrapper
      androidEmulator.ts       # adbkit telnet wrapper
      androidDevice.ts         # adb mock location wrapper
      browser.ts               # CDP geolocation wrapper
    /devices
      discovery.ts             # Aggregates devices from all backends
  /preload
    index.ts                   # contextBridge API exposure
  /renderer
    main.tsx                   # Entry point
    App.tsx                    # Root component
    /state
      deviceStore.ts           # Zustand device state
      routeStore.ts            # Zustand route/playback state
    /components
      DeviceSidebar.tsx        # Device list
      MapCanvas.tsx            # MapLibre map
      PlaybackControls.tsx     # Play/stop/speed controls
      RouteImportExport.tsx    # GPX import/export
      /map
        buildBaseMapStyles.ts  # Map style (TODO: replace)
      /ui
        button.tsx             # shadcn/ui Button
    /lib
      utils.ts                 # cn() class merging
    /styles
      index.css                # Tailwind + CSS variables
  /shared
    /types
      device.ts                # Device, Waypoint, Route types
      ipc.ts                   # IPC channel contracts
      index.ts                 # Barrel export
```

## IPC Channels

### Request/Response (invoke/handle)

| Channel | Request | Response |
|---------|---------|----------|
| `devices:list` | void | `{ devices: Device[] }` |
| `location:set` | `{ deviceId, lat, lng, alt? }` | `{ coordinate }` |
| `location:startRoute` | `{ deviceId, waypoints[], speed, loop? }` | `{ playbackId }` |
| `location:stopRoute` | `{ deviceId }` | `{ stoppedAt }` |
| `location:reset` | `{ deviceId }` | `{}` |
| `gpx:import` | `{ filePath }` | `{ waypoints[], routeName? }` |
| `gpx:export` | `{ filePath, waypoints[], routeName? }` | `{ filePath }` |

### Push Events (send/on)

| Channel | Payload |
|---------|---------|
| `location:progress` | `{ deviceId, playbackId, state: PlaybackState }` |
| `location:playbackComplete` | `{ deviceId, playbackId, reason, finalPosition? }` |
| `devices:changed` | `{ devices[], changeType, changedDeviceId? }` |

## Getting Started

See [SETUP.md](./SETUP.md) for installation prerequisites.

```bash
# Install dependencies
pnpm install

# Run in development mode (hot reload)
pnpm dev

# Type check
pnpm typecheck

# Build for production
pnpm build

# Package for distribution
pnpm package:mac
```

## Development Status

- [x] Step 1: Electron + Vite + React + TS scaffold
- [x] Step 2: Tailwind + HeroUI setup (originally shadcn/ui; migrated)
- [x] Step 3: Shared types and IPC contract (stubbed handlers)
- [x] Stage 1: Shared models and single-location flow
  - [x] Normalized `Coordinate` (altitude, speed, heading, accuracy, timestamp)
  - [x] Per-device `DeviceCapabilities` reported by every backend
  - [x] `location:set` / `location:reset` with validation and typed errors
  - [x] LocationEditor panel (validation, Apply/Reset/Copy/Paste/Re-send)
  - [x] Map interaction modes (navigate / select-location / draw-route) with draggable pending marker
  - [x] iOS Simulator injection via `execFile` (discovery, set, reset, error mapping)
  - [x] Embedded browser injection via CDP `Emulation.setGeolocationOverride`
- [ ] Stage 2: Route creation and normalization (draw/edit waypoints, distances, travel modes)
- [ ] Stage 3: Playback manager (main-process interpolation, progress events)
- [ ] Stage 4: Playback controls (speed presets, multipliers, progress slider)
- [ ] Stage 5: File formats (Lat/Lng text, GeoJSON, GPX, CSV)
- [ ] Stage 6: Recorded-track mode (original timing, gap compression)
- [ ] Stage 7: Remaining backends (Android emulator, external Chromium, physical devices)

## License

MIT
