/**
 * Secondary Drawer
 *
 * Opens beside the primary rail and hosts section-specific content
 * (Simulators/Devices/Browsers/Routes). It floats over the map — never
 * replaces it — and can be collapsed independently of the rail.
 */

import { useEffect } from "react";
import type { JSX, ReactNode } from "react";
import { Button, Typography } from "@heroui/react";
import { useMapUiStore } from "@/state/mapUiStore.js";
import type { NavSection } from "@/state/mapUiStore.js";
import { DRAWER_LEFT, DRAWER_WIDTH, SHELL_MARGIN, SHELL_TOP } from "@/components/mapShellLayout.js";
import { SimulatorsDrawer } from "@/components/drawers/SimulatorsDrawer.js";
import { DevicesDrawer } from "@/components/drawers/DevicesDrawer.js";
import { BrowsersDrawer } from "@/components/drawers/BrowsersDrawer.js";
import { RoutesDrawer } from "@/components/drawers/RoutesDrawer.js";

const { Heading } = Typography;

const SECTION_TITLES: Record<Exclude<NavSection, null>, string> = {
  simulators: "Simulators",
  devices: "Devices",
  browsers: "Browsers",
  routes: "Routes",
};

export const SecondaryDrawer = (): JSX.Element | null => {
  const { activeSection, isDrawerOpen, closeDrawer } = useMapUiStore();

  // Escape closes the active drawer.
  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDrawerOpen, closeDrawer]);

  // Unmount (rather than just hide) while closed so its buttons drop out of
  // the tab order — a translated-away panel would otherwise still be
  // keyboard-focusable.
  if (!isDrawerOpen || !activeSection) return null;

  const title = SECTION_TITLES[activeSection];

  return (
    <div
      className="ls-panel"
      role="region"
      aria-label={`${title} panel`}
      style={{
        position: "absolute",
        top: SHELL_TOP,
        bottom: SHELL_MARGIN,
        left: DRAWER_LEFT,
        width: DRAWER_WIDTH,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 19,
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 12px 14px 16px",
          flexShrink: 0,
        }}
      >
        <Heading level={6} style={{ margin: 0 }}>
          {title}
        </Heading>
        <span title="Close">
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="Close panel"
            onPress={closeDrawer}
          >
            ✕
          </Button>
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {renderSection(activeSection)}
      </div>
    </div>
  );
};

const renderSection = (section: NavSection): ReactNode => {
  switch (section) {
    case "simulators":
      return <SimulatorsDrawer />;
    case "devices":
      return <DevicesDrawer />;
    case "browsers":
      return <BrowsersDrawer />;
    case "routes":
      return <RoutesDrawer />;
    default:
      return null;
  }
};
