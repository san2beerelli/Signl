# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LocationSimulator is an Electron desktop app that spoofs GPS location on iOS Simulators, Android Emulators, physical iOS/Android devices, and Chromium browsers (embedded + external CDP), for testing location-aware apps. Electron + Vite (`electron-vite`) + React 19 + TypeScript 7 (`tsgo`) + Zustand + MapLibre GL JS + HeroUI.

Package manager is **npm** (`package-lock.json`), not pnpm — README.md/SETUP.md still say `pnpm`, that's stale.

## Commands

```bash
npm run dev                 # electron-vite dev — hot reload, opens the app
npm run build                # electron-vite build — outputs to dist/{main,preload,renderer}
npm run typecheck:main       # tsc --noEmit -p src/main/tsconfig.json
npm run typecheck:renderer   # tsc --noEmit -p src/renderer/tsconfig.json
npx tsc --noEmit -p src/preload/tsconfig.json   # preload has no package.json script
npm run package:mac          # electron-builder — packaged app to release/
```

- The root `npm run typecheck` (`tsc --noEmit`, no project flag) checks **nothing useful** — always run the three commands above individually (main / renderer / preload each have their own `tsconfig.json` with different `lib`/`types`, since main is Node and renderer is DOM).
- No test suite exists yet. No lint config exists yet.
- Not a git repository (no `.git`) as of this writing — don't assume `git` commands work.

## Process architecture

Standard Electron three-process split, connected by a **typed IPC contract**:

```
src/shared/types/ipc.ts   — IpcInvokeChannel union + per-channel request/response types
        ↑ imported by both sides, so a channel/payload mismatch is a compile error
src/main/ipc/handlers.ts  — ipcMain.handle() for every channel, registered in registerIpcHandlers()
src/preload/index.ts      — contextBridge exposes window.api.* (a thin typed wrapper around ipcRenderer.invoke)
src/renderer/**           — calls window.api.xxx(...), never ipcRenderer directly
```

To add a new IPC channel: add the channel name to `IpcInvokeChannel` and its request/response types in `src/shared/types/ipc.ts`, add a handler function + `ipcMain.handle(...)` registration in `src/main/ipc/handlers.ts`, then add a matching method in the `api` object in `src/preload/index.ts`. All three must stay in sync — nothing does this automatically.

`window.api` is declared globally via `src/renderer/env.d.ts` (`Window.api: LocationSimulatorAPI`, the type exported from `src/preload/index.ts`). There is no `window.locationSimulator` — that name appears in `docs/location-simulator-implementation-prompt.md` (an earlier planning doc) but was never the actual API name.

Push events (main → renderer) use `webContents.send` / `ipcRenderer.on`, also declared in `ipc.ts` (`IpcPushChannel`). Only `location:progress`, `location:playbackComplete`, `devices:changed` exist; wiring for these to actually fire is incomplete (see Known gaps).

## Device backends

