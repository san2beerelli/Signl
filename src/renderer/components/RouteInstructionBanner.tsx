/**
 * Route Instruction Banner
 *
 * Floating panel shown while drawing a route on the map — replaces the
 * Routes drawer for the duration of route creation.
 */

import { useRef, useState } from "react";
import type { JSX } from "react";
import { Button, Input, Label, TextField, Typography } from "@heroui/react";
import { useRouteStore } from "@/state/routeStore.js";
import { useDeviceStore } from "@/state/deviceStore.js";
import { DRAWER_LEFT, DRAWER_WIDTH, SHELL_TOP } from "@/components/mapShellLayout.js";
import { BikeIcon, CarIcon, PlayIcon, SaveIcon, StopIcon, WalkIcon, XIcon } from "@/icons.js";
import type { TravelMode } from "@shared/types/index.js";

const { Heading, Paragraph } = Typography;

// ── Travel mode data ─────────────────────────────────────────────────────────
interface TravelModeOption {
  id: TravelMode;
  label: string;
  icon: JSX.Element;
}

const TRAVEL_MODES: TravelModeOption[] = [
  { id: "walk", label: "Walk", icon: <WalkIcon /> },
  { id: "bike", label: "Bike", icon: <BikeIcon /> },
  { id: "car",  label: "Car",  icon: <CarIcon />  },
];

const CAR_SPEED_PRESETS: Array<{ label: string; mph: number }> = [
  { label: "15 mph", mph: 15 },
  { label: "25 mph", mph: 25 },
  { label: "30 mph", mph: 30 },
  { label: "45 mph", mph: 45 },
  { label: "55 mph", mph: 55 },
  { label: "65 mph", mph: 65 },
  { label: "75 mph", mph: 75 },
];

const formatMiles = (meters: number): string => {
  const miles = meters / 1609.344;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
};

const formatDuration = (seconds: number): string => {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;
};

