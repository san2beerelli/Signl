/**
 * Primary Navigation Rail
 *
 * Always-visible rail floating over the map's left edge — same top/bottom
 * extent, background, corner radius, and shadow as `SecondaryDrawer`, so
 * the two floating shell panels read as one consistent system. Holds target
 * category icons (Simulators / Devices / Browsers), a Routes shortcut,
 * Settings, and the dark/light map theme toggle.
 */

import { useState } from "react";
import type { JSX } from "react";
import { Button, Separator } from "@heroui/react";
import { useMapUiStore } from "@/state/mapUiStore.js";
import type { NavSection } from "@/state/mapUiStore.js";
import { RAIL_WIDTH, SHELL_MARGIN, SHELL_TOP } from "@/components/mapShellLayout.js";
import { EnvironmentCheckModal } from "@/components/EnvironmentCheckModal.js";
import { GlobeIcon, MonitorIcon, MoonIcon, RouteIcon, SettingsIcon, SmartphoneIcon, SunIcon } from "@/icons.js";

interface RailItem {
  id: Exclude<NavSection, null>;
  label: string;
  icon: JSX.Element;
}

const TARGET_ITEMS: RailItem[] = [
  { id: "simulators", label: "Simulators", icon: <MonitorIcon /> },
  { id: "devices", label: "Devices", icon: <SmartphoneIcon /> },
  { id: "browsers", label: "Browsers", icon: <GlobeIcon /> },
];

const ROUTES_ITEM: RailItem = {
  id: "routes",
  label: "Routes",
  icon: <RouteIcon />,
};

const APP_LOGO_URL = new URL("../../assets/logo1.svg", import.meta.url).href;

export const PrimaryNavigationRail = (): JSX.Element => {
  const { activeSection, selectSection, mapTheme, toggleMapTheme } = useMapUiStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div
      className="ls-panel"
      aria-label="Primary navigation"
      style={
        {
          position: "absolute",
          top: SHELL_TOP,
          bottom: SHELL_MARGIN,
          left: SHELL_MARGIN,
          width: RAIL_WIDTH,
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "12px 6px",
          zIndex: 20,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties
      }
    >
      <img
        src={APP_LOGO_URL}
        alt="Signl"
        style={{ width: 42, height: 42, marginBottom: 10, flexShrink: 0, objectFit: "contain" }}
      />

      <Separator style={{ width: "100%", marginBottom: 10 }} />

      <nav
        aria-label="Target sections"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: "100%" }}
      >
        {TARGET_ITEMS.map((item) => (
          <RailButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            isActive={activeSection === item.id}
            onPress={() => selectSection(item.id)}
          />
        ))}
        <RailButton
          icon={ROUTES_ITEM.icon}
          label={ROUTES_ITEM.label}
          isActive={activeSection === ROUTES_ITEM.id}
          onPress={() => selectSection(ROUTES_ITEM.id)}
        />
        <RailButton
          icon={<SettingsIcon />}
          label="Settings"
          isActive={isSettingsOpen}
          onPress={() => setIsSettingsOpen(true)}
        />
      </nav>

      <div style={{ flex: 1 }} />

      <span
        title={mapTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        style={{ width: "100%", marginTop: 4 }}
      >
        <Button
          variant="ghost"
          aria-label={mapTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onPress={toggleMapTheme}
          style={{ width: "100%", height: 46, padding: 0, opacity: 0.7 } as React.CSSProperties}
        >
          <span aria-hidden="true" style={{ lineHeight: 1, display: "flex", justifyContent: "center" }}>
            {mapTheme === "dark" ? <SunIcon /> : <MoonIcon />}
          </span>
        </Button>
      </span>

      <EnvironmentCheckModal isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </div>
  );
};

interface RailButtonProps {
  icon: JSX.Element;
  label: string;
  isActive: boolean;
  onPress: () => void;
}

const RailButton = ({ icon, label, isActive, onPress }: RailButtonProps): JSX.Element => (
  <Button variant={isActive ? "primary" : "ghost"} aria-label={label} isIconOnly onPress={onPress} size="lg">
    <span aria-hidden="true" style={{ lineHeight: 1, display: "flex", justifyContent: "center" }}>
      {icon}
    </span>
  </Button>
);
