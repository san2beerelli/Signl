/**
 * Browsers Drawer
 *
 * Lists installed Chromium-based browsers. Browsers that are connected
 * show a "Disconnect" button; disconnected ones show a "Connect" button
 * that launches them with remote debugging enabled.
 */

import { useState, type JSX } from "react";
import { Button, Chip, Separator, ScrollShadow, Typography } from "@heroui/react";
import { useDeviceStore } from "@/state/deviceStore.js";
import type { Device } from "@shared/types/index.js";

const { Paragraph, Heading } = Typography;

function RefreshIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
      <path d="M21 3v5h-5"/>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
      <path d="M8 16H3v5"/>
    </svg>
  );
}

function GlobeIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
      <path d="M2 12h20"/>
    </svg>
  );
}

function browserIdFromDeviceId(deviceId: string): string {
  return deviceId.replace("browser-external-", "");
}

function BrowserCard({
  device,
  isSelected,
  onSelect,
  onConnect,
  onDisconnect,
}: {
  device: Device;
  isSelected: boolean;
  onSelect: () => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}): JSX.Element {
  const [isBusy, setIsBusy] = useState(false);
  const isConnected = device.state === "connected";
  const portHint = device.metadata?.model; // e.g. "CDP :9222"

  const handleAction = async (fn: () => Promise<void>) => {
    setIsBusy(true);
    try { await fn(); } finally { setIsBusy(false); }
  };

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
        <div style={{ flexShrink: 0, opacity: isConnected ? 1 : 0.45 }}>
          <GlobeIcon />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Paragraph
            size="sm"
            style={{ margin: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.35 }}
          >
            {device.name}
          </Paragraph>
          <Paragraph size="xs" color="muted" style={{ margin: "2px 0 0", lineHeight: 1.3 }}>
            {isConnected && portHint ? portHint : "Not connected"}
          </Paragraph>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <Chip size="sm" color={isConnected ? "success" : "default"} variant="soft">
            {isConnected ? "Connected" : "Offline"}
          </Chip>

          <span
            title={isConnected ? "Disconnect" : "Connect"}
            onClick={(e) => e.stopPropagation()}
          >
            {isConnected ? (
              <Button
                size="sm"
                variant="ghost"
                isDisabled={isBusy}
                onPress={() => handleAction(onDisconnect)}
                style={isBusy ? { opacity: 0.5 } : { color: "var(--color-danger, #ef4444)" }}
              >
                {isBusy ? "…" : "Disconnect"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                isDisabled={isBusy}
                onPress={() => handleAction(onConnect)}
                style={isBusy ? { opacity: 0.5 } : {}}
              >
                {isBusy ? "…" : "Connect"}
              </Button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export function BrowsersDrawer(): JSX.Element {
  const { devices, selectedDeviceId, selectDevice, refreshDevices, isLoading } =
    useDeviceStore();

  const browsers = devices.filter((d) => d.kind === "browser-external");

  const handleConnect = async (device: Device) => {
    const browserId = browserIdFromDeviceId(device.id);
    const result = await window.api.connectBrowser({ browserId });
    if (result.success) {
      await refreshDevices();
      if (result.device) selectDevice(result.device.id);
    }
  };

  const handleDisconnect = async (device: Device) => {
    await window.api.disconnectBrowser({ deviceId: device.id });
    await refreshDevices();
    if (selectedDeviceId === device.id) selectDevice(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Sub-header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 12px" }}>
        <Paragraph size="xs" color="muted" style={{ margin: 0 }}>
          {browsers.length} {browsers.length === 1 ? "browser" : "browsers"} found
        </Paragraph>
        <span title="Refresh list">
          <Button size="sm" variant="ghost" isIconOnly aria-label="Refresh" onPress={() => refreshDevices()} isDisabled={isLoading}>
            <RefreshIcon />
          </Button>
        </span>
      </div>

      <Separator />

      <ScrollShadow style={{ flex: 1, padding: "8px 8px" }}>
        {browsers.length === 0 && !isLoading ? (
          <div style={{ textAlign: "center", padding: "32px 16px" }}>
            <Heading level={6} style={{ marginBottom: 6 }}>No browsers found</Heading>
            <Paragraph size="sm" color="muted" style={{ marginBottom: 16 }}>
              {"Install Google Chrome, Edge, Brave,\nArc, or Chromium to get started."}
            </Paragraph>
            <Button size="sm" variant="secondary" onPress={() => refreshDevices()}>
              Refresh
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {browsers.map((d) => (
              <BrowserCard
                key={d.id}
                device={d}
                isSelected={d.id === selectedDeviceId}
                onSelect={() => selectDevice(d.id)}
                onConnect={() => handleConnect(d)}
                onDisconnect={() => handleDisconnect(d)}
              />
            ))}
          </div>
        )}
      </ScrollShadow>
    </div>
  );
}
