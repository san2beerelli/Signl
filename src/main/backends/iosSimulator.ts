/**
 * iOS Simulator Backend
 *
 * Wraps `xcrun simctl` commands for location simulation on iOS Simulators.
 *
 * Discovery: `xcrun simctl list devices --json`
 * Set location: `xcrun simctl location <udid> set <lat>,<lng>`
 * Clear/reset: `xcrun simctl location <udid> clear`
 *
 * Prerequisites:
 * - Xcode installed with command line tools
 * - At least one iOS Simulator created and booted
 *
 * Limitations:
 * - simctl only accepts latitude/longitude; altitude, speed, heading, and
 *   accuracy cannot be injected and are reported as unsupported capabilities.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Device, Coordinate, DeviceCapabilities } from '@shared/types/index.js';
import type {
  DeviceBackend,
  StartRouteOptions,
  RouteProgressCallback,
  PlaybackCompleteCallback,
} from './types.js';
import { NotSupportedError, BackendError } from './types.js';

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 10_000;

/**
 * What iOS Simulators actually support: simctl takes lat/lng only.
 */
const IOS_SIMULATOR_CAPABILITIES: DeviceCapabilities = {
  setLocation: true,
  resetLocation: true,
  routePlayback: true,
  pauseRoute: true,
  altitude: false,
  speed: false,
  heading: false,
  accuracy: false,
};

/**
 * Shape of simctl list devices --json output
 */
interface SimctlDevicesOutput {
  devices: {
    [runtime: string]: SimctlDevice[];
  };
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  deviceTypeIdentifier?: string;
  isAvailable?: boolean;
}

/**
 * Extract iOS version from runtime string.
 * e.g., "com.apple.CoreSimulator.SimRuntime.iOS-17-4" -> "17.4"
 */
const parseOsVersion = (runtime: string): string | undefined => {
  const match = runtime.match(/iOS[.-](\d+)[.-](\d+)/i);
  if (match && match[1] && match[2]) {
    return `${match[1]}.${match[2]}`;
  }
  return undefined;
};

/**
 * Runs simctl with an argument array (no shell string concatenation) and
 * translates common failures into readable BackendErrors.
 */
const runSimctl = async (args: string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('xcrun', ['simctl', ...args], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    return stdout;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    const stderr = err.stderr?.trim() ?? '';
    console.error('[iOS Simulator] simctl failed:', { args, stderr, error: err.message });

    if (err.code === 'ENOENT') {
      throw new BackendError(
        'Xcode command line tools are not installed (xcrun not found).',
        'BACKEND_ERROR',
        err
      );
    }
    if (err.killed) {
      throw new BackendError(
        `The simctl command timed out after ${COMMAND_TIMEOUT_MS / 1000}s.`,
        'BACKEND_ERROR',
        err
      );
    }
    if (/invalid device|unknown device|not found/i.test(stderr)) {
      throw new BackendError(
        'The selected simulator could not be found. It may have been deleted.',
        'DEVICE_NOT_FOUND',
        stderr
      );
    }
    if (/unable to lookup|not booted|current state: shutdown/i.test(stderr)) {
      throw new BackendError(
        'The selected simulator is not booted.',
        'NOT_BOOTED',
        stderr
      );
    }
    throw new BackendError(
      stderr || `simctl command failed: ${err.message}`,
      'BACKEND_ERROR',
      err
    );
  }
};

/**
 * iOS Simulator backend implementation.
 */
export const iosSimulatorBackend: DeviceBackend = {
  name: 'iOS Simulator',

  getCapabilities(): DeviceCapabilities {
    return { ...IOS_SIMULATOR_CAPABILITIES };
  },

  async listDevices(): Promise<Device[]> {
    try {
      const stdout = await runSimctl(['list', 'devices', '--json']);
      const data: SimctlDevicesOutput = JSON.parse(stdout);
      const devices: Device[] = [];

      for (const [runtime, simulators] of Object.entries(data.devices)) {
        // Skip non-iOS runtimes (watchOS, tvOS, visionOS)
        if (!runtime.toLowerCase().includes('ios')) {
          continue;
        }

        const osVersion = parseOsVersion(runtime);

        for (const sim of simulators) {
          // Skip unavailable simulators
          if (sim.isAvailable === false) {
            continue;
          }

          const isBooted = sim.state === 'Booted';

          // Only show booted simulators
          if (!isBooted) {
            continue;
          }

          devices.push({
            id: sim.udid,
            name: sim.name,
            kind: 'ios-simulator',
            state: 'connected',
            capabilities: { ...IOS_SIMULATOR_CAPABILITIES },
            metadata: {
              ...(osVersion !== undefined ? { osVersion } : {}),
              ...(sim.deviceTypeIdentifier !== undefined
                ? { model: sim.deviceTypeIdentifier }
                : {}),
              isBooted,
            },
          });
        }
      }

      devices.sort((a, b) => a.name.localeCompare(b.name));

      return devices;
    } catch (error) {
      console.error('[iOS Simulator] Failed to list devices:', error);
      return [];
    }
  },

  async setLocation(deviceId: string, coordinate: Coordinate): Promise<Coordinate> {
    await runSimctl([
      'location',
      deviceId,
      'set',
      `${coordinate.latitude},${coordinate.longitude}`,
    ]);

    // simctl only injects lat/lng — report what was actually applied.
    return {
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      timestamp: Date.now(),
    };
  },

  async startRoute(
    _deviceId: string,
    _options: StartRouteOptions,
    _onProgress: RouteProgressCallback,
    _onComplete: PlaybackCompleteCallback
  ): Promise<string> {
    // Route playback is driven by the central RoutePlaybackManager (Stage 3),
    // which repeatedly calls setLocation with interpolated coordinates.
    throw new NotSupportedError('startRoute', 'iOS Simulator', 'Route playback arrives in Stage 3');
  },

  async stopRoute(_deviceId: string, _playbackId: string): Promise<void> {
    throw new NotSupportedError('stopRoute', 'iOS Simulator', 'Route playback arrives in Stage 3');
  },

  async reset(deviceId: string): Promise<void> {
    await runSimctl(['location', deviceId, 'clear']);
  },
};
