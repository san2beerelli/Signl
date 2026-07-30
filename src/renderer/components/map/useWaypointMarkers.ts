/**
 * Waypoint Markers
 *
 * Renders a marker per waypoint — a labeled pin for the route's start and
 * end points, a plain dot for everything in between — replacing the full
 * set whenever the waypoint list changes.
 */

import { useEffect } from "react";
import type { RefObject } from "react";
import maplibregl from "maplibre-gl";
import { buildDotMarkerElement, buildLabeledPinElement } from "@/components/map/waypointMarkerElements.js";
import type { Waypoint } from "@shared/types/index.js";

export const useWaypointMarkers = (
  mapRef: RefObject<maplibregl.Map | null>,
  markersRef: RefObject<maplibregl.Marker[]>,
  waypoints: Waypoint[],
  isMapReady: boolean
): void => {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;

    for (const marker of markersRef.current) {
      marker.remove();
    }
    markersRef.current = [];

    // The start and end points get a labeled pin (address + START/END),
    // matching Apple Maps' route markers; everything in between stays a
    // plain dot.
    waypoints.forEach((wp, index) => {
      const isStart = index === 0;
      const isEnd = index === waypoints.length - 1 && waypoints.length > 1;
      const isEndpoint = isStart || isEnd;

      const el = isEndpoint
        ? buildLabeledPinElement(wp.name, isStart ? "START" : "END")
        : buildDotMarkerElement();

      const marker = new maplibregl.Marker({ element: el, anchor: isEndpoint ? "bottom" : "center" })
        .setLngLat([wp.longitude, wp.latitude])
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [mapRef, markersRef, waypoints, isMapReady]);
};
