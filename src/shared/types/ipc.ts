/**
 * IPC Contract Types
 *
 * Defines all IPC channels and their request/response types.
 * This file is imported by both main and renderer processes
 * to ensure type safety across the process boundary.
 *
 * Channels follow two patterns:
 * 1. Request/Response (invoke/handle): For one-shot commands
 * 2. Push events (send/on): For streaming updates from main → renderer
 */

import type { Device, Waypoint, Coordinate, PlaybackState, TravelMode } from './device.js';

// ============================================================================
// Request/Response Channels (ipcRenderer.invoke / ipcMain.handle)
// ============================================================================

/**
 * Channel names for invoke/handle pattern.
 */
export type IpcInvokeChannel =
  | 'devices:list'
  | 'location:set'
  | 'location:startRoute'
  | 'location:stopRoute'
  | 'location:reset'
  | 'location:reverseGeocode'
  | 'route:getDirections'
  | 'gpx:import'
  | 'gpx:export'
  | 'tools:check'
  | 'tools:install'
  | 'system:getUserLocation'
  | 'system:getHomeLocation'
  | 'system:setHomeLocation'
  | 'browsers:connect'
  | 'browsers:disconnect';

/**
 * Request payloads for each invoke channel.
 */
export interface IpcInvokePayloads {
  'devices:list': void;
  'location:set': LocationSetRequest;
  'location:startRoute': StartRouteRequest;
  'location:stopRoute': StopRouteRequest;
  'location:reset': ResetLocationRequest;
  'location:reverseGeocode': ReverseGeocodeRequest;
  'route:getDirections': GetDirectionsRequest;
  'gpx:import': GpxImportRequest;
  'gpx:export': GpxExportRequest;
  'tools:check': ToolCheckRequest;
  'tools:install': ToolInstallRequest;
  'system:getUserLocation': void;
  'system:getHomeLocation': void;
  'system:setHomeLocation': SetHomeLocationRequest;
  'browsers:connect': BrowserConnectRequest;
  'browsers:disconnect': BrowserDisconnectRequest;
}

/**
 * Response types for each invoke channel.
 */
export interface IpcInvokeResponses {
  'devices:list': DevicesListResponse;
  'location:set': LocationSetResponse;
  'location:startRoute': StartRouteResponse;
  'location:stopRoute': StopRouteResponse;
  'location:reset': ResetLocationResponse;
  'location:reverseGeocode': ReverseGeocodeResponse;
  'route:getDirections': GetDirectionsResponse;
  'gpx:import': GpxImportResponse;
  'gpx:export': GpxExportResponse;
  'tools:check': ToolCheckResponse;
  'tools:install': ToolInstallResponse;
  'system:getUserLocation': UserLocationResponse;
  'system:getHomeLocation': HomeLocationResponse;
  'system:setHomeLocation': IpcBaseResponse;
  'browsers:connect': BrowserConnectResponse;
  'browsers:disconnect': BrowserDisconnectResponse;
}

// ============================================================================
// Request Types
// ============================================================================

/**
 * Set a single location on a device.
 * The coordinate carries all optional fields (altitude, speed, heading,
 * accuracy); backends apply what they support and report the rest via
 * device capabilities.
 */
export interface LocationSetRequest {
  deviceId: string;
  coordinate: Coordinate;
}

/**
 * Start continuous route playback on a device.
 */
export interface StartRouteRequest {
  deviceId: string;
  waypoints: Waypoint[];
  speedMetersPerSecond: number;
  /** Whether to loop back to start when route completes */
  loop?: boolean;
}

/**
 * Stop active route playback.
 */
export interface StopRouteRequest {
  deviceId: string;
}

/**
 * Reset device to real/default location.
 */
export interface ResetLocationRequest {
  deviceId: string;
}

/**
 * Reverse-geocode a coordinate into a human-readable address.
 */
export interface ReverseGeocodeRequest {
  latitude: number;
  longitude: number;
}

/**
 * Fetch a road-following route (turn-by-turn geometry) through an ordered
 * list of points.
 */
