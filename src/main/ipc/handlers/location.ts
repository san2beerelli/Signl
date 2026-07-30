/**
 * Location control handlers — setting/resetting a device's simulated
 * location, plus the (currently mocked) route playback start/stop.
 */

import { validateCoordinate } from '@shared/coordinateValidation.js';
import { getBackendForKind } from '../../devices/discovery.js';
import { getCachedDeviceKind } from './deviceKindCache.js';
import { toIpcError } from './errors.js';
import type {
  LocationSetRequest,
  LocationSetResponse,
  StartRouteRequest,
  StartRouteResponse,
  StopRouteRequest,
  StopRouteResponse,
  ResetLocationRequest,
  ResetLocationResponse,
} from '@shared/types/index.js';

/**
 * location:set - Sets a single location on the specified device.
 */
export const handleLocationSet = async (
  _event: Electron.IpcMainInvokeEvent,
  request: LocationSetRequest
): Promise<LocationSetResponse> => {
  console.log('[IPC] location:set', request);

  try {
    if (!request.deviceId) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No device is selected.' },
      };
    }

    const validation = validateCoordinate(request.coordinate);
    if (!validation.valid) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: validation.errors.join(' ') },
      };
    }

    const kind = getCachedDeviceKind(request.deviceId);
    if (!kind) {
      return {
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: `Device not found: ${request.deviceId}` },
      };
    }

    const backend = getBackendForKind(kind);
    const applied = await backend.setLocation(request.deviceId, request.coordinate);

    return {
      success: true,
      coordinate: applied,
    };
  } catch (error) {
    console.error('[IPC] location:set error:', error);
    return {
      success: false,
      error: toIpcError(error),
    };
  }
};

/**
 * location:startRoute - Starts continuous route playback.
 *
 * TODO: Implement playback loop in main process:
 * 1. Use Turf.js to calculate total route distance
 * 2. Start interval timer
 * 3. Interpolate position along route based on elapsed time & speed
 * 4. Send position to device via backend
 * 5. Emit location:progress events to renderer
 */
export const handleStartRoute = async (
  _event: Electron.IpcMainInvokeEvent,
  request: StartRouteRequest
): Promise<StartRouteResponse> => {
  console.log('[IPC] location:startRoute', {
    deviceId: request.deviceId,
    waypointCount: request.waypoints.length,
    speed: request.speedMetersPerSecond,
  });

  const playbackId = `playback-${Date.now()}`;

  // Mock success response
  return {
    success: true,
    playbackId,
  };
};

/**
 * location:stopRoute - Stops active route playback.
 *
 * TODO: Clear playback interval and emit playbackComplete event
 */
export const handleStopRoute = async (
  _event: Electron.IpcMainInvokeEvent,
  request: StopRouteRequest
): Promise<StopRouteResponse> => {
  console.log('[IPC] location:stopRoute', request);

  return {
    success: true,
    stoppedAt: {
      latitude: 37.7749,
      longitude: -122.4194,
    },
  };
};

/**
 * location:reset - Resets device to real/default location.
 */
export const handleLocationReset = async (
  _event: Electron.IpcMainInvokeEvent,
  request: ResetLocationRequest
): Promise<ResetLocationResponse> => {
  console.log('[IPC] location:reset', request);

  try {
    const kind = getCachedDeviceKind(request.deviceId);
    if (!kind) {
      return {
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: `Device not found: ${request.deviceId}` },
      };
    }

    const backend = getBackendForKind(kind);
    await backend.reset(request.deviceId);

    return { success: true };
  } catch (error) {
    console.error('[IPC] location:reset error:', error);
    return {
      success: false,
      error: toIpcError(error),
    };
  }
};
