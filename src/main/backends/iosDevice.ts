/**
 * iOS Device Backend
 *
 * Wraps `idevicelocation` and `ideviceimagemounter` commands for
 * location simulation on physical iOS devices.
 *
 * Prerequisites:
 * - libimobiledevice installed via Homebrew: `brew install libimobiledevice`
 * - idevicelocation tool available
 * - Developer disk image mounted on device
 *
 * Limitations:
 * - Requires developer disk image (DeveloperDiskImage.dmg) mounted
 * - May not support all iOS versions equally
 * - Route playback speed options may be limited
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
 * iOS Device backend implementation.
 *
 * TODO (Step 10): Implement fully
 */
export const iosDeviceBackend: DeviceBackend = {
  name: 'iOS Device',

  getCapabilities(): DeviceCapabilities {
    // Not implemented yet — report nothing rather than pretend support.
    return noCapabilities();
  },

  async listDevices(): Promise<Device[]> {
    // TODO: Implement idevice_id -l parsing
    return [];
  },

  async setLocation(_deviceId: string, _coordinate: Coordinate): Promise<Coordinate> {
    throw new NotSupportedError('setLocation', 'iOS Device', 'Not implemented yet');
  },

  async startRoute(
    _deviceId: string,
    _options: StartRouteOptions,
    _onProgress: RouteProgressCallback,
    _onComplete: PlaybackCompleteCallback
  ): Promise<string> {
    throw new NotSupportedError('startRoute', 'iOS Device', 'Not implemented yet');
  },

  async stopRoute(_deviceId: string, _playbackId: string): Promise<void> {
    throw new NotSupportedError('stopRoute', 'iOS Device', 'Not implemented yet');
  },

  async reset(_deviceId: string): Promise<void> {
    throw new NotSupportedError('reset', 'iOS Device', 'Not implemented yet');
  },
};
