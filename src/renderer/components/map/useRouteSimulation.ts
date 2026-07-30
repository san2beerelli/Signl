/**
 * Route Simulation
 *
 * Runs the marker-along-route animation for "Simulate" playback: computes
 * cumulative distances once per run, then each frame interpolates a
 * position at travel-mode speed, moves the on-map marker, and throttles
 * pushing the coordinate to the selected device to twice a second.
 */

import { useEffect } from "react";
import type { RefObject } from "react";
import maplibregl from "maplibre-gl";
import { distanceBetween, interpolateAlongRoute } from "@/components/map/geoMath.js";
import { useDeviceStore } from "@/state/deviceStore.js";
import { useRouteStore } from "@/state/routeStore.js";
import { DEFAULT_TRAVEL_SPEEDS_MPS } from "@shared/types/index.js";

/** mph → m/s */
const MPH_TO_MPS = 0.44704;
/** How often a moving-marker position is pushed to the selected device. */
const LOCATION_PUSH_INTERVAL_MS = 500;

export const useRouteSimulation = (
  mapRef: RefObject<maplibregl.Map | null>,
  simulatedMarkerRef: RefObject<maplibregl.Marker | null>,
  isSimulating: boolean,
  isMapReady: boolean
): void => {
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
    let rafId: number | null = null;

    const animate = (timestamp: number): void => {
      if (startTime === null) startTime = timestamp;

      const { travelMode, carSpeedMph, setSimulationCoordinate, stopSimulation, setLocation } =
        useRouteStore.getState();
      const speed =
        travelMode === "car" ? carSpeedMph * MPH_TO_MPS : DEFAULT_TRAVEL_SPEEDS_MPS[travelMode];
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
      if (timestamp - lastLocationMs >= LOCATION_PUSH_INTERVAL_MS) {
        lastLocationMs = timestamp;
        const coord = { latitude: pos[1], longitude: pos[0] };
        setSimulationCoordinate(coord);
        const devId = useDeviceStore.getState().selectedDeviceId;
        if (devId) void setLocation(devId, coord);
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      simMarker.remove();
      simulatedMarkerRef.current = null;
    };
  }, [mapRef, simulatedMarkerRef, isSimulating, isMapReady]);
};
