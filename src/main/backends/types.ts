/**
 * Backend Interface Types
 *
 * Defines the common interface that all device backends must implement.
 * This ensures consistent behavior across iOS Simulator, iOS Device,
 * Android Emulator, Android Device, and Browser backends.
 */

import type { Device, Coordinate, Waypoint, DeviceCapabilities } from '@shared/types/index.js';

/**
 * Error thrown when a backend doesn't support an operation.
 */
export class NotSupportedError extends Error {
  constructor(operation: string, backend: string, reason?: string) {
    const message = reason
      ? `${operation} is not supported by ${backend}: ${reason}`
      : `${operation} is not supported by ${backend}`;
    super(message);
    this.name = 'NotSupportedError';
  }
}

/**
 * Error thrown when a backend operation fails.
 */
export class BackendError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Options for starting route playback.
 */
export interface StartRouteOptions {
  waypoints: Waypoint[];
  speedMetersPerSecond: number;
  loop?: boolean;
}

/**
 * Callback for route progress updates.
 */
export interface RouteProgressCallback {
  (position: Coordinate, bearing: number, progress: number): void;
}

/**
 * Callback for playback completion.
 */
export interface PlaybackCompleteCallback {
  (reason: 'completed' | 'stopped' | 'error', error?: Error): void;
}

/**
 * Interface that all device backends must implement.
 *
 * Each backend handles a specific device kind and wraps the
 * appropriate native CLI tool or API.
 */
export interface DeviceBackend {
  /**
   * Human-readable name for this backend.
   */
  readonly name: string;

  /**
   * Returns the capabilities of this backend.
   */
  getCapabilities(): DeviceCapabilities;

  /**
   * Discovers all currently available devices for this backend.
   * @returns Array of discovered devices
   */
  listDevices(): Promise<Device[]>;

  /**
   * Sets a single location on the device.
   * @returns The coordinate as actually applied — fields the platform
   *          cannot inject (per capabilities) are omitted.
   * @throws NotSupportedError if the backend doesn't support this
   * @throws BackendError if the operation fails
   */
  setLocation(deviceId: string, coordinate: Coordinate): Promise<Coordinate>;

  /**
   * Starts continuous route playback.
   * The backend is responsible for the playback loop and interpolation.
   * @param onProgress Called periodically with current position
   * @param onComplete Called when playback ends
   * @returns A unique playback ID
   * @throws NotSupportedError if the backend doesn't support this
   */
  startRoute(
    deviceId: string,
    options: StartRouteOptions,
    onProgress: RouteProgressCallback,
    onComplete: PlaybackCompleteCallback
  ): Promise<string>;

  /**
   * Stops active route playback.
   * @param playbackId The ID returned by startRoute
   * @throws NotSupportedError if the backend doesn't support this
   */
  stopRoute(deviceId: string, playbackId: string): Promise<void>;

  /**
   * Resets the device to its real/default location.
   * @throws NotSupportedError if the backend doesn't support this
   */
  reset(deviceId: string): Promise<void>;
}
