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
import { useMapInitialization } from "@/components/map/useMapInitialization.js";
import { usePendingLocationMarker, useAppliedLocationMarker } from "@/components/map/useLocationMarkers.js";
import { useWaypointMarkers } from "@/components/map/useWaypointMarkers.js";
import { useRouteLines } from "@/components/map/useRouteLines.js";
import { useRouteSimulation } from "@/components/map/useRouteSimulation.js";
import { PrimaryNavigationRail } from "@/components/PrimaryNavigationRail.js";
import { SecondaryDrawer } from "@/components/SecondaryDrawer.js";
import { SelectedTargetOverlay } from "@/components/SelectedTargetOverlay.js";
import { RouteInstructionBanner } from "@/components/RouteInstructionBanner.js";
import { MapControls } from "@/components/MapControls.js";
import { DRAG_STRIP_HEIGHT, SHELL_TOP, shellContentLeftInset } from "@/components/mapShellLayout.js";

const { Code } = Typography;

export const MainScreen = (): JSX.Element => {
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
};

const MapArea = (): JSX.Element => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const pendingMarkerRef = useRef<maplibregl.Marker | null>(null);
  const appliedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const simulatedMarkerRef = useRef<maplibregl.Marker | null>(null);
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

  useMapInitialization(
    mapContainerRef,
    mapRef,
    pendingMarkerRef,
    appliedMarkerRef,
    userMarkerRef,
    userInteractedRef,
    setIsMapReady
  );

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

  usePendingLocationMarker(mapRef, pendingMarkerRef, pendingCoordinate, isMapReady);
  useAppliedLocationMarker(mapRef, appliedMarkerRef, lastAppliedCoordinate, isMapReady);
  useWaypointMarkers(mapRef, markersRef, waypoints, isMapReady);
  useRouteLines(mapRef, waypoints, roadRouteGeometry, isMapReady);
  useRouteSimulation(mapRef, simulatedMarkerRef, isSimulating, isMapReady);

  const currentPos = playbackState?.currentPosition;

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
};
