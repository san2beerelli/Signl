/**
 * Main Screen
 *
 * The primary interface: an edge-to-edge map with a floating primary
 * navigation rail (Simulators/Devices/Browsers/Routes) and secondary
 * drawer, plus a persistent selected-target overlay. There's no opaque
 * title bar — a transparent, blurred drag strip along the top edge keeps
 * the window draggable (and the traffic-light controls legible) while the
 * map stays visible underneath it.
 */

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { Card, Chip, Typography, Surface } from "@heroui/react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useDeviceStore } from "@/state/deviceStore.js";
import { useRouteStore } from "@/state/routeStore.js";
import { useMapUiStore } from "@/state/mapUiStore.js";
import { buildBaseMapStyle } from "@/components/map/buildBaseMapStyles.js";
import { resolveUserLocation } from "@/components/map/userLocation.js";
import { PrimaryNavigationRail } from "@/components/PrimaryNavigationRail.js";
import { SecondaryDrawer } from "@/components/SecondaryDrawer.js";
import { SelectedTargetOverlay } from "@/components/SelectedTargetOverlay.js";
import { RouteInstructionBanner } from "@/components/RouteInstructionBanner.js";
import { MapControls } from "@/components/MapControls.js";
import { DRAG_STRIP_HEIGHT, SHELL_TOP, shellContentLeftInset } from "@/components/mapShellLayout.js";
import { DEFAULT_TRAVEL_SPEEDS_MPS } from "@shared/types/index.js";
import type { Waypoint } from "@shared/types/index.js";
import type { Feature, LineString } from "geojson";

const { Code } = Typography;

/**
 * Haversine distance in meters between two [longitude, latitude] points.
 */
function distanceBetween(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const Δφ = ((b[1] - a[1]) * Math.PI) / 180;
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Linearly interpolate a [longitude, latitude] position at `targetMeters`
 * along `geometry`, using pre-built cumulative distance array.
 */
function interpolateAlongRoute(
  geometry: [number, number][],
  cumDist: number[],
  targetMeters: number
): [number, number] {
  for (let i = 0; i < geometry.length - 1; i++) {
    const segEnd = cumDist[i + 1]!;
    if (targetMeters <= segEnd) {
      const segStart = cumDist[i]!;
      const t = segEnd === segStart ? 0 : (targetMeters - segStart) / (segEnd - segStart);
      const a = geometry[i]!;
      const b = geometry[i + 1]!;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
  }
  return geometry[geometry.length - 1]!;
}

/**
 * Reverse-geocodes a just-added waypoint and, once resolved, stamps its
 * address onto `name`. Matched by ID (not index) since the waypoint's
 * position in the array can change before this async call resolves.
 * Best-effort — a failed lookup just leaves the marker unlabeled.
 */
async function reverseGeocodeWaypoint(waypoint: Waypoint): Promise<void> {
  try {
    const response = await window.api.reverseGeocode({
      latitude: waypoint.latitude,
      longitude: waypoint.longitude,
    });
    if (response.success && response.address) {
      useRouteStore.getState().updateWaypointById(waypoint.id, { name: response.address });
    }
  } catch {
    // Non-critical — the marker just renders without a label.
  }
}

/** Plain dot marker used for waypoints that aren't the route's start or end. */
function buildDotMarkerElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-warning);
    border: 2px solid var(--color-background);
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  `;
  return el;
}

/**
 * Labeled pin for the route's start/end point — address (once resolved)
 * and a START/END caption stacked above a round pin, anchored so the
 * pin's base sits exactly on the coordinate.
 */
function buildLabeledPinElement(address: string | undefined, caption: string): HTMLDivElement {
  const container = document.createElement("div");
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  `;

  if (address) {
    const label = document.createElement("div");
    label.style.cssText = `
      background: rgba(20, 20, 24, 0.88);
      color: #fff;
      font-weight: 700;
      font-size: 12px;
      padding: 3px 9px;
      border-radius: 8px;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    `;
    label.textContent = address;
    container.appendChild(label);
  }

  const captionEl = document.createElement("div");
  captionEl.style.cssText = `
    color: rgba(255,255,255,0.75);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  `;
  captionEl.textContent = caption;
  container.appendChild(captionEl);

  const pin = document.createElement("div");
  pin.style.cssText = `
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffffff, #cfcfcf 55%, #8a8a8a 100%);
    border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.5);
    margin-top: 2px;
  `;
  container.appendChild(pin);

  return container;
}

