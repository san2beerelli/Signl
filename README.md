# Signl

A desktop app for spoofing GPS location during development. Drop a pin or draw a route on the map and Signl pushes that location straight into an iOS Simulator, a physical iOS device, or a Chromium browser tab (embedded or external), so you can test location-aware features without leaving your desk.

Built with Electron + Vite (`electron-vite`) + React 19 + TypeScript + Zustand + MapLibre GL JS + HeroUI.

## Status

Not everything below is finished — this section is here so you know what actually works before relying on it.

| Backend | Discovery | Set location | Route playback |
|---|---|---|---|
| iOS Simulator (`xcrun simctl`) | ✅ | ✅ | ❌ (mocked) |
| Physical iOS device (`libimobiledevice`/`idevicelocation`) | ✅ | ✅ lat/lng only, best-effort | ❌ |
| Embedded browser (this app's own window, CDP) | N/A | ✅ | ✅ |
| External browser (Chrome/Edge/Brave/Arc/Chromium/Vivaldi/Opera, CDP) | ✅ | ✅ | ✅ |
| Android Emulator | ❌ stub | ❌ | ❌ |
| Physical Android device | ❌ stub | ❌ | ❌ |

A few other things worth knowing:

- **Physical iOS device location control is fragile on modern iOS.** `idevicelocation` mounts the developer disk image for the device's exact iOS version. On iOS 17+, Apple only issues *personalized* disk images through an active Xcode pairing session, so `setLocation` can fail with a mount error on newer devices even with everything installed correctly — that's an OS-level limitation, not a bug here.
- **GPX import/export is mocked.** `gpx:import`/`gpx:export` return hardcoded data regardless of the file you pick; `gpx-builder` is a dependency but isn't imported anywhere yet.
- Reverse geocoding and road-following directions are real, backed by two free public OpenStreetMap services: [Nominatim](https://nominatim.openstreetmap.org) and [Valhalla](https://valhalla1.openstreetmap.de). Both are volunteer-run fair-use demo servers, not SLA-backed APIs — fine for interactive single-click use, not for bulk requests.

## Getting started

Prerequisites and per-platform CLI tool setup (Xcode command line tools, `libimobiledevice`, Android platform tools, etc.) are in [SETUP.md](./SETUP.md). The app's own Environment Check panel (Settings button on the left rail) will also tell you what's missing and walk you through installing it.

```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Type check (main, renderer, and preload each have their own tsconfig —
# the root `npm run typecheck` alone does not check the preload project)
npm run typecheck:main
npm run typecheck:renderer
npx tsc --noEmit -p src/preload/tsconfig.json

# Build for production
npm run build

# Package a distributable app
npm run package:mac
```

Package manager is **npm** (`package-lock.json`).

## Architecture

Standard Electron three-process split, connected by a typed IPC contract:

```
src/shared/types/ipc.ts   IpcInvokeChannel/IpcPushChannel unions + per-channel payload types
        ↑ imported by both sides, so a channel/payload mismatch is a compile error
src/main/ipc/handlers.ts  registerIpcHandlers() — wires ipcMain.handle() to the handler modules below
src/preload/index.ts      contextBridge exposes window.api (a thin typed wrapper over ipcRenderer.invoke)
src/renderer/**           calls window.api.xxx(...), never ipcRenderer directly
```

To add a new IPC channel: add it to `IpcInvokeChannel` and its payload/response types in `src/shared/types/ipc.ts`, add a handler in `src/main/ipc/handlers/` and register it in `handlers.ts`, then add a matching method to the `api` object in `src/preload/index.ts`. All three have to stay in sync by hand.

### Device backends

`src/main/backends/{iosSimulator,iosDevice,androidEmulator,androidDevice,browser}.ts` each implement the `DeviceBackend` interface (`src/main/backends/types.ts`): `getCapabilities()`, `listDevices()`, `setLocation()`, `startRoute()`, `stopRoute()`, `reset()`. `src/main/devices/discovery.ts` holds the `DeviceKind → DeviceBackend` registry and runs every backend in parallel via `Promise.allSettled`, so one backend failing doesn't break device discovery for the others.

Backends never claim capabilities they don't have — `getCapabilities()` returns real per-field support, and the renderer gates the UI on it. Unsupported operations throw `NotSupportedError`; operation failures throw `BackendError` with a typed error code, which `main/ipc/handlers/errors.ts` maps to the `IpcError` sent to the renderer.

`browser.ts` re-exports the actual implementation from `browserExternal/`, split into `catalogue.ts` (known browsers + capability data), `cdpTransport.ts` (the raw CDP HTTP/WebSocket plumbing), `portManagement.ts`, `geolocation.ts` (override apply/clear), `playbackMath.ts` (route interpolation), and `lifecycle.ts` (connect/disconnect).

### Renderer shell

`src/renderer/screens/MainScreen.tsx` is the only screen — a single edge-to-edge MapLibre map with floating panels absolutely positioned over it, no native title bar. The map itself is broken into hooks under `src/renderer/components/map/` (`useMapInitialization`, `useLocationMarkers`, `useWaypointMarkers`, `useRouteLines`, `useRouteSimulation`) so `MainScreen.tsx` stays focused on assembling them.

Floating shell pieces:
- `PrimaryNavigationRail.tsx` — left rail (Simulators/Devices/Browsers, Routes, Settings, theme toggle)
- `SecondaryDrawer.tsx` — renders `drawers/{Simulators,Devices,Browsers,Routes}Drawer.tsx` based on which rail section is active
- `SelectedTargetOverlay.tsx` — always-visible selected-device summary
- `RouteInstructionBanner.tsx` — the route-drawing / simulate / save flow
- `MapControls.tsx` — zoom/locate controls
- `EnvironmentCheckModal.tsx` + `InstallStepsView.tsx` — CLI tool verification, opened from the rail's Settings button

Three Zustand stores, each with a distinct responsibility: `deviceStore` (discovered devices, selection), `routeStore` (waypoints, playback, road-route geometry), `mapUiStore` (which rail section/drawer is open, map theme).

### Directory structure

```
src/
  main/
    index.ts                       # App bootstrap, window creation
    windows.ts                     # Main-window registry (avoids a circular import)
    ipc/
      handlers.ts                  # registerIpcHandlers() — wires channels to handlers/
      handlers/                    # devices, system, location, geo, gpx, tools, browsers
    backends/
      types.ts                     # DeviceBackend interface, NotSupportedError/BackendError
      iosSimulator.ts              # xcrun simctl — real
      iosDevice.ts                 # idevice_id/ideviceinfo/idevicelocation — real
      androidEmulator.ts           # stub
      androidDevice.ts             # stub
      browser.ts                   # re-exports browserExternal/
      browserExternal/             # catalogue, CDP transport, geolocation, playback, lifecycle
    devices/
      discovery.ts                 # Aggregates devices across all backends
  preload/
    index.ts                       # contextBridge → window.api
  renderer/
    main.tsx / App.tsx             # Entry point
    screens/MainScreen.tsx         # The one screen
    components/
      map/                         # Map hooks + pure helpers (geoMath, marker elements, ...)
      drawers/                     # Per-section drawer content
      *.tsx                        # Shell panels (rail, drawer host, overlays, banner, controls)
    state/                         # deviceStore, routeStore, mapUiStore (Zustand)
    icons.tsx                      # Shared SVG icon set
  shared/
    types/                         # device.ts, ipc.ts, index.ts (barrel)
    coordinateValidation.ts
```

## IPC channels

### Request/response (`invoke`/`handle`)

| Channel | Purpose |
|---|---|
| `devices:list` | Discover devices across all backends |
| `location:set` | Push a coordinate to a device |
| `location:reset` | Reset a device to its real/default location |
| `location:startRoute` / `location:stopRoute` | Route playback (mocked for most backends, real for browsers) |
| `location:reverseGeocode` | Coordinate → short address, via Nominatim |
| `route:getDirections` | Road-following route through waypoints, via Valhalla |
| `gpx:import` / `gpx:export` | GPX file I/O (currently mocked) |
| `tools:check` / `tools:install` | CLI tool verification/installation for the Environment Check panel |
| `system:getUserLocation` | IP-based approximate location, for centering the map |
| `system:getHomeLocation` / `system:setHomeLocation` | Persisted "home" pin the user can drag to set as their default |
| `browsers:connect` / `browsers:disconnect` | Launch/adopt or disconnect an external browser's debug session |

### Push events (`send`/`on`)

| Channel | Payload |
|---|---|
| `location:progress` | Route playback position updates |
| `location:playbackComplete` | Route playback finished or was stopped |
| `devices:changed` | Device list changed |

## License

MIT
