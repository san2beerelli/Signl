/**
 * Selected Target Overlay
 *
 * Persistent bottom-of-map bar showing the currently selected simulator,
 * device, or browser. Positioned at the bottom of the map area, sliding
 * right when the drawer is open so it never sits behind it. Only renders
 * when a device is selected — no-selection state is left to the drawer.
 */

import { useState } from "react";
import type { JSX } from "react";
import { Button, Chip, Typography } from "@heroui/react";
import { useDeviceStore } from "@/state/deviceStore.js";
import { useRouteStore } from "@/state/routeStore.js";
import { useMapUiStore } from "@/state/mapUiStore.js";
import { shellContentLeftInset } from "@/components/mapShellLayout.js";
import { DeviceKindIcon, XIcon } from "@/icons.js";
import type { Coordinate, Device, DeviceKind, DeviceState } from "@shared/types/index.js";

const { Paragraph } = Typography;

type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

const CATEGORY_LABELS: Record<DeviceKind, string> = {
  "ios-simulator":   "iOS Simulator",
  "android-emulator":"Android Emulator",
  "ios-device":      "iOS Device",
  "android-device":  "Android Device",
  "browser-external":"External Browser",
};

const STATE_CHIP_COLOR: Record<DeviceState, ChipColor> = {
  connected: "success",
  busy:      "warning",
  offline:   "default",
  error:     "danger",
};

const STATE_LABELS: Record<DeviceState, string> = {
  connected: "Connected",
  busy:      "Busy",
  offline:   "Offline",
  error:     "Error",
};

const CAN_DIRECTLY_SET_LOCATION_KIND: Record<DeviceKind, boolean> = {
  "ios-simulator":    true,
  "android-emulator": true,
  "ios-device":       true,
  "android-device":   true,
  // Browsers support setLocation via CDP just like the other backends —
  // no reason to exclude them from this shortcut.
  "browser-external": true,
};

// ── Component ───────────────────────────────────────────────────────────────
export const SelectedTargetOverlay = (): JSX.Element | null => {
  const { getSelectedDevice, selectDevice } = useDeviceStore();
  const { activePlaybackId, setLocation } = useRouteStore();
  const { isDrawerOpen } = useMapUiStore();
  const [isSettingLocation, setIsSettingLocation] = useState(false);
  const [setLocationMessage, setSetLocationMessage] = useState<string | null>(null);

  const device: Device | undefined = getSelectedDevice();

  // Nothing selected — don't render the bar
  if (!device) return null;

  const canSetToUserLocation =
    CAN_DIRECTLY_SET_LOCATION_KIND[device.kind] &&
    device.state === "connected" &&
    device.capabilities.setLocation;

  const handleSetToUserLocation = async (): Promise<void> => {
    if (!device || !canSetToUserLocation) return;
    setIsSettingLocation(true);
    setSetLocationMessage(null);
    try {
      let coordinate: Coordinate | undefined;
      const homeLocation = await window.api.getHomeLocation();
      if (homeLocation.success && homeLocation.coordinate) {
        coordinate = homeLocation.coordinate;
      } else {
        const fallbackLocation = await window.api.getUserLocation();
        if (fallbackLocation.success && fallbackLocation.coordinate) {
          coordinate = fallbackLocation.coordinate;
        }
      }
      if (!coordinate) {
        setSetLocationMessage("Could not resolve your location.");
        return;
      }
      const ok = await setLocation(device.id, coordinate);
      setSetLocationMessage(ok ? "Location set ✓" : "Failed to set location.");
      if (ok) setTimeout(() => setSetLocationMessage(null), 3000);
    } finally {
      setIsSettingLocation(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        bottom: 40,
        left: shellContentLeftInset(isDrawerOpen),
        right: 12,
        zIndex: 15,
        transition: "left 180ms ease",
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      <div
        className="ls-panel"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          padding: "12px 16px",
          borderRadius: 14,
        }}
      >
        {/* Kind icon */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "rgba(59,130,246,0.12)",
            color: "var(--color-primary, #3b82f6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <DeviceKindIcon kind={device.kind} />
        </div>

        {/* Device info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Paragraph
              size="sm"
              style={{ margin: 0, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {device.name}
            </Paragraph>
            <Chip size="sm" color={STATE_CHIP_COLOR[device.state]} variant="soft">
              {activePlaybackId ? "Simulating" : STATE_LABELS[device.state]}
            </Chip>
          </div>
          <Paragraph size="xs" color="muted" style={{ margin: "2px 0 0" }}>
            {CATEGORY_LABELS[device.kind]}
            {device.metadata?.osVersion ? ` · ${device.metadata.osVersion}` : ""}
            {setLocationMessage ? ` · ${setLocationMessage}` : ""}
          </Paragraph>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          <span
            title={
              canSetToUserLocation
                ? "Set this device to your current map location"
                : "Connected targets with location support only"
            }
          >
            <Button
              size="sm"
              variant="primary"
              isDisabled={!canSetToUserLocation || isSettingLocation}
              onPress={handleSetToUserLocation}
            >
              {isSettingLocation ? "Setting…" : "Set User Location"}
            </Button>
          </span>
          <span title="Clear selection">
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label="Clear selection"
              onPress={() => selectDevice(null)}
            >
              <XIcon />
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
};