export interface GetDirectionsRequest {
  coordinates: Coordinate[];
  /** Routing profile to use. Defaults to "car" when omitted. */
  travelMode?: TravelMode;
}

/**
 * Import waypoints from a GPX file.
 */
export interface GpxImportRequest {
  /** Absolute path to GPX file */
  filePath: string;
}

/**
 * Export waypoints to a GPX file.
 */
export interface GpxExportRequest {
  /** Absolute path to write GPX file */
  filePath: string;
  /** Waypoints to export */
  waypoints: Waypoint[];
  /** Optional route name */
  routeName?: string;
}

/**
 * Check if a CLI tool is installed.
 */
export interface ToolCheckRequest {
  /** Tool identifier: xcode, adb, libimobiledevice, idevicelocation, ideviceimagemounter */
  toolId: string;
}

/**
 * Install a CLI tool via Homebrew.
 */
export interface ToolInstallRequest {
  /** Tool identifier: libimobiledevice, idevicelocation, ideviceimagemounter */
  toolId: string;
}

/**
 * Connect to (or launch) an external browser by its stable browser ID.
 * The backend discovers which port to use and launches the browser if needed.
 */
export interface BrowserConnectRequest {
  /** Stable browser identifier: 'chrome' | 'edge' | 'brave' | 'arc' | 'chromium' | 'vivaldi' | 'opera' */
  browserId: string;
}

/**
 * Disconnect from an external browser and clear its geolocation override.
 */
