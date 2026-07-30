/**
 * Location Markers
 *
 * Two lightweight marker hooks for the coordinate-editing flow: the
 * draggable "pending" location (not yet sent to the device) and the
 * "last applied" location that was actually injected.
 */

import { useEffect } from "react";
import type { RefObject } from "react";
import maplibregl from "maplibre-gl";
import { useRouteStore } from "@/state/routeStore.js";
import type { Coordinate } from "@shared/types/index.js";

export const usePendingLocationMarker = (
  mapRef: RefObject<maplibregl.Map | null>,
  pendingMarkerRef: RefObject<maplibregl.Marker | null>,
  pendingCoordinate: Coordinate | null,
  isMapReady: boolean
): void => {
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
  }, [mapRef, pendingMarkerRef, pendingCoordinate, isMapReady]);
};

export const useAppliedLocationMarker = (
  mapRef: RefObject<maplibregl.Map | null>,
  appliedMarkerRef: RefObject<maplibregl.Marker | null>,
  lastAppliedCoordinate: Coordinate | null,
  isMapReady: boolean
): void => {
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
  }, [mapRef, appliedMarkerRef, lastAppliedCoordinate, isMapReady]);
};
