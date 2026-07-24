/**
 * Device Types
 *
 * Core domain types for representing devices and their capabilities
 * across all supported platforms.
 */

/**
 * Discriminated union of all supported device kinds.
 * Each backend maps to exactly one kind.
 */
export type DeviceKind =
  | 'ios-simulator'
  | 'ios-device'
  | 'android-emulator'
  | 'android-device'
  | 'browser-external';

/**
 * Connection state of a device.
 */
export type DeviceState =
  | 'connected'   // Available and ready for commands
  | 'busy'        // Executing a command
  | 'offline'     // Previously seen but not currently available
  | 'error';      // In an error state

/**
 * Represents a single device that can receive location updates.
 */
export interface Device {
  /** Unique identifier (UDID for iOS, serial for Android, synthetic for browsers) */
  id: string;
  /** Human-readable name (e.g., "iPhone 15 Pro", "Pixel 7 API 34") */
  name: string;
  /** Which backend handles this device */
  kind: DeviceKind;
  /** Current connection state */
  state: DeviceState;
  /** What this device actually supports */
  capabilities: DeviceCapabilities;
  /** Platform-specific metadata */
  metadata?: DeviceMetadata;
}

/**
 * Platform-specific device metadata.
 * Backends may populate additional fields as needed.
 */
export interface DeviceMetadata {
  /** OS version (e.g., "17.4", "14") */
  osVersion?: string;
  /** Device model identifier */
  model?: string;
  /** For simulators/emulators: whether booted */
  isBooted?: boolean;
  /** For iOS devices: whether developer image is mounted */
  hasDeveloperImage?: boolean;
}

/**
 * A normalized geographic coordinate.
 *
 * `latitude`/`longitude` are used consistently across the application;
 * backends translate to platform-specific names/ordering internally.
 */
export interface Coordinate {
  latitude: number;
  longitude: number;
  /** Meters above sea level */
  altitude?: number;
  /** Meters per second, >= 0 */
  speed?: number;
  /** Degrees clockwise from true north, 0-360 */
  heading?: number;
  /** Horizontal accuracy in meters, >= 0 */
  accuracy?: number;
  /** Unix epoch milliseconds */
  timestamp?: number;
}

/**
 * A waypoint in a route, extending coordinate with identity and metrics.
 */
export interface Waypoint extends Coordinate {
  /** Unique waypoint identifier */
  id: string;
  /** Position within the route (0-based) */
  index: number;
  /** Optional waypoint name/label */
  name?: string;
  /** Original recorded timestamp from the source file (epoch ms) */
  sourceTimestamp?: number;
  /** Distance from the previous waypoint in meters */
  distanceFromPreviousMeters?: number;
  /** Cumulative distance from route start in meters */
  cumulativeDistanceMeters?: number;
}

/**
 * Where a route originally came from.
 */
export type RouteSourceFormat =
  | 'manual'
  | 'latlng'
  | 'geojson'
  | 'gpx'
  | 'csv';

/**
 * A route consisting of ordered waypoints.
 */
export interface Route {
  /** Unique route identifier */
  id: string;
  /** Route name */
  name: string;
  /** How this route was created/imported */
  sourceFormat: RouteSourceFormat;
  /** Ordered waypoints defining the route */
  waypoints: Waypoint[];
  /** Total route length in meters */
  totalDistanceMeters: number;
  /** Estimated playback duration at base speed, if known */
  estimatedDurationMs?: number;
  /** Whether the source data included recorded timestamps */
  hasRecordedTimestamps: boolean;
}

/**
 * Travel modes with default speeds.
 */
export type TravelMode = 'walk' | 'run' | 'bike' | 'car';

export const DEFAULT_TRAVEL_SPEEDS_MPS: Record<TravelMode, number> = {
  walk: 1.4,   // ~3 mph
  run: 3.0,    // ~6.7 mph
  bike: 5.5,   // ~12 mph
  car: 13.411, // 30 mph
};

/** UI preset playback multipliers. Internally any finite positive value is allowed. */
export type PlaybackMultiplier = 0.5 | 1 | 2 | 5 | 10;

/**
 * Playback state for an active route simulation.
 */
export interface PlaybackState {
  /** Whether playback is currently active */
  isPlaying: boolean;
  /** Current position along the route (0-1) */
  progress: number;
  /** Current interpolated position */
  currentPosition: Coordinate;
  /** Current bearing/heading in degrees (0-360) */
  bearing: number;
  /** Speed in meters per second */
  speedMetersPerSecond: number;
  /** Index of the waypoint we're heading towards */
  targetWaypointIndex: number;
}

/**
 * Capabilities that a device backend may or may not support.
 * Used to enable/disable UI features per device.
 *
 * Backends must report what they actually support — the renderer uses
 * these flags to disable controls, warn before playback, and avoid
 * sending properties the backend would silently discard.
 */
export interface DeviceCapabilities {
  /** Can set a single location */
  setLocation: boolean;
  /** Can reset to real/default location */
  resetLocation: boolean;
  /** Can play back a route (via repeated injection or native mechanism) */
  routePlayback: boolean;
  /** Route playback can be paused/resumed */
  pauseRoute: boolean;
  /** Supports altitude in location updates */
  altitude: boolean;
  /** Supports speed in location updates */
  speed: boolean;
  /** Supports heading in location updates */
  heading: boolean;
  /** Supports horizontal accuracy in location updates */
  accuracy: boolean;
}

/**
 * Capabilities for a backend that supports nothing (e.g., unimplemented stubs).
 */
export function noCapabilities(): DeviceCapabilities {
  return {
    setLocation: false,
    resetLocation: false,
    routePlayback: false,
    pauseRoute: false,
    altitude: false,
    speed: false,
    heading: false,
    accuracy: false,
  };
}