export function MainScreen(): JSX.Element {
  const { refreshDevices } = useDeviceStore();

  // Bootstrap device discovery once — the drawers and selected-target
  // overlay all read from the same `deviceStore` list.
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  return (
    <Surface
      variant="default"
      style={{
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <MapArea />
    </Surface>
  );
}

function MapArea(): JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const pendingMarkerRef = useRef<maplibregl.Marker | null>(null);
  const appliedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const simulatedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const simRafRef = useRef<number | null>(null);
  const userInteractedRef = useRef(false);
  // Tracks whether this is the very first mount so the theme-change effect
  // skips the initial render (the Map constructor already uses the right style).
  const isFirstThemeApply = useRef(true);

  const {
    waypoints,
    playbackState,
    mapInteractionMode,
    pendingCoordinate,
    lastAppliedCoordinate,
    roadRouteGeometry,
    isSimulating,
  } = useRouteStore();
  const { isDrawerOpen, mapTheme } = useMapUiStore();

  const [isMapReady, setIsMapReady] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: buildBaseMapStyle(useMapUiStore.getState().mapTheme),
      center: [-122.4194, 37.7749],
      zoom: 12,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    // Zoom/locate controls are custom HeroUI components (<MapControls>)
    // instead of MapLibre's default NavigationControl, to match the app's
    // frosted-glass design system.

    // MapLibre sizes its canvas from the container's dimensions at
    // construction time only — it doesn't watch for later layout changes
    // (e.g. the drawer opening/closing, or the window itself resizing).
    // Without this, the canvas can be left stuck at a stale size.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainerRef.current);

    map.on("style.load", () => setIsMapReady(true));

    // Mode-aware click handling — read latest state to avoid stale closures
    map.on("click", (e) => {
      const store = useRouteStore.getState();
      switch (store.mapInteractionMode) {
        case "select-location":
          store.setPendingCoordinate({
            latitude: e.lngLat.lat,
            longitude: e.lngLat.lng,
          });
          break;
        case "draw-route": {
          store.addWaypoint({
            latitude: e.lngLat.lat,
            longitude: e.lngLat.lng,
          });
          const added = useRouteStore.getState().waypoints.at(-1);
          if (added) void reverseGeocodeWaypoint(added);
          void useRouteStore.getState().fetchRoadRoute();
          break;
        }
        case "navigate":
          break;
      }
    });

    // Don't yank the view away if the user already started navigating
    // before the (possibly slow) location lookup resolves.
    map.on("dragstart", () => {
      userInteractedRef.current = true;
    });
    map.on("zoomstart", () => {
      userInteractedRef.current = true;
    });

    // Center on the user's real location instead of the fixed default.
    void resolveUserLocation().then((location) => {
      if (!location || mapRef.current !== map) return;

      const lngLat: [number, number] = [
        location.coordinate.longitude,
        location.coordinate.latitude,
      ];

      // "You are here" dot — blue with a soft halo, draggable so the user
      // can reposition it; the new position is saved as the default home
      // location and used instead of IP geolocation on the next launch.
      const el = document.createElement("div");
      el.style.cssText = `
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #4285f4;
        border: 3px solid var(--color-background, #fff);
        box-shadow: 0 0 0 6px rgba(66, 133, 244, 0.25), 0 2px 6px rgba(0,0,0,0.4);
        cursor: grab;
      `;
      el.title = location.approximate
        ? "Your approximate location (IP-based) — drag to set your home location"
        : "Your location — drag to set your home location";
      userMarkerRef.current?.remove();
      const userMarker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(lngLat)
        .addTo(map);

      userMarker.on("dragstart", () => {
        el.style.cursor = "grabbing";
      });

      userMarker.on("dragend", () => {
        el.style.cursor = "grab";
        el.title = "Your home location — drag to change";
        const pos = userMarker.getLngLat();
        void window.api.setHomeLocation({
          coordinate: { latitude: pos.lat, longitude: pos.lng },
        });
      });

      userMarkerRef.current = userMarker;

      if (!userInteractedRef.current) {
        map.flyTo({
          center: lngLat,
          zoom: location.approximate ? 10 : 13,
          duration: 1500,
        });
      }
    });

    mapRef.current = map;

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      pendingMarkerRef.current = null;
      appliedMarkerRef.current = null;
      userMarkerRef.current = null;
    };
  }, []);

  // Hot-swap the map style when the user toggles dark/light theme.
  // Skip the very first render — the Map constructor already used the right style.
  // Setting isMapReady false then back to true (via style.load) re-triggers
  // all downstream effects so they re-add their markers and GL sources/layers.
  useEffect(() => {
    if (isFirstThemeApply.current) {
      isFirstThemeApply.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    setIsMapReady(false);
    map.setStyle(buildBaseMapStyle(mapTheme));
  }, [mapTheme]);

  // Pending (not yet injected) location marker — draggable
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;

    if (!pendingCoordinate) {
      pendingMarkerRef.current?.remove();
      pendingMarkerRef.current = null;
      return;
    }

    if (!pendingMarkerRef.current) {
      const el = document.createElement("div");
      el.style.cssText = `
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--color-accent, #3b82f6);
        border: 3px solid var(--color-background, #fff);
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        cursor: grab;
      `;
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([pendingCoordinate.longitude, pendingCoordinate.latitude])
        .addTo(map);

      // Update pending values on drag end only — no injection while dragging
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        useRouteStore.getState().setPendingCoordinate({
          latitude: pos.lat,
          longitude: pos.lng,
        });
      });

      pendingMarkerRef.current = marker;
    } else {
      pendingMarkerRef.current.setLngLat([
        pendingCoordinate.longitude,
        pendingCoordinate.latitude,
      ]);
    }
  }, [pendingCoordinate, isMapReady]);

  // Last successfully applied location marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;

    if (!lastAppliedCoordinate) {
      appliedMarkerRef.current?.remove();
      appliedMarkerRef.current = null;
      return;
    }

    if (!appliedMarkerRef.current) {
      const el = document.createElement("div");
      el.style.cssText = `
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--color-success, #22c55e);
        border: 3px solid var(--color-background, #fff);
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      `;
      appliedMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lastAppliedCoordinate.longitude, lastAppliedCoordinate.latitude])
        .addTo(map);
    } else {
      appliedMarkerRef.current.setLngLat([
        lastAppliedCoordinate.longitude,
        lastAppliedCoordinate.latitude,
      ]);
    }
  }, [lastAppliedCoordinate, isMapReady]);

  // Update markers when waypoints change
  useEffect(() => {
    if (!mapRef.current || !isMapReady) return;

    // Remove existing markers
    for (const marker of markersRef.current) {
      marker.remove();
    }
    markersRef.current = [];

    // Add new waypoint markers — the start and end points get a labeled
    // pin (address + START/END), matching Apple Maps' route markers;
    // everything in between stays a plain dot.
    waypoints.forEach((wp, index) => {
      const isStart = index === 0;
      const isEnd = index === waypoints.length - 1 && waypoints.length > 1;
      const isEndpoint = isStart || isEnd;

      const el = isEndpoint
        ? buildLabeledPinElement(wp.name, isStart ? "START" : "END")
        : buildDotMarkerElement();

      const marker = new maplibregl.Marker({ element: el, anchor: isEndpoint ? "bottom" : "center" })
        .setLngLat([wp.longitude, wp.latitude])
        .addTo(mapRef.current!);

      markersRef.current.push(marker);
    });

    // Update route lines
    updateRouteLine();
    updateRoadRouteLine();
  }, [waypoints, roadRouteGeometry, isMapReady]);

  /**
   * Straight-line preview connecting the raw waypoints — the immediate
   * feedback shown before (or if) the road-following route resolves. Once
   * `roadRouteGeometry` is available it takes over and this is removed,
   * since showing both at once is just clutter.
   */
  function updateRouteLine(): void {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = "route-line";
    const layerId = "route-line-layer";

    if (roadRouteGeometry) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      return;
    }

    const coordinates = waypoints.map((wp) => [wp.longitude, wp.latitude]);

    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      });
    } else if (coordinates.length >= 2) {
      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        },
      });

      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "var(--color-warning)",
          "line-width": 2,
          "line-dasharray": [2, 4],
          "line-opacity": 0.85,
        },
      });
    }
  }

  /**
   * The actual road-following route, once `route:getDirections` resolves —
   * rendered as a thick solid blue line, matching Apple Maps' route style.
   */
  function updateRoadRouteLine(): void {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = "road-route-line";
    const layerId = "road-route-line-layer";

    if (!roadRouteGeometry || roadRouteGeometry.length < 2) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      return;
    }

    const data: Feature<LineString> = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: roadRouteGeometry },
    };

    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(sourceId, { type: "geojson", data });

      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#3b82f6",
          "line-width": 6,
          "line-opacity": 0.9,
        },
      });
    }
  }

  const currentPos = playbackState?.currentPosition;

  // ── Simulation animation loop ──────────────────────────────────────────────
  // Runs entirely in the renderer: interpolates a position along the road-
  // following geometry at travel-mode speed, moves a marker on the map each
  // frame, and pushes the coordinate to the selected device every 500 ms.
  useEffect(() => {
    const map = mapRef.current;
    if (!isSimulating || !map || !isMapReady) return;

    const geometry = useRouteStore.getState().roadRouteGeometry;
    if (!geometry || geometry.length < 2) {
      useRouteStore.getState().stopSimulation();
      return;
    }

    // Pre-compute cumulative distances once per simulation start.
    const cumDist: number[] = [0];
    for (let i = 0; i < geometry.length - 1; i++) {
      cumDist.push(cumDist[i]! + distanceBetween(geometry[i]!, geometry[i + 1]!));
    }
    const totalDist = cumDist[cumDist.length - 1]!;

    // Moving dot marker — orange/red so it's visually distinct from waypoint pins.
    const el = document.createElement("div");
    el.style.cssText = `
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #ff8c42, #e84118 60%, #b5290f);
      border: 3px solid #fff;
      box-shadow: 0 0 0 4px rgba(232,65,24,0.3), 0 3px 8px rgba(0,0,0,0.5);
      pointer-events: none;
    `;
    const simMarker = new maplibregl.Marker({ element: el })
      .setLngLat(geometry[0]!)
      .addTo(map);
    simulatedMarkerRef.current = simMarker;

    let startTime: number | null = null;
    let lastLocationMs = 0;

    const animate = (timestamp: number): void => {
      if (startTime === null) startTime = timestamp;

      const { travelMode, carSpeedMph, setSimulationCoordinate, stopSimulation, setLocation } =
        useRouteStore.getState();
      const speed = travelMode === "car"
        ? carSpeedMph * 0.44704  // mph → m/s
        : DEFAULT_TRAVEL_SPEEDS_MPS[travelMode];
      const traveled = ((timestamp - startTime) / 1000) * speed;

      if (traveled >= totalDist) {
        // Reached the end — snap to final point and stop.
        const end = geometry[geometry.length - 1]!;
        simMarker.setLngLat(end);
        const coord = { latitude: end[1], longitude: end[0] };
        setSimulationCoordinate(coord);
        const devId = useDeviceStore.getState().selectedDeviceId;
        if (devId) void setLocation(devId, coord);
        stopSimulation();
        return;
      }

      const pos = interpolateAlongRoute(geometry, cumDist, traveled);
      simMarker.setLngLat(pos);

      // Throttle device location updates to avoid flooding IPC.
      if (timestamp - lastLocationMs >= 500) {
        lastLocationMs = timestamp;
        const coord = { latitude: pos[1], longitude: pos[0] };
        setSimulationCoordinate(coord);
        const devId = useDeviceStore.getState().selectedDeviceId;
        if (devId) void setLocation(devId, coord);
      }

      simRafRef.current = requestAnimationFrame(animate);
    };

    simRafRef.current = requestAnimationFrame(animate);

    return () => {
      if (simRafRef.current !== null) {
        cancelAnimationFrame(simRafRef.current);
        simRafRef.current = null;
      }
      simMarker.remove();
      simulatedMarkerRef.current = null;
    };
  }, [isSimulating, isMapReady]);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Map container */}
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />

      {/* Transparent, blurred drag strip — there's no opaque title bar, so
          this is what makes the window draggable from the top edge. The
          map stays visible (and pannable) everywhere below it. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: DRAG_STRIP_HEIGHT,
          WebkitAppRegion: "drag",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.04), rgba(0,0,0,0))",
          zIndex: 5,
        } as React.CSSProperties}
      />

      {/* Status chips */}
      <div
        style={{
          position: "absolute",
          top: SHELL_TOP,
          left: shellContentLeftInset(isDrawerOpen),
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 10,
          transition: "left 180ms ease",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        {/* While drawing, RouteInstructionBanner sits at this same spot and
            already communicates progress — skip the redundant chip. */}
        {waypoints.length > 0 && mapInteractionMode !== "draw-route" && (
          <Chip size="sm" color="default" variant="soft">
            {waypoints.length} waypoint{waypoints.length !== 1 ? "s" : ""}
          </Chip>
        )}
        {pendingCoordinate && mapInteractionMode === "select-location" && (
          <Chip size="sm" color="default" variant="soft">
            {pendingCoordinate.latitude.toFixed(5)}, {pendingCoordinate.longitude.toFixed(5)}
          </Chip>
        )}
      </div>

      {/* Coordinate display */}
      {currentPos && (
        <Card
          variant="default"
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            padding: "8px 12px",
          }}
        >
          <Code>
            {currentPos.latitude.toFixed(5)}°, {currentPos.longitude.toFixed(5)}°
          </Code>
        </Card>
      )}

      {/* Floating navigation shell — rail, drawer, and the always-visible
          selected-target indicator all live over the map, never replacing it. */}
      <PrimaryNavigationRail />
      <SecondaryDrawer />
      <RouteInstructionBanner />
      <SelectedTargetOverlay />
      <MapControls mapRef={mapRef} isMapReady={isMapReady} />
    </div>
  );
}
