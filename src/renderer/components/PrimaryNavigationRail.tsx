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
import {
  RAIL_WIDTH,
  SHELL_MARGIN,
  SHELL_TOP,
} from "@/components/mapShellLayout.js";
import { EnvironmentCheckModal } from "@/components/EnvironmentCheckModal.js";

// ── SVG Icons ──────────────────────────────────────────────────────────────
function MonitorIcon(): JSX.Element {
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function SmartphoneIcon(): JSX.Element {
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GlobeIcon(): JSX.Element {
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function RouteIcon(): JSX.Element {
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg
      width="25"
      height="25"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SunIcon(): JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon(): JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// ── Rail data ───────────────────────────────────────────────────────────────
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

// ── Component ───────────────────────────────────────────────────────────────
export function PrimaryNavigationRail(): JSX.Element {
  const { activeSection, selectSection, mapTheme, toggleMapTheme } =
    useMapUiStore();
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
        style={{
          width: 42,
          height: 42,
          marginBottom: 10,
          flexShrink: 0,
          objectFit: "contain",
        }}
      />

      <Separator style={{ width: "100%", marginBottom: 10 }} />

      {/* Target sections */}
      <nav
        aria-label="Target sections"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          width: "100%",
        }}
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

      {/* Theme toggle */}
      <span
        title={
          mapTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"
        }
        style={{ width: "100%", marginTop: 4 }}
      >
        <Button
          variant="ghost"
          aria-label={
            mapTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          onPress={toggleMapTheme}
          style={
            {
              width: "100%",
              height: 46,
              padding: 0,
              opacity: 0.7,
            } as React.CSSProperties
          }
        >
          <span
            aria-hidden="true"
            style={{ lineHeight: 1, display: "flex", justifyContent: "center" }}
          >
            {mapTheme === "dark" ? <SunIcon /> : <MoonIcon />}
          </span>
        </Button>
      </span>

      <EnvironmentCheckModal
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  );
}

function RailButton({
  icon,
  label,
  isActive,
  onPress,
}: {
  icon: JSX.Element;
  label: string;
  isActive: boolean;
  onPress: () => void;
}): JSX.Element {
  return (
    <Button
      variant={isActive ? "primary" : "ghost"}
      aria-label={label}
      isIconOnly
      onPress={onPress}
      size="lg"
    >
      <span
        aria-hidden="true"
        style={{ lineHeight: 1, display: "flex", justifyContent: "center" }}
      >
        {icon}
      </span>
    </Button>
  );
}
