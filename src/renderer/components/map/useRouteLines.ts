/**
 * Route Lines
 *
 * Draws the two route line layers on the map: a dashed straight-line
 * preview connecting raw waypoints (shown until a road-following route
 * resolves), and the solid road route once available.
 */

import { useEffect } from "react";
import type { RefObject } from "react";
import maplibregl from "maplibre-gl";
import type { Feature, LineString } from "geojson";
import type { Waypoint } from "@shared/types/index.js";

const updatePreviewLine = (
  map: maplibregl.Map,
  waypoints: Waypoint[],
  roadRouteGeometry: [number, number][] | null
): void => {
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
};

const updateRoadRouteLine = (map: maplibregl.Map, roadRouteGeometry: [number, number][] | null): void => {
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
};

export const useRouteLines = (
  mapRef: RefObject<maplibregl.Map | null>,
  waypoints: Waypoint[],
  roadRouteGeometry: [number, number][] | null,
  isMapReady: boolean
): void => {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;

    updatePreviewLine(map, waypoints, roadRouteGeometry);
    updateRoadRouteLine(map, roadRouteGeometry);
  }, [mapRef, waypoints, roadRouteGeometry, isMapReady]);
};
