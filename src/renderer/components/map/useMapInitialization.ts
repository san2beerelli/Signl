/**
 * Map Initialization
 *
 * Creates the MapLibre instance once on mount: base style, resize
 * handling, mode-aware click routing, and the draggable "you are here"
 * marker that seeds the saved home location.
 */

import { useEffect } from "react";
import type { RefObject } from "react";
import maplibregl from "maplibre-gl";
import { buildBaseMapStyle } from "@/components/map/buildBaseMapStyles.js";
import { resolveUserLocation } from "@/components/map/userLocation.js";
import { reverseGeocodeWaypoint } from "@/components/map/reverseGeocodeWaypoint.js";
import { useMapUiStore } from "@/state/mapUiStore.js";
import { useRouteStore } from "@/state/routeStore.js";

export const useMapInitialization = (
  mapContainerRef: RefObject<HTMLDivElement | null>,
  mapRef: RefObject<maplibregl.Map | null>,
  pendingMarkerRef: RefObject<maplibregl.Marker | null>,
  appliedMarkerRef: RefObject<maplibregl.Marker | null>,
  userMarkerRef: RefObject<maplibregl.Marker | null>,
  userInteractedRef: RefObject<boolean>,
  setIsMapReady: (ready: boolean) => void
): void => {
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
};