export interface BrowserDisconnectRequest {
  /** The device ID of the connected browser (browser-external-{browserId}) */
  deviceId: string;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Base response with success/error status.
 */
export interface IpcBaseResponse {
  success: boolean;
  error?: IpcError;
}

/**
 * Structured error information.
 */
export interface IpcError {
  code: IpcErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Error codes for IPC operations.
 */
export type IpcErrorCode =
  | 'NOT_SUPPORTED'        // Operation not supported by this device/backend
  | 'VALIDATION_ERROR'     // Request payload failed validation
  | 'NOT_BOOTED'           // Simulator/emulator exists but is not booted
  | 'DEVICE_NOT_FOUND'     // Device ID not found
  | 'DEVICE_BUSY'          // Device is busy with another operation
  | 'DEVICE_OFFLINE'       // Device is not currently connected
  | 'PLAYBACK_ACTIVE'      // Cannot start new playback while one is active
  | 'NO_PLAYBACK_ACTIVE'   // Cannot stop playback when none is active
  | 'INVALID_WAYPOINTS'    // Waypoints array is empty or malformed
  | 'FILE_NOT_FOUND'       // GPX file not found
  | 'PARSE_ERROR'          // Failed to parse GPX file
  | 'WRITE_ERROR'          // Failed to write GPX file
  | 'BACKEND_ERROR'        // Generic backend/CLI error
  | 'UNKNOWN';             // Unknown error

/**
 * Response for devices:list
 */
export interface DevicesListResponse extends IpcBaseResponse {
  devices: Device[];
}

/**
 * Response for location:set
 */
export interface LocationSetResponse extends IpcBaseResponse {
  /** The coordinate as actually applied by the backend (unsupported fields omitted) */
  coordinate?: Coordinate;
}

/**
 * Response for location:startRoute
 */
export interface StartRouteResponse extends IpcBaseResponse {
  /** Unique ID for this playback session (used to correlate progress events) */
  playbackId?: string;
}

/**
 * Response for location:stopRoute
 */
export interface StopRouteResponse extends IpcBaseResponse {
  /** Final position when stopped */
  stoppedAt?: Coordinate;
}

/**
 * Response for location:reset
 */
export interface ResetLocationResponse extends IpcBaseResponse {}

/**
 * Response for location:reverseGeocode
 */
export interface ReverseGeocodeResponse extends IpcBaseResponse {
  /** Short human-readable address (e.g. "11 Maple St"), when resolvable */
  address?: string;
}

/**
 * Response for route:getDirections
 */
export interface GetDirectionsResponse extends IpcBaseResponse {
  /** Road-following route geometry as [longitude, latitude] pairs (GeoJSON order) */
  geometry?: [number, number][];
  distanceMeters?: number;
  durationSeconds?: number;
}

/**
 * Response for gpx:import
 */
export interface GpxImportResponse extends IpcBaseResponse {
  /** Parsed waypoints from the GPX file */
  waypoints?: Waypoint[];
  /** Route name if present in GPX */
  routeName?: string;
}

/**
 * Response for gpx:export
 */
export interface GpxExportResponse extends IpcBaseResponse {
  /** Absolute path to written file */
  filePath?: string;
}

/**
 * Response for system:getUserLocation
 *
 * The user's real (approximate) position, used to center the map at
 * startup. Resolved in the main process via IP geolocation — city-level
 * accuracy at best, so `approximate` is always true for that source.
 */
export interface UserLocationResponse extends IpcBaseResponse {
  coordinate?: Coordinate;
  /** True when the position is a coarse IP-based estimate */
  approximate?: boolean;
}

/**
 * Request for system:setHomeLocation — saves a coordinate as the user's
 * preferred home/default map center, persisted across restarts.
 */
export interface SetHomeLocationRequest {
  coordinate: Coordinate;
}

/**
 * Response for system:getHomeLocation — returns the saved home coordinate,
 * or success:true with no coordinate when none has been saved yet.
 */
export interface HomeLocationResponse extends IpcBaseResponse {
  coordinate?: Coordinate;
}

/**
 * Response for tools:check
 */
export interface ToolCheckResponse {
  installed: boolean;
  version?: string;
  detail?: string;
}

/**
 * Response for tools:install
 */
export interface ToolInstallResponse extends IpcBaseResponse {
  /** Version installed if successful */
  version?: string;
}

/**
 * Response for browsers:connect
 */
export interface BrowserConnectResponse extends IpcBaseResponse {
  /** Updated device entry for the connected browser */
  device?: Device;
}

/**
 * Response for browsers:disconnect
 */
export interface BrowserDisconnectResponse extends IpcBaseResponse {}

// ============================================================================
// Push Event Channels (webContents.send / ipcRenderer.on)
// ============================================================================

/**
 * Channel names for push events from main → renderer.
 */
export type IpcPushChannel =
  | 'location:progress'
  | 'location:playbackComplete'
  | 'devices:changed';

/**
 * Push event payloads.
 */
export interface IpcPushPayloads {
  'location:progress': LocationProgressEvent;
  'location:playbackComplete': PlaybackCompleteEvent;
  'devices:changed': DevicesChangedEvent;
}

/**
 * Emitted periodically during route playback with current position.
 */
export interface LocationProgressEvent {
  deviceId: string;
  playbackId: string;
  state: PlaybackState;
}

/**
 * Emitted when route playback completes (reached end or was stopped).
 */
export interface PlaybackCompleteEvent {
  deviceId: string;
  playbackId: string;
  /** Why playback ended */
  reason: 'completed' | 'stopped' | 'error';
  /** Final position */
  finalPosition?: Coordinate;
  /** Error details if reason is 'error' */
  error?: IpcError;
}

/**
 * Emitted when the device list changes (connect/disconnect/state change).
 */
export interface DevicesChangedEvent {
  /** Full updated device list */
  devices: Device[];
  /** What triggered the change */
  changeType: 'added' | 'removed' | 'updated';
  /** ID of the device that changed (if applicable) */
  changedDeviceId?: string;
}

// ============================================================================
// Type Helpers for Type-Safe IPC
// ============================================================================

/**
 * Helper type to get the request payload for a channel.
 */
export type InvokePayload<C extends IpcInvokeChannel> = IpcInvokePayloads[C];

/**
 * Helper type to get the response type for a channel.
 */
export type InvokeResponse<C extends IpcInvokeChannel> = IpcInvokeResponses[C];

/**
 * Helper type to get the event payload for a push channel.
 */
export type PushPayload<C extends IpcPushChannel> = IpcPushPayloads[C];
