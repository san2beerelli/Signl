/**
 * User Location Resolution
 *
 * Finds the user's real position for centering the map at startup.
 * Priority order:
 *  1. Saved home location (set when user drags the blue dot) — exact, no network.
 *  2. Browser geolocation API (precise when the OS grants permission).
 *  3. IP-based estimate resolved in the main process (coarse, always approximate).
 * Returns null when none of the sources works.
 */

import type { Coordinate } from '@shared/types/index.js';

export interface ResolvedUserLocation {
  coordinate: Coordinate;
  /** True when the position is a coarse IP-based estimate */
  approximate: boolean;
}

const BROWSER_GEOLOCATION_TIMEOUT_MS = 3000;

async function fromSavedHomeLocation(): Promise<ResolvedUserLocation | null> {
  try {
    const response = await window.api.getHomeLocation();
    if (response.success && response.coordinate) {
      return { coordinate: response.coordinate, approximate: false };
    }
  } catch {
    // Not critical — fall through to next source.
  }
  return null;
}

function fromBrowserGeolocation(): Promise<ResolvedUserLocation | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          coordinate: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
          approximate: false,
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: BROWSER_GEOLOCATION_TIMEOUT_MS,
        maximumAge: 5 * 60 * 1000,
      }
    );
  });
}

async function fromIpEstimate(): Promise<ResolvedUserLocation | null> {
  try {
    const response = await window.api.getUserLocation();
    if (response.success && response.coordinate) {
      return {
        coordinate: response.coordinate,
        approximate: response.approximate ?? true,
      };
    }
  } catch {
    // Fall through to null — the map keeps its default center.
  }
  return null;
}

export async function resolveUserLocation(): Promise<ResolvedUserLocation | null> {
  return (await fromSavedHomeLocation()) ?? (await fromBrowserGeolocation()) ?? (await fromIpEstimate());
}
