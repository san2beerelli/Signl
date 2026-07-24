/**
 * Android Device Backend
 *
 * Uses adbkit for physical Android device location mocking.
 *
 * This requires:
 * 1. Developer options enabled on device
 * 2. "Allow mock locations" enabled
 * 3. A mock location provider app (or we inject one)
 *
 * Discovery: adb devices (filter out emulator-* entries)
 * Set location: adb shell am start-foreground-service with mock location intent
 *
 * Prerequisites:
 * - Android SDK platform-tools installed
 * - USB debugging enabled on device
 * - Device connected via USB or wireless ADB
 */

import type { Device, Coordinate, DeviceCapabilities } from '@shared/types/index.js';
import type {
  DeviceBackend,
  StartRouteOptions,
  RouteProgressCallback,
  PlaybackCompleteCallback,
} from './types.js';
import { NotSupportedError } from './types.js';
import { noCapabilities } from '@shared/types/index.js';

/**
 * Android Device backend implementation.
 *
 * TODO (Step 10): Implement fully using adbkit
 */
export const androidDeviceBackend: DeviceBackend = {
  name: 'Android Device',

  getCapabilities(): DeviceCapabilities {
    // Not implemented yet — report nothing rather than pretend support.
    return noCapabilities();
  },

  async listDevices(): Promise<Device[]> {
    // TODO: Implement adb devices parsing for physical devices
    return [];
  },

  async setLocation(_deviceId: string, _coordinate: Coordinate): Promise<Coordinate> {
    throw new NotSupportedError('setLocation', 'Android Device', 'Not implemented yet');
  },

  async startRoute(
    _deviceId: string,
    _options: StartRouteOptions,
    _onProgress: RouteProgressCallback,
    _onComplete: PlaybackCompleteCallback
  ): Promise<string> {
    throw new NotSupportedError('startRoute', 'Android Device', 'Not implemented yet');
  },

  async stopRoute(_deviceId: string, _playbackId: string): Promise<void> {
    throw new NotSupportedError('stopRoute', 'Android Device', 'Not implemented yet');
  },

  async reset(_deviceId: string): Promise<void> {
    throw new NotSupportedError('reset', 'Android Device', 'Not implemented yet');
  },
};
