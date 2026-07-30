/**
 * Reverse-geocodes a just-added waypoint and, once resolved, stamps its
 * address onto `name`. Matched by ID (not index) since the waypoint's
 * position in the array can change before this async call resolves.
 * Best-effort — a failed lookup just leaves the marker unlabeled.
 */

import { useRouteStore } from "@/state/routeStore.js";
import type { Waypoint } from "@shared/types/index.js";

export const reverseGeocodeWaypoint = async (waypoint: Waypoint): Promise<void> => {
  try {
    const response = await window.api.reverseGeocode({
      latitude: waypoint.latitude,
      longitude: waypoint.longitude,
    });
    if (response.success && response.address) {
      useRouteStore.getState().updateWaypointById(waypoint.id, { name: response.address });
    }
  } catch {
    // Non-critical — the marker just renders without a label.
  }
};
