/**
 * Android Emulator Backend
 *
 * Uses adbkit for Android emulator control via the telnet console.
 *
 * Discovery: adb devices + check for emulator-* ports
 * Set location: telnet console `geo fix <lng> <lat> [altitude]`
 *
 * Prerequisites:
 * - Android SDK platform-tools installed
 * - ANDROID_HOME or ANDROID_SDK_ROOT environment variable set
 * - adb available in PATH
 *
 * Note: Emulator uses `geo fix` which takes longitude first, then latitude.
 * This is different from most GPS formats which are lat,lng.
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
 * Android Emulator backend implementation.
 *
 * TODO (Step 9): Implement fully using adbkit
 */
export const androidEmulatorBackend: DeviceBackend = {
  name: 'Android Emulator',

  getCapabilities(): DeviceCapabilities {
    // Not implemented yet — report nothing rather than pretend support.
    return noCapabilities();
  },

  async listDevices(): Promise<Device[]> {
    // TODO: Implement adb devices parsing for emulators
    return [];
  },

  async setLocation(_deviceId: string, _coordinate: Coordinate): Promise<Coordinate> {
    throw new NotSupportedError('setLocation', 'Android Emulator', 'Not implemented yet');
  },

  async startRoute(
    _deviceId: string,
    _options: StartRouteOptions,
    _onProgress: RouteProgressCallback,
    _onComplete: PlaybackCompleteCallback
  ): Promise<string> {
    throw new NotSupportedError('startRoute', 'Android Emulator', 'Not implemented yet');
  },

  async stopRoute(_deviceId: string, _playbackId: string): Promise<void> {
    throw new NotSupportedError('stopRoute', 'Android Emulator', 'Not implemented yet');
  },

  async reset(_deviceId: string): Promise<void> {
    throw new NotSupportedError('reset', 'Android Emulator', 'Not implemented yet');
  },
};
