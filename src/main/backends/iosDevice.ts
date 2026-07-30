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

import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { Device, Coordinate, DeviceCapabilities } from '@shared/types/index.js';
import type {
  DeviceBackend,
  StartRouteOptions,
  RouteProgressCallback,
  PlaybackCompleteCallback,
} from './types.js';
import { BackendError, NotSupportedError } from './types.js';

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5000;

/**
 * What physical iOS devices support via `idevicelocation`: lat/lng only,
 * same restriction as the Simulator's `simctl`. Route playback isn't
 * implemented yet — the renderer's TargetList already surfaces "No
 * routes" for a device with setLocation but not routePlayback.
 */
const IOS_DEVICE_CAPABILITIES: DeviceCapabilities = {
  setLocation: true,
  resetLocation: true,
  routePlayback: false,
  pauseRoute: false,
  altitude: false,
  speed: false,
  heading: false,
  accuracy: false,
};

/** Runs `idevice_id -l` and returns one UDID per connected/paired device. */
const listConnectedUdids = async (): Promise<string[]> => {
  try {
    const { stdout } = await execFileAsync('idevice_id', ['-l'], { timeout: COMMAND_TIMEOUT_MS });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      // libimobiledevice isn't installed — treat as "no devices" rather than an error.
      return [];
    }
    console.error('[iOS Device] idevice_id -l failed:', err.message);
    return [];
  }
};

/** Parses `ideviceinfo`'s plain "Key: Value" output into a lookup map. */
const parseIdeviceInfo = (stdout: string): Map<string, string> => {
  const info = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const separatorIndex = line.indexOf(': ');
    if (separatorIndex === -1) continue;
    info.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 2).trim());
  }
  return info;
};

/** Fetches a connected device's name/model/OS version via `ideviceinfo`. */
const fetchDeviceInfo = async (udid: string): Promise<Map<string, string> | null> => {
  try {
    const { stdout } = await execFileAsync('ideviceinfo', ['-u', udid], { timeout: COMMAND_TIMEOUT_MS });
    return parseIdeviceInfo(stdout);
  } catch (error) {
    console.error(`[iOS Device] ideviceinfo failed for ${udid}:`, (error as Error).message);
    return null;
  }
};

/** Builds a fallback label from a UDID for devices we can't yet name. */
const fallbackDeviceName = (udid: string): string => `iOS Device (${udid.slice(0, 8)})`;

/**
 * udid → the currently-running `idevicelocation` process simulating its
 * position. Unlike `simctl location set`, idevicelocation has no one-shot
 * command — the running process *is* the override, streaming the fixed
 * position to the device via the developer disk image's debug service
 * until it's killed. Changing location means killing the old process and
 * spawning a new one with the new coordinates.
 */
const activeLocationProcesses = new Map<string, ChildProcess>();

/** Kills the running idevicelocation process (if any) for a UDID and forgets it. */
const stopLocationProcess = (udid: string): void => {
  const proc = activeLocationProcesses.get(udid);
  if (!proc) return;
  activeLocationProcesses.delete(udid);
  try {
    proc.kill('SIGTERM');
  } catch {
    // Already exited
  }
};

/**
 * Starts (or restarts) `idevicelocation -u <udid> <lat> <lng>` and resolves
 * once it's been running long enough to assume the override took hold, or
 * rejects if it exits (wrong UDID, device locked, developer disk image not
 * mounted/available for this iOS version, etc.) before that.
 */
const startLocationProcess = (udid: string, latitude: number, longitude: number): Promise<void> => {
  stopLocationProcess(udid);

  return new Promise((resolve, reject) => {
    const proc = spawn('idevicelocation', ['-u', udid, String(latitude), String(longitude)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let stderr = '';

    const settleOk = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      activeLocationProcesses.set(udid, proc);
      resolve();
    };

    const guard = setTimeout(settleOk, 2000);

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (activeLocationProcesses.get(udid) === proc) {
        activeLocationProcesses.delete(udid);
      }
      if (!settled && code !== 0) {
        settled = true;
        clearTimeout(guard);
        reject(new Error(stderr.trim() || `idevicelocation exited with code ${code}`));
      }
    });
  });
};

/**
 * iOS Device backend implementation.
 *
 * Discovery (`listDevices`) shells out to `idevice_id -l` for connected
 * UDIDs and `ideviceinfo` for each device's name/model/OS version.
 * Location control uses `idevicelocation`, which requires the developer
 * disk image for the device's iOS version to be available and mountable —
 * on iOS 17+ that's a personalized image Apple only hands out through an
 * active Xcode pairing, so this can fail on newer devices even when the
 * tool itself is installed. Route playback isn't implemented yet.
 */
export const iosDeviceBackend: DeviceBackend = {
  name: 'iOS Device',

  getCapabilities(): DeviceCapabilities {
    return { ...IOS_DEVICE_CAPABILITIES };
  },

  async listDevices(): Promise<Device[]> {
    const udids = await listConnectedUdids();
    if (udids.length === 0) return [];

    const devices = await Promise.all(
      udids.map(async (udid): Promise<Device> => {
        const info = await fetchDeviceInfo(udid);

        if (!info) {
          // Seen by idevice_id but ideviceinfo couldn't reach it — most
          // often means the device hasn't been trusted on this Mac yet
          // ("Trust This Computer?" not yet confirmed on the device).
          return {
            id: udid,
            name: fallbackDeviceName(udid),
            kind: 'ios-device',
            state: 'error',
            capabilities: { ...IOS_DEVICE_CAPABILITIES },
          };
        }

        const osVersion = info.get('ProductVersion');
        const model = info.get('ProductType');

        return {
          id: udid,
          name: info.get('DeviceName') ?? fallbackDeviceName(udid),
          kind: 'ios-device',
          state: 'connected',
          capabilities: { ...IOS_DEVICE_CAPABILITIES },
          metadata: {
            ...(osVersion !== undefined ? { osVersion } : {}),
            ...(model !== undefined ? { model } : {}),
          },
        };
      })
    );

    devices.sort((a, b) => a.name.localeCompare(b.name));
    return devices;
  },

  async setLocation(deviceId: string, coordinate: Coordinate): Promise<Coordinate> {
    try {
      await startLocationProcess(deviceId, coordinate.latitude, coordinate.longitude);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        throw new BackendError(
          'idevicelocation is not installed. It must be built from source — see the ' +
            'Environment Check panel for the command.',
          'BACKEND_ERROR',
          err
        );
      }
      throw new BackendError(
        `Could not set location on this device (${err.message}). Make sure it's unlocked, ` +
          'trusted, and running an iOS version whose developer disk image is mountable.',
        'BACKEND_ERROR',
        err
      );
    }

    // idevicelocation only injects lat/lng — report what was actually applied.
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
    throw new NotSupportedError('startRoute', 'iOS Device', 'Not implemented yet');
  },

  async stopRoute(_deviceId: string, _playbackId: string): Promise<void> {
    throw new NotSupportedError('stopRoute', 'iOS Device', 'Not implemented yet');
  },

  async reset(deviceId: string): Promise<void> {
    stopLocationProcess(deviceId);
  },
};