// ── Component ────────────────────────────────────────────────────────────────
export const RouteInstructionBanner = (): JSX.Element | null => {
  const {
    mapInteractionMode,
    waypoints,
    setMapInteractionMode,
    clearWaypoints,
    travelMode,
    setTravelMode,
    roadRouteDistanceMeters,
    roadRouteDurationSeconds,
    isSimulating,
    startSimulation,
    stopSimulation,
    saveCurrentRoute,
    openedSavedRouteName,
    carSpeedMph,
    setCarSpeedMph,
  } = useRouteStore();

  const { selectedDeviceId } = useDeviceStore();
  const [isSaveRouteDialogOpen, setIsSaveRouteDialogOpen] = useState(false);
  const [saveRouteName, setSaveRouteName] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  if (mapInteractionMode !== "draw-route") return null;

  const hasRoute = waypoints.length >= 2;
  const isOpenedFromSavedRoute = openedSavedRouteName !== null;
  const panelTitle = openedSavedRouteName ?? "Create a Custom Route";

  const handleCancel = (): void => {
    clearWaypoints();
    setMapInteractionMode("navigate");
    setIsSaveRouteDialogOpen(false);
    setSaveRouteName("");
    setSaveMessage(null);
  };

  const handleSimulate = (): void => {
    if (isSimulating) stopSimulation();
    else startSimulation();
  };

  const openSaveDialog = (): void => {
    setSaveMessage(null);
    setSaveRouteName(`Route ${new Date().toLocaleString()}`);
    if (panelRef.current) {
      setPanelHeight(panelRef.current.getBoundingClientRect().height);
    }
    setIsSaveRouteDialogOpen(true);
  };

  const handleSaveRoute = (): void => {
    const ok = saveCurrentRoute(saveRouteName);
    if (ok) {
      setSaveMessage("Route saved ✓");
      setIsSaveRouteDialogOpen(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  return (
    <>
      {/* ── Main panel ────────────────────────────────────────────────── */}
      <div
        ref={panelRef}
        className="ls-panel"
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          top: SHELL_TOP,
          left: DRAWER_LEFT,
          width: DRAWER_WIDTH,
          borderRadius: 14,
          zIndex: 19,
          WebkitAppRegion: "no-drag",
          overflow: "hidden",
        } as React.CSSProperties}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 12px 14px 16px",
          }}
        >
          <Heading level={6} style={{ margin: 0 }}>
            {panelTitle}
          </Heading>
          <span title="Cancel route creation">
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label="Cancel route creation"
              onPress={handleCancel}
            >
              <XIcon />
            </Button>
          </span>
        </div>

        {hasRoute ? (
          <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Travel mode picker */}
            <div style={{ display: "flex", gap: 6 }}>
              {TRAVEL_MODES.map((mode) => (
                <TravelModeButton
                  key={mode.id}
                  mode={mode}
                  isActive={travelMode === mode.id}
                  isDisabled={isSimulating}
                  onPress={() => setTravelMode(mode.id)}
                />
              ))}
            </div>

            {/* Car speed selector */}
            {travelMode === "car" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Paragraph size="xs" color="muted" style={{ margin: 0, whiteSpace: "nowrap" }}>
                  Speed
                </Paragraph>
                <select
                  id="car-speed-select"
                  value={carSpeedMph}
                  onChange={(e) => setCarSpeedMph(Number(e.target.value))}
                  disabled={isSimulating}
                  style={{
                    flex: 1,
                    background: "var(--card-bg)",
                    border: "1px solid var(--panel-border)",
                    borderRadius: 8,
                    color: "inherit",
                    fontSize: 13,
                    padding: "6px 10px",
                    cursor: isSimulating ? "not-allowed" : "pointer",
                    opacity: isSimulating ? 0.5 : 1,
                    outline: "none",
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                  }}
                >
                  {CAR_SPEED_PRESETS.map((preset) => (
                    <option key={preset.mph} value={preset.mph}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Distance / duration summary */}
            <div className="ls-card" style={{ padding: "12px 14px" }}>
              <Heading level={4} style={{ margin: "0 0 2px" }}>
                {roadRouteDistanceMeters !== null ? formatMiles(roadRouteDistanceMeters) : "—"}
              </Heading>
              <Paragraph size="sm" color="muted" style={{ margin: 0 }}>
                {roadRouteDurationSeconds !== null
                  ? formatDuration(roadRouteDurationSeconds)
                  : "Calculating…"}
              </Paragraph>
            </div>

            {saveMessage && (
              <Paragraph size="xs" color="muted" style={{ margin: 0 }}>
                {saveMessage}
              </Paragraph>
            )}

            {/* Action row */}
            <div style={{ display: "flex", gap: 8, justifyContent: isOpenedFromSavedRoute ? "center" : "stretch" }}>
              {!isOpenedFromSavedRoute && (
                <span title="Save this route" style={{ flex: 1 }}>
                  <Button variant="secondary" fullWidth onPress={openSaveDialog} style={{ gap: 6 } as React.CSSProperties}>
                    <SaveIcon /> Save
                  </Button>
                </span>
              )}
              <span
                title={
                  !selectedDeviceId
                    ? "Select a device to inject location during simulation"
                    : isSimulating
                      ? "Stop simulation"
                      : "Simulate movement along this route"
                }
                style={isOpenedFromSavedRoute ? { width: 180 } : { flex: 1 }}
              >
                <Button
                  variant={isSimulating ? "danger" : "primary"}
                  fullWidth
                  onPress={handleSimulate}
                  style={{ gap: 6 } as React.CSSProperties}
                >
                  {isSimulating ? <><StopIcon /> Stop</> : <><PlayIcon /> Simulate</>}
                </Button>
              </span>
            </div>
          </div>
        ) : (
          <div style={{ padding: "0 16px 20px" }}>
            <div
              className="ls-card"
              style={{
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                alignItems: "center",
                textAlign: "center",
              }}
            >
              {/* Map-pin icon */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <Paragraph size="sm" color="muted" style={{ margin: 0 }}>
                {waypoints.length === 0
                  ? "Tap on the map to add your starting point"
                  : "Tap a second point to continue your route"}
              </Paragraph>
            </div>
          </div>
        )}
      </div>

      {/* ── Save route dialog ─────────────────────────────────────────── */}
      {isSaveRouteDialogOpen && (
        <div
          className="ls-panel"
          role="dialog"
          aria-label="Save route"
          style={{
            position: "absolute",
            top: SHELL_TOP,
            left: DRAWER_LEFT,
            width: DRAWER_WIDTH,
            height: panelHeight !== null ? panelHeight : undefined,
            borderRadius: 14,
            zIndex: 20,
            WebkitAppRegion: "no-drag",
            overflow: "hidden",
          } as React.CSSProperties}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 12px 10px 16px",
            }}
          >
            <Heading level={6} style={{ margin: 0 }}>
              Save Route
            </Heading>
            <span title="Close">
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                aria-label="Close"
                onPress={() => setIsSaveRouteDialogOpen(false)}
              >
                <XIcon />
              </Button>
            </span>
          </div>

          <div
            style={{
              padding: "4px 16px 16px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              height: "calc(100% - 54px)",
              justifyContent: "center",
            }}
          >
            <div style={{ width: "100%", maxWidth: 280, display: "flex", flexDirection: "column", gap: 12 }}>
              <TextField
                value={saveRouteName}
                onChange={(value: string) => setSaveRouteName(value)}
                fullWidth
              >
                <Label>Route name</Label>
                <Input placeholder="My Route" />
              </TextField>

              <Button
                variant="primary"
                fullWidth
                onPress={handleSaveRoute}
                isDisabled={saveRouteName.trim().length === 0}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ── Travel mode button ───────────────────────────────────────────────────────
interface TravelModeButtonProps {
  mode: TravelModeOption;
  isActive: boolean;
  isDisabled: boolean;
  onPress: () => void;
}

const TravelModeButton = ({ mode, isActive, isDisabled, onPress }: TravelModeButtonProps): JSX.Element => (
  <span title={mode.label} style={{ flex: 1 }}>
    <Button
      variant={isActive ? "primary" : "secondary"}
      aria-label={mode.label}
      onPress={onPress}
      isDisabled={isDisabled}
      fullWidth
      style={
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "8px 10px",
          height: "auto",
        } as React.CSSProperties
      }
    >
      <span aria-hidden="true" style={{ lineHeight: 1, display: "flex", justifyContent: "center" }}>
        {mode.icon}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>{mode.label}</span>
    </Button>
  </span>
);
