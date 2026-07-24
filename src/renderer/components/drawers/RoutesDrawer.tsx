/**
 * Routes Drawer
 *
 * Entry point into route creation + saved-route management.
 */

import { useEffect } from "react";
import type { JSX } from "react";
import { Button, Separator, Typography } from "@heroui/react";
import { useRouteStore } from "@/state/routeStore.js";
import { useMapUiStore } from "@/state/mapUiStore.js";

const { Paragraph } = Typography;

function formatSavedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Route icon
function RouteIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>
      <circle cx="18" cy="5" r="3"/>
    </svg>
  );
}

// Trash icon
function TrashIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}

// Play icon
function PlayIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  );
}

export function RoutesDrawer(): JSX.Element {
  const {
    setMapInteractionMode,
    clearWaypoints,
    savedRoutes,
    loadSavedRoutes,
    openSavedRoute,
    deleteSavedRoute,
  } = useRouteStore();
  const { closeDrawer } = useMapUiStore();

  useEffect(() => {
    loadSavedRoutes();
  }, [loadSavedRoutes]);

  const handleCreateNewRoute = (): void => {
    clearWaypoints();
    setMapInteractionMode("draw-route");
    closeDrawer();
  };

  const handleOpenSavedRoute = (routeId: string): void => {
    openSavedRoute(routeId);
    closeDrawer();
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {savedRoutes.length === 0 ? (
        /* Empty state — just the create button, vertically centred */
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
          <Button variant="primary" fullWidth onPress={handleCreateNewRoute}>
            + Create New Route
          </Button>
        </div>
      ) : (
        <>
          {/* Create button */}
          <div style={{ padding: "0 12px 12px" }}>
            <Button variant="primary" fullWidth onPress={handleCreateNewRoute}>
              + Create New Route
            </Button>
          </div>

          <Separator />

          {/* Saved routes label */}
          <div style={{ padding: "12px 12px 0", flexShrink: 0 }}>
            <Paragraph size="xs" color="muted" style={{ margin: "0 0 8px", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Saved Routes
            </Paragraph>
          </div>

          {/* Route cards */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "0 12px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {savedRoutes.map((route) => (
            <div
              key={route.id}
              className="ls-card"
              style={{ padding: "12px 14px" }}
            >
              {/* Route header row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: "rgba(59,130,246,0.12)",
                    color: "var(--color-primary, #3b82f6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <RouteIcon />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Paragraph
                    size="sm"
                    style={{ margin: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {route.name}
                  </Paragraph>
                  <Paragraph size="xs" color="muted" style={{ margin: 0 }}>
                    {formatSavedAt(route.createdAt)}
                  </Paragraph>
                </div>
              </div>

              {/* Action row */}
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  size="sm"
                  variant="primary"
                  style={{ flex: 1, gap: 4 }}
                  onPress={() => handleOpenSavedRoute(route.id)}
                >
                  <PlayIcon /> Simulate
                </Button>
                <span title="Delete route">
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label="Delete route"
                    onPress={() => deleteSavedRoute(route.id)}
                  >
                    <TrashIcon />
                  </Button>
                </span>
              </div>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
