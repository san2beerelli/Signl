/**
 * External Browser Backend
 *
 * Discovers Chromium-based browsers installed on the host Mac, launches them
 * with a remote-debugging port, and controls geolocation via CDP
 * (Emulation.setGeolocationOverride).
 *
 * Supported browsers: Chrome, Edge, Brave, Arc, Chromium, Vivaldi, Opera.
 *
 * CDP Flow:
 *   1. Launch browser with --remote-debugging-port=PORT
 *   2. GET http://localhost:PORT/json → list of open page targets
 *   3. WebSocket to each target's webSocketDebuggerUrl
 *   4. Send Emulation.setGeolocationOverride (lat/lng/accuracy)
 *
 * Route playback mirrors the embedded backend — the handler calls
 * setLocation on a fixed interval, updating all open pages each tick.
 */

import type { Coordinate, Device, DeviceCapabilities } from '@shared/types/index.js';
import type { DeviceBackend, PlaybackCompleteCallback, RouteProgressCallback, StartRouteOptions } from '../types.js';
import { BackendError } from '../types.js';
import { BROWSER_EXTERNAL_CAPABILITIES, browserIdFrom, buildDevice, findInstalledBrowsers } from './catalogue.js';
import { applyGeolocationToAllPages, clearGeolocationOnAllPages, DEFAULT_ACCURACY } from './geolocation.js';
import { interpolatePosition, totalRouteMeters } from './playbackMath.js';
import { activePlaybacks, sessions } from './sessionState.js';

const PLAYBACK_INTERVAL_MS = 1000;

export const browserExternalBackend: DeviceBackend = {
  name: 'Browser (external)',

  getCapabilities(): DeviceCapabilities {
    return { ...BROWSER_EXTERNAL_CAPABILITIES };
  },

  async listDevices(): Promise<Device[]> {
    const installed = await findInstalledBrowsers();

    return installed.map((def) => {
      const session = sessions.get(def.id);
      return buildDevice(def, session?.port, session !== undefined);
    });
  },

  async setLocation(deviceId: string, coordinate: Coordinate): Promise<Coordinate> {
    const browserId = browserIdFrom(deviceId);
    const session = sessions.get(browserId);
    if (!session) {
      throw new BackendError(
        'Browser is not connected. Click "Connect" in the Browsers panel first.',
        'DEVICE_OFFLINE'
      );
    }

    await applyGeolocationToAllPages(session, coordinate);

    return {
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      accuracy: coordinate.accuracy ?? DEFAULT_ACCURACY,
      timestamp: Date.now(),
    };
  },

  async startRoute(
    deviceId: string,
    options: StartRouteOptions,
    onProgress: RouteProgressCallback,
    onComplete: PlaybackCompleteCallback
  ): Promise<string> {
    const browserId = browserIdFrom(deviceId);
    const session = sessions.get(browserId);
    if (!session) {
      throw new BackendError('Browser is not connected.', 'DEVICE_OFFLINE');
    }

    if (options.waypoints.length < 2) {
      throw new BackendError('Route needs at least 2 waypoints.', 'INVALID_WAYPOINTS');
    }

    const playbackId = `bext-${Date.now()}`;
    const total = totalRouteMeters(options.waypoints);
    let travelled = 0;
    const speed = options.speedMetersPerSecond;
    const distancePerTick = speed * (PLAYBACK_INTERVAL_MS / 1000);

    const tick = setInterval(async () => {
      travelled += distancePerTick;

      if (travelled >= total) {
        if (options.loop) {
          travelled = travelled % total;
        } else {
          clearInterval(tick);
          activePlaybacks.delete(playbackId);
          const last = options.waypoints[options.waypoints.length - 1]!;
          onComplete('completed');
          // Best-effort final position
          await applyGeolocationToAllPages(session, {
            latitude: last.latitude,
            longitude: last.longitude,
          }).catch(() => {});
          return;
        }
      }

      const pos = interpolatePosition(options.waypoints, travelled);
      const coord: Coordinate = {
        latitude: pos.latitude,
        longitude: pos.longitude,
        timestamp: Date.now(),
      };

      try {
        await applyGeolocationToAllPages(session, coord);
      } catch (error) {
        clearInterval(tick);
        activePlaybacks.delete(playbackId);
        onComplete('error', error instanceof Error ? error : new Error(String(error)));
        return;
      }

      onProgress(coord, pos.bearing, travelled / total);
    }, PLAYBACK_INTERVAL_MS);

    activePlaybacks.set(playbackId, tick);
    return playbackId;
  },

  async stopRoute(_deviceId: string, playbackId: string): Promise<void> {
    const timer = activePlaybacks.get(playbackId);
    if (timer) {
      clearInterval(timer);
      activePlaybacks.delete(playbackId);
    }
  },

  async reset(deviceId: string): Promise<void> {
    const browserId = browserIdFrom(deviceId);
    const session = sessions.get(browserId);
    if (!session) return;
    await clearGeolocationOnAllPages(session);
  },
};

export { connectExternalBrowser, disconnectExternalBrowser } from './lifecycle.js';
export { KNOWN_BROWSERS, browserIdFrom, deviceIdFor, findInstalledBrowsers } from './catalogue.js';
export type { BrowserDef } from './catalogue.js';
