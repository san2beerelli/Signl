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
import { PlayOutlineIcon, RouteIcon, TrashIcon } from "@/icons.js";

const { Paragraph } = Typography;

const formatSavedAt = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const RoutesDrawer = (): JSX.Element => {
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
                  <RouteIcon size={14} strokeWidth={2} />
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
                  <PlayOutlineIcon /> Simulate
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
};