`src/main/backends/{iosSimulator,iosDevice,androidEmulator,androidDevice,browser}.ts` each export an object implementing `DeviceBackend` (`src/main/backends/types.ts`): `getCapabilities()`, `listDevices()`, `setLocation()`, `startRoute()`, `stopRoute()`, `reset()`. `src/main/devices/discovery.ts` holds the `DeviceKind → DeviceBackend` registry (`getBackendForKind`) and `discoverAllDevices()` (runs all backends in parallel via `Promise.allSettled`, one backend failing doesn't break the others).

Backends never claim capabilities they don't have — `getCapabilities()` returns real per-field support (e.g. iOS Simulator: no altitude/speed/heading/accuracy, only lat/lng) and the renderer gates UI on this (see `LocationEditor.tsx`). Unsupported operations throw `NotSupportedError`; operation failures throw `BackendError` with a `code` — `src/main/ipc/handlers.ts`'s `toIpcError()` maps both to the typed `IpcError` sent to the renderer.

**Implementation status** (check `NotSupportedError`/`TODO` density in a backend file before assuming it works):
- `iosSimulator.ts` (`xcrun simctl`) and `browser.ts` embedded mode (CDP `Emulation.setGeolocationOverride` on the app's own `webContents.debugger`) are **real**.
- `androidEmulator.ts`, `androidDevice.ts`, `iosDevice.ts`, and `browser.ts` external/CDP mode are **stubs** — `listDevices()` returns `[]`, everything else throws `NotSupportedError('... Not implemented yet')`. `adbkit` is a dependency used only inside these stub files' imports, not exercised.

`getBackendForKind`/`getBackendForDevice` require the caller to already know the device's `kind` — `handlers.ts` keeps a `deviceKindCache: Map<deviceId, DeviceKind>` populated by the last `devices:list` call.

## Route playback — mocked, not real

`location:startRoute`/`location:stopRoute` handlers in `handlers.ts` are **mocks**: they generate a fake `playbackId` / return a hardcoded `stoppedAt` and never actually move anything or emit `location:progress`. The `RoutePlaybackManager` described in `docs/location-simulator-implementation-prompt.md` (main-process interpolation loop, Turf.js-based position/bearing calculation) does not exist yet. `@turf/turf` is a listed dependency but is not imported anywhere in `src/`. Likewise `gpx:import`/`gpx:export` return hardcoded mock waypoints regardless of the requested file — `gpx-builder` is a dependency but never imported. Don't assume these work; they need to be built (see the doc's Stage 3/5).

## Renderer: map shell architecture

`src/renderer/screens/MainScreen.tsx` is the only screen (`App.tsx` renders it directly — there's no more onboarding/environment-check screen flow). It's a single edge-to-edge MapLibre map with floating panels absolutely-positioned over it — there is **no native title bar** (`titleBarStyle: 'hiddenInset'` in `src/main/index.ts`, traffic lights inset at `{x:16, y:16}`); a transparent `backdrop-filter: blur()` strip along the top edge (`WebkitAppRegion: 'drag'`) is what makes the window draggable, with every floating panel explicitly marked `WebkitAppRegion: 'no-drag'` so they stay clickable.

Floating shell pieces, all positioned via shared constants in `src/renderer/components/mapShellLayout.ts` (`SHELL_MARGIN`, `RAIL_WIDTH`, `DRAWER_WIDTH`, `SHELL_TOP`, `DRAWER_LEFT`, `shellContentLeftInset()`) so they stay aligned without prop-drilling pixel values:
- `PrimaryNavigationRail.tsx` — left rail: Simulators/Devices/Browsers (top), Routes + Settings (bottom). Same top/bottom extent and background (`Surface variant="secondary"`) as the drawer by design — don't reintroduce a different background/margin for the rail without checking they still visually match.
- `SecondaryDrawer.tsx` — renders `drawers/{Simulators,Devices,Browsers,Routes}Drawer.tsx` based on `mapUiStore`'s `activeSection`; unmounts (not just hides) when closed so its buttons drop out of tab order.
- `SelectedTargetOverlay.tsx` — top-right, always-visible selected-device summary.
- `RouteInstructionBanner.tsx` — appears only in `draw-route` interaction mode (`routeStore.mapInteractionMode`), replacing the Routes drawer for the duration of route creation. Before 2 waypoints exist it's just instructional text; once a route exists it becomes the mode-selector + distance/time summary + Save/Directions panel (Save/Directions are present but disabled — no backend yet).
- `EnvironmentCheckModal.tsx` — the CLI-tool check (`tools:check`/`tools:install`, real `xcrun`/`adb`/`idevice_id` shell-outs) that used to be a gating first screen; now opened on demand from the rail's Settings button, as a `Modal`.

## State: three Zustand stores, don't blur their responsibilities

- `deviceStore.ts` — discovered devices + `selectedDeviceId`. `refreshDevices()` calls `devices:list`.
- `routeStore.ts` — waypoints, `mapInteractionMode` (`navigate`/`select-location`/`draw-route` — read via `useRouteStore.getState()` inside the MapLibre `click` handler to avoid stale-closure bugs), pending/applied single-location coordinates, playback state, and the road-route fields (`roadRouteGeometry`, `roadRouteDistanceMeters`, `roadRouteDurationSeconds`, `travelMode`, `fetchRoadRoute()`, `setTravelMode()` — see below).
- `mapUiStore.ts` — only `activeSection`/`isDrawerOpen` for the rail/drawer. `selectSection(section)` toggles closed if you click the already-active section.

Waypoints are matched by generated `id` (not array index) for anything that resolves asynchronously (`updateWaypointById`) — reverse-geocoding a waypoint takes a moment, and its index can shift (reorder/removal) before the response lands, so index-based updates would be a race condition.

## Map click handling & external routing APIs

`MainScreen.tsx`'s `MapArea` registers one `map.on('click', ...)` that switches on `mapInteractionMode`. In `draw-route` mode, each click: (1) adds a waypoint, (2) reverse-geocodes it (best-effort, silently no-ops on failure) via `location:reverseGeocode`, (3) calls `routeStore.fetchRoadRoute()` to refresh the road-following line through *all* current waypoints.

Two free, keyless, OpenStreetMap-based public services back this — both are volunteer/community-run **fair-use demo servers**, not SLA-backed APIs, so keep usage to interactive single-click-at-a-time (not bulk/loops):
- **Nominatim** (`location:reverseGeocode` handler) — `https://nominatim.openstreetmap.org/reverse`, requires a `User-Agent` header, builds a short `"11 Maple St"`-style address from the `address` object (falls back progressively: road → neighbourhood → first two segments of `display_name`).
- **Valhalla** (`route:getDirections` handler) — `https://valhalla1.openstreetmap.de/route`, requires an `X-Client-Id` header (not an API key). Chosen over OSRM's public demo because OSRM's demo silently ignores the profile and only ever routes driving regardless of URL — verified by directly comparing `driving`/`walking`/`cycling` responses (identical output). Valhalla genuinely supports distinct profiles: `TravelMode` (`walk`/`run`/`bike`/`car`) maps to Valhalla `costing` (`pedestrian`/`pedestrian`/`bicycle`/`auto`) via `VALHALLA_COSTING_BY_TRAVEL_MODE` in `handlers.ts`. Its response geometry is an **encoded polyline at precision 6** (not GeoJSON, unlike OSRM) — `handlers.ts` has a hand-rolled `decodePolyline()` for this; per-leg shapes are decoded and stitched together, dropping the duplicate point at each waypoint boundary. Distance comes back in km and is converted to meters.

Map rendering keeps two separate line layers (`updateRouteLine`/`updateRoadRouteLine` in `MainScreen.tsx`): a dashed straight-line preview between raw waypoints, replaced entirely (not overlaid) by a thick solid blue line once `roadRouteGeometry` resolves. Start/end waypoints get a labeled pin (address + START/END, built via `buildLabeledPinElement`); everything in between is a plain dot (`buildDotMarkerElement`).

MapLibre's canvas only sizes itself from its container once, at construction — a `ResizeObserver` in the map-init `useEffect` calls `map.resize()` on container size changes; without it, layout changes (drawer open/close, window resize) leave the canvas stuck at a stale size.

## TypeScript 7 (`tsgo`) / build quirks

- `exactOptionalPropertyTypes: true` — build optional-field objects with conditional spreads (`...(x !== undefined ? { x } : {})`), not `field: x | undefined`.
- No `baseUrl` in any tsconfig; path aliases are `@/*` → `src/renderer/*` (renderer only) and `@shared/*` → `src/shared/*` (all three), configured per-project in each `tsconfig.json` **and** mirrored in `electron.vite.config.ts`'s `resolve.alias` — a new alias needs both.
- Global ambient type packages (`react`, `geojson`) only become available if something in the same tsconfig's file graph actually imports from that package name — relying on `React.CSSProperties` or `GeoJSON.Feature` without any `import type ... from "react"/"geojson"` anywhere in-program will fail to resolve even though it looks like it should (bit MainScreen.tsx does import `Feature`/`LineString` from `"geojson"` explicitly for this reason).
- HeroUI (`@heroui/react` v3, react-aria based) is the UI library — **not shadcn/ui**, despite `docs/location-simulator-implementation-prompt.md` and stale parts of `README.md` saying shadcn. `ToggleButtonGroup` uses `selectedKeys`/`onSelectionChange` (array-based), not `value`/`onChange`. `Surface`/`Card`/etc. variants are `default`/`secondary`/`tertiary`/`transparent`. React-aria's `Button` does not forward a `title` prop (no native tooltip) — wrap icon-only buttons in a `<span title="...">` for one, as done throughout the rail/drawers.
