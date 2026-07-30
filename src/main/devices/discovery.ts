/**
 * Device Discovery
 *
 * Aggregates device discovery from all backends and provides
 * a unified interface for listing all available devices.
 */

import type { Device, DeviceKind } from '@shared/types/index.js';
import type { DeviceBackend } from '../backends/types.js';
import { iosSimulatorBackend } from '../backends/iosSimulator.js';
import { iosDeviceBackend } from '../backends/iosDevice.js';
import { androidEmulatorBackend } from '../backends/androidEmulator.js';
import { androidDeviceBackend } from '../backends/androidDevice.js';
import { browserExternalBackend } from '../backends/browser.js';

/**
 * Map of device kinds to their backend implementations.
 */
const backends: Record<DeviceKind, DeviceBackend> = {
  'ios-simulator': iosSimulatorBackend,
  'ios-device': iosDeviceBackend,
  'android-emulator': androidEmulatorBackend,
  'android-device': androidDeviceBackend,
  'browser-external': browserExternalBackend,
};

/**
 * Get the backend for a specific device kind.
 */
export const getBackendForKind = (kind: DeviceKind): DeviceBackend => backends[kind];

/**
 * Get the backend for a specific device ID.
 * Requires knowing the device kind, which should be cached from listDevices().
 */
export const getBackendForDevice = (device: Device): DeviceBackend => backends[device.kind];

/**
 * Discover all available devices from all backends.
 *
 * Runs discovery in parallel across all backends and aggregates results.
 * Failures in one backend don't affect others.
 */
export const discoverAllDevices = async (): Promise<Device[]> => {
  const backendList = Object.values(backends);

  const results = await Promise.allSettled(
    backendList.map(async (backend) => {
      try {
        return await backend.listDevices();
      } catch (error) {
        console.error(`[Discovery] Failed to list devices from ${backend.name}:`, error);
        return [];
      }
    })
  );

  const allDevices: Device[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allDevices.push(...result.value);
    }
  }

  return allDevices;
};
