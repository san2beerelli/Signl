/**
 * Device Kind Cache
 *
 * Tracks each discovered device's kind so location/reset/browser handlers
 * can resolve the right backend from a device ID alone, without re-running
 * discovery on every call.
 */

import type { DeviceKind } from '@shared/types/index.js';

const deviceKindCache = new Map<string, DeviceKind>();

export const rebuildDeviceKindCache = (devices: { id: string; kind: DeviceKind }[]): void => {
  deviceKindCache.clear();
  for (const device of devices) {
    deviceKindCache.set(device.id, device.kind);
  }
};

export const getCachedDeviceKind = (deviceId: string): DeviceKind | undefined => deviceKindCache.get(deviceId);

export const setCachedDeviceKind = (deviceId: string, kind: DeviceKind): void => {
  deviceKindCache.set(deviceId, kind);
};

export const deleteCachedDeviceKind = (deviceId: string): void => {
  deviceKindCache.delete(deviceId);
};
