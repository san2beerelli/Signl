/**
 * Map Controls
 *
 * HeroUI-styled replacements for MapLibre's default zoom/locate controls —
 * matches the app's frosted-glass panel look instead of MapLibre's plain
 * default buttons. Sits where the native NavigationControl used to (top
 * right), clear of the drag strip and traffic lights.
 */

import type { JSX, RefObject } from "react";
import { Button } from "@heroui/react";
import type maplibregl from "maplibre-gl";
import { SHELL_MARGIN, SHELL_TOP } from "@/components/mapShellLayout.js";
import { resolveUserLocation } from "@/components/map/userLocation.js";
import { LocateIcon, MinusIcon, PlusIcon } from "@/icons.js";

// ── Component ────────────────────────────────────────────────────────────────
interface MapControlsProps {
  mapRef: RefObject<maplibregl.Map | null>;
  isMapReady: boolean;
}

export const MapControls = ({ mapRef, isMapReady }: MapControlsProps): JSX.Element => {
  const handleZoomIn = (): void => {
    mapRef.current?.zoomIn({ duration: 200 });
  };

  const handleZoomOut = (): void => {
    mapRef.current?.zoomOut({ duration: 200 });
  };

  // Same priority chain used to center the map at startup: saved home
  // location, then browser geolocation, then IP-based estimate.
  const handleLocate = async (): Promise<void> => {
    const location = await resolveUserLocation();
    if (!location || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [location.coordinate.longitude, location.coordinate.latitude],
      zoom: location.approximate ? 12 : 14,
      duration: 800,
    });
  };

  return (
    <div
      className="ls-panel"
      role="group"
      aria-label="Map controls"
      style={
        {
          position: "absolute",
          top: SHELL_TOP,
          right: SHELL_MARGIN,
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          overflow: "hidden",
          zIndex: 10,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties
      }
    >
      <span title="Zoom in">
        <Button
          variant="ghost"
          isIconOnly
          aria-label="Zoom in"
          isDisabled={!isMapReady}
          onPress={handleZoomIn}
          style={{ borderRadius: 0 } as React.CSSProperties}
        >
          <PlusIcon />
        </Button>
      </span>

      <div style={{ width: "100%", height: 1, background: "var(--panel-border)" }} />

      <span title="Zoom out">
        <Button
          variant="ghost"
          isIconOnly
          aria-label="Zoom out"
          isDisabled={!isMapReady}
          onPress={handleZoomOut}
          style={{ borderRadius: 0 } as React.CSSProperties}
        >
          <MinusIcon />
        </Button>
      </span>

      <div style={{ width: "100%", height: 1, background: "var(--panel-border)" }} />

      <span title="Locate me">
        <Button
          variant="ghost"
          isIconOnly
          aria-label="Locate me"
          isDisabled={!isMapReady}
          onPress={() => void handleLocate()}
          style={{ borderRadius: 0 } as React.CSSProperties}
        >
          <LocateIcon />
        </Button>
      </span>
    </div>
  );
};
