/**
 * Target List
 *
 * Shared list rendering for the Simulators/Devices/Browsers drawers. Each
 * one filters `deviceStore`'s flat device list down to its own `DeviceKind`s
 * and renders through this component.
 */

import type { JSX } from "react";
import { Button, Chip, EmptyState, ScrollShadow, Separator, Typography } from "@heroui/react";
import { useDeviceStore } from "@/state/deviceStore.js";
import { RefreshIcon } from "@/icons.js";
import type { Device, DeviceKind } from "@shared/types/index.js";

const { Heading, Paragraph } = Typography;

type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

const STATE_CHIP_COLOR: Record<Device["state"], ChipColor> = {
  connected: "success",
  busy:      "warning",
  offline:   "default",
  error:     "danger",
};

const STATE_LABELS: Record<Device["state"], string> = {
  connected: "Connected",
  busy:      "Busy",
  offline:   "Offline",
  error:     "Error",
};

interface TargetListProps {
  kinds: DeviceKind[];
  emptyTitle: string;
  emptyHint: string;
}

export const TargetList = ({ kinds, emptyTitle, emptyHint }: TargetListProps): JSX.Element => {
  const { devices, selectedDeviceId, selectDevice, refreshDevices, isLoading, error } =
    useDeviceStore();

  const filtered = devices.filter((device) => kinds.includes(device.kind));

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Sub-header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px 12px",
        }}
      >
        <Paragraph size="xs" color="muted" style={{ margin: 0 }}>
          {filtered.length} {filtered.length === 1 ? "target" : "targets"} found
        </Paragraph>
        <span title="Refresh list">
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="Refresh"
            onPress={() => refreshDevices()}
            isDisabled={isLoading}
          >
            <RefreshIcon />
          </Button>
        </span>
      </div>

      <Separator />

      <ScrollShadow style={{ flex: 1, padding: "8px 8px" }}>
        {error && (
          <Paragraph
            size="xs"
            style={{ margin: "8px 8px 0", color: "var(--color-danger, #ef4444)" }}
          >
            {error}
          </Paragraph>
        )}

        {filtered.length === 0 && !isLoading && (
          <EmptyState>
            <div style={{ textAlign: "center", padding: "32px 16px" }}>
              <Heading level={6} style={{ marginBottom: 6 }}>
                {emptyTitle}
              </Heading>
              <Paragraph size="sm" color="muted" style={{ marginBottom: 16, whiteSpace: "pre-line" }}>
                {emptyHint}
              </Paragraph>
              <Button size="sm" variant="secondary" onPress={() => refreshDevices()}>
                Refresh
              </Button>
            </div>
          </EmptyState>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              isSelected={device.id === selectedDeviceId}
              onSelect={() => selectDevice(device.id)}
            />
          ))}
        </div>
      </ScrollShadow>
    </div>
  );
};

interface DeviceCardProps {
  device: Device;
  isSelected: boolean;
  onSelect: () => void;
}

const DeviceCard = ({ device, isSelected, onSelect }: DeviceCardProps): JSX.Element => {
  // For simulators/emulators the meaningful status is whether the instance is
  // booted, not the generic connection state. For physical devices and browsers
  // fall back to the connection state.
  const isSimulator =
    device.kind === "ios-simulator" || device.kind === "android-emulator";

  const chipLabel: string = (() => {
    if (isSimulator) {
      if (device.metadata?.isBooted === true) return "Booted";
      if (device.metadata?.isBooted === false) return "Shutdown";
    }
    return STATE_LABELS[device.state];
  })();

  const chipColor: ChipColor = (() => {
    if (isSimulator) {
      if (device.metadata?.isBooted === true) return "success";
      if (device.metadata?.isBooted === false) return "default";
    }
    return STATE_CHIP_COLOR[device.state];
  })();

  // Subtitle: OS version + capability caveats. Skip "Booted/Shutdown" text
  // since the chip already communicates that.
  const subtitle = [
    device.metadata?.osVersion,
    !device.capabilities.setLocation ? "No location" : null,
    device.capabilities.setLocation && !device.capabilities.routePlayback ? "No routes" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`ls-card${isSelected ? " ls-card-selected" : ""}`}
      style={{ cursor: "pointer", padding: "12px 14px" }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
      aria-pressed={isSelected}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Text block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Paragraph
            size="sm"
            style={{
              margin: 0,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.35,
            }}
          >
            {device.name}
          </Paragraph>
          {subtitle && (
            <Paragraph
              size="xs"
              color="muted"
              style={{ margin: "2px 0 0", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {subtitle}
            </Paragraph>
          )}
        </div>

        {/* Status chip */}
        <Chip size="sm" color={chipColor} variant="soft" style={{ flexShrink: 0 }}>
          {chipLabel}
        </Chip>
      </div>
    </div>
  );
};
