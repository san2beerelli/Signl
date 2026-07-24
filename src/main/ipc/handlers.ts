/**
 * IPC Handlers
 *
 * Registers all ipcMain.handle() calls for request/response channels.
 * Each handler delegates to the appropriate backend module.
 */

import { ipcMain, app } from 'electron';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DevicesListResponse,
  UserLocationResponse,
  HomeLocationResponse,
  SetHomeLocationRequest,
  LocationSetResponse,
  StartRouteResponse,
  StopRouteResponse,
  ResetLocationResponse,
  ReverseGeocodeResponse,
  GetDirectionsResponse,
  GpxImportResponse,
  GpxExportResponse,
  ToolCheckResponse,
  ToolInstallResponse,
  LocationSetRequest,
  StartRouteRequest,
  StopRouteRequest,
  ResetLocationRequest,
  ReverseGeocodeRequest,
  GetDirectionsRequest,
  GpxImportRequest,
  GpxExportRequest,
  ToolCheckRequest,
  ToolInstallRequest,
  BrowserConnectRequest,
  BrowserConnectResponse,
  BrowserDisconnectRequest,
  BrowserDisconnectResponse,
} from '@shared/types/index.js';
import { discoverAllDevices, getBackendForKind } from '../devices/discovery.js';
import type { DeviceKind, IpcError, IpcErrorCode, TravelMode } from '@shared/types/index.js';
import { validateCoordinate } from '@shared/coordinateValidation.js';
import { NotSupportedError, BackendError } from '../backends/types.js';
import { connectExternalBrowser, disconnectExternalBrowser, browserIdFrom } from '../backends/browserExternal.js';

const execAsync = promisify(exec);

const KNOWN_ERROR_CODES: IpcErrorCode[] = [
  'NOT_SUPPORTED',
  'VALIDATION_ERROR',
  'NOT_BOOTED',
  'DEVICE_NOT_FOUND',
  'DEVICE_BUSY',
  'DEVICE_OFFLINE',
  'PLAYBACK_ACTIVE',
  'NO_PLAYBACK_ACTIVE',
  'INVALID_WAYPOINTS',
  'FILE_NOT_FOUND',
  'PARSE_ERROR',
  'WRITE_ERROR',
  'BACKEND_ERROR',
  'UNKNOWN',
];

/**
 * Maps backend exceptions to structured IPC errors with readable messages.
 * Raw details stay in main-process logs, not in the renderer payload.
 */
function toIpcError(error: unknown): IpcError {
  if (error instanceof NotSupportedError) {
    return { code: 'NOT_SUPPORTED', message: error.message };
  }
  if (error instanceof BackendError) {
    const code = KNOWN_ERROR_CODES.includes(error.code as IpcErrorCode)
      ? (error.code as IpcErrorCode)
      : 'BACKEND_ERROR';
    return { code, message: error.message };
  }
  return {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Unknown error',
  };
}

// Cache of device ID to device kind for quick lookup
const deviceKindCache = new Map<string, DeviceKind>();

/**
 * Registers all IPC handlers. Call once during app initialization.
 */
export function registerIpcHandlers(): void {
  // Device discovery
  ipcMain.handle('devices:list', handleDevicesList);

  // User's real location (for centering the map)
  ipcMain.handle('system:getUserLocation', handleGetUserLocation);
  ipcMain.handle('system:getHomeLocation', handleGetHomeLocation);
  ipcMain.handle('system:setHomeLocation', handleSetHomeLocation);

  // Location control
  ipcMain.handle('location:set', handleLocationSet);
  ipcMain.handle('location:startRoute', handleStartRoute);
  ipcMain.handle('location:stopRoute', handleStopRoute);
  ipcMain.handle('location:reset', handleLocationReset);
  ipcMain.handle('location:reverseGeocode', handleReverseGeocode);
  ipcMain.handle('route:getDirections', handleGetDirections);

  // GPX import/export
  ipcMain.handle('gpx:import', handleGpxImport);
  ipcMain.handle('gpx:export', handleGpxExport);

  // Tool checking
  ipcMain.handle('tools:check', handleToolsCheck);

  // Tool installation
  ipcMain.handle('tools:install', handleToolsInstall);

  // Browser connect/disconnect
  ipcMain.handle('browsers:connect', handleBrowserConnect);
  ipcMain.handle('browsers:disconnect', handleBrowserDisconnect);

  console.log('[IPC] All handlers registered');
}

// ============================================================================
// Handler Implementations
// ============================================================================

/**
 * devices:list - Returns all discoverable devices across all backends.
 */
async function handleDevicesList(): Promise<DevicesListResponse> {
  try {
    const devices = await discoverAllDevices();

    // Update device kind cache
    deviceKindCache.clear();
    for (const device of devices) {
      deviceKindCache.set(device.id, device.kind);
    }

    return {
      success: true,
      devices,
    };
  } catch (error) {
    console.error('[IPC] devices:list error:', error);
    return {
      success: false,
      devices: [],
      error: {
        code: 'BACKEND_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * system:getUserLocation - Resolves the user's approximate real position
 * via IP geolocation. Used to center the map on startup; never injected
 * into a device automatically.
 */
interface IpGeolocationProvider {
  url: string;
  parse: (data: Record<string, unknown>) => { latitude: number; longitude: number } | null;
}

// Free keyless services; tried in order since each can rate-limit.
const IP_GEOLOCATION_PROVIDERS: IpGeolocationProvider[] = [
  {
    url: 'https://ipwho.is/',
    parse: (data) =>
      typeof data['latitude'] === 'number' && typeof data['longitude'] === 'number'
        ? { latitude: data['latitude'], longitude: data['longitude'] }
        : null,
  },
  {
    url: 'https://ipinfo.io/json',
    parse: (data) => {
      if (typeof data['loc'] !== 'string') return null;
      const [lat, lng] = data['loc'].split(',').map(Number);
      return lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)
        ? { latitude: lat, longitude: lng }
        : null;
    },
  },
  {
    url: 'https://ipapi.co/json/',
    parse: (data) =>
      typeof data['latitude'] === 'number' && typeof data['longitude'] === 'number'
        ? { latitude: data['latitude'], longitude: data['longitude'] }
        : null,
  },
];

// Use Node's https module (not native fetch) so we can set rejectUnauthorized: false,
// which handles corporate SSL-inspection proxies that present a self-signed CA cert.
function httpsGetJson(
  url: string | URL,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false, headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as Record<string, unknown>);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Timeout'));
    });
    req.on('error', reject);
  });
}

async function handleGetUserLocation(): Promise<UserLocationResponse> {
  for (const provider of IP_GEOLOCATION_PROVIDERS) {
    try {
      const data = await httpsGetJson(provider.url, 5000);
      const coordinate = provider.parse(data);
      if (coordinate) {
        return { success: true, coordinate, approximate: true };
      }
    } catch (error) {
      console.error(`[IPC] system:getUserLocation ${provider.url} failed:`, error);
    }
  }
  return {
    success: false,
    error: {
      code: 'BACKEND_ERROR',
      message: 'Could not determine your location.',
    },
  };
}

/**
 * system:getHomeLocation - Returns the user's saved home/default map center,
 * or success:true with no coordinate when none has been saved yet.
 */
const HOME_LOCATION_FILE = (): string =>
  join(app.getPath('userData'), 'homeLocation.json');

async function handleGetHomeLocation(): Promise<HomeLocationResponse> {
  try {
    const raw = await readFile(HOME_LOCATION_FILE(), 'utf8');
    const parsed = JSON.parse(raw) as { latitude?: unknown; longitude?: unknown };
    if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
      return { success: true, coordinate: { latitude: parsed.latitude, longitude: parsed.longitude } };
    }
    return { success: true };
  } catch {
    // File doesn't exist yet — no home location saved.
    return { success: true };
  }
}

/**
 * system:setHomeLocation - Persists a coordinate as the user's preferred
 * home/default map center so the next startup skips the IP geolocation call.
 */
async function handleSetHomeLocation(
  _event: Electron.IpcMainInvokeEvent,
  request: SetHomeLocationRequest
): Promise<{ success: boolean }> {
  try {
    await writeFile(
      HOME_LOCATION_FILE(),
      JSON.stringify({ latitude: request.coordinate.latitude, longitude: request.coordinate.longitude }),
      'utf8'
    );
    return { success: true };
  } catch (error) {
    console.error('[IPC] system:setHomeLocation write failed:', error);
    return { success: false };
  }
}

/**
 * location:set - Sets a single location on the specified device.
 */
async function handleLocationSet(
  _event: Electron.IpcMainInvokeEvent,
  request: LocationSetRequest
): Promise<LocationSetResponse> {
  console.log('[IPC] location:set', request);

  try {
    if (!request.deviceId) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No device is selected.' },
      };
    }

    const validation = validateCoordinate(request.coordinate);
    if (!validation.valid) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: validation.errors.join(' ') },
      };
    }

    const kind = deviceKindCache.get(request.deviceId);
    if (!kind) {
      return {
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: `Device not found: ${request.deviceId}` },
      };
    }

    const backend = getBackendForKind(kind);
    const applied = await backend.setLocation(request.deviceId, request.coordinate);

    return {
      success: true,
      coordinate: applied,
    };
  } catch (error) {
    console.error('[IPC] location:set error:', error);
    return {
      success: false,
      error: toIpcError(error),
    };
  }
}

/**
 * location:startRoute - Starts continuous route playback.
 *
 * TODO: Implement playback loop in main process:
 * 1. Use Turf.js to calculate total route distance
 * 2. Start interval timer
 * 3. Interpolate position along route based on elapsed time & speed
 * 4. Send position to device via backend
 * 5. Emit location:progress events to renderer
 */
async function handleStartRoute(
  _event: Electron.IpcMainInvokeEvent,
  request: StartRouteRequest
): Promise<StartRouteResponse> {
  console.log('[IPC] location:startRoute', {
    deviceId: request.deviceId,
    waypointCount: request.waypoints.length,
    speed: request.speedMetersPerSecond,
  });

  // Generate unique playback ID
  const playbackId = `playback-${Date.now()}`;

  // Mock success response
  return {
    success: true,
    playbackId,
  };
}

/**
 * location:stopRoute - Stops active route playback.
 *
 * TODO: Clear playback interval and emit playbackComplete event
 */
async function handleStopRoute(
  _event: Electron.IpcMainInvokeEvent,
  request: StopRouteRequest
): Promise<StopRouteResponse> {
  console.log('[IPC] location:stopRoute', request);

  return {
    success: true,
    stoppedAt: {
      latitude: 37.7749,
      longitude: -122.4194,
    },
  };
}

/**
 * location:reset - Resets device to real/default location.
 */
async function handleLocationReset(
  _event: Electron.IpcMainInvokeEvent,
  request: ResetLocationRequest
): Promise<ResetLocationResponse> {
  console.log('[IPC] location:reset', request);

  try {
    const kind = deviceKindCache.get(request.deviceId);
    if (!kind) {
      return {
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: `Device not found: ${request.deviceId}` },
      };
    }

    const backend = getBackendForKind(kind);
    await backend.reset(request.deviceId);

    return { success: true };
  } catch (error) {
    console.error('[IPC] location:reset error:', error);
    return {
      success: false,
      error: toIpcError(error),
    };
  }
}

/**
 * location:reverseGeocode - Resolves a coordinate to a short human-readable
 * address (e.g. "11 Maple St") via OpenStreetMap's Nominatim, matching the
 * base map tiles already in use. Nominatim's usage policy caps the public
 * instance at 1 request/second and requires an identifying User-Agent —
 * fine for interactive, one-click-at-a-time use like this, not for bulk
 * lookups.
 */
async function handleReverseGeocode(
  _event: Electron.IpcMainInvokeEvent,
  request: ReverseGeocodeRequest
): Promise<ReverseGeocodeResponse> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(request.latitude));
    url.searchParams.set('lon', String(request.longitude));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');

    console.log('[IPC] location:reverseGeocode →', url.toString());

    const data = (await httpsGetJson(url, 5000, {
      'User-Agent': 'Signl-Desktop-App',
    })) as {
      display_name?: string;
      address?: Record<string, string>;
    };

    const address = formatShortAddress(data);
    if (!address) {
      return {
        success: false,
        error: { code: 'BACKEND_ERROR', message: 'No address found for this location.' },
      };
    }

    console.log('[IPC] location:reverseGeocode ←', address);

    return { success: true, address };
  } catch (error) {
    console.error('[IPC] location:reverseGeocode error:', error);
    return {
      success: false,
      error: {
        code: 'BACKEND_ERROR',
        message: error instanceof Error ? error.message : 'Reverse geocoding failed.',
      },
    };
  }
}

/**
 * Builds a short "11 Maple St"-style address from a Nominatim response,
 * falling back to progressively coarser pieces when a street-level match
 * isn't available (e.g. clicks in the middle of a field or lake).
 */
function formatShortAddress(data: { display_name?: string; address?: Record<string, string> }): string | undefined {
  const address = data.address;
  if (address) {
    const road = address['road'] ?? address['pedestrian'] ?? address['neighbourhood'];
    if (road) {
      return address['house_number'] ? `${address['house_number']} ${road}` : road;
    }
  }

  if (data.display_name) {
    // Fall back to the first couple of comma-separated segments rather
    // than the full (often very long) display name.
    return data.display_name.split(',').slice(0, 2).join(',').trim();
  }

  return undefined;
}

/**
 * Maps the app's travel modes to Valhalla costing models. "run" has no
 * distinct Valhalla profile, so it shares "pedestrian" with "walk".
 */
const VALHALLA_COSTING_BY_TRAVEL_MODE: Record<TravelMode, string> = {
  walk: 'pedestrian',
  run: 'pedestrian',
  bike: 'bicycle',
  car: 'auto',
};

/**
 * route:getDirections - Resolves a road-following route through an ordered
 * list of points via Valhalla's public community demo server (open
 * source, OpenStreetMap-based — same data source as the base map tiles
 * and reverse geocoding). Unlike OSRM's public demo, which only really
 * routes "driving" regardless of which profile URL you call, Valhalla's
 * demo genuinely supports distinct walking/cycling/driving routes. It's a
 * volunteer-run (FOSSGIS e.V.) fair-use service, not an SLA-backed API —
 * fine for light, interactive use, not for bulk/production routing.
 */
async function handleGetDirections(
  _event: Electron.IpcMainInvokeEvent,
  request: GetDirectionsRequest
): Promise<GetDirectionsResponse> {
  if (request.coordinates.length < 2) {
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'At least two points are required.' },
    };
  }

  try {
    const costing = VALHALLA_COSTING_BY_TRAVEL_MODE[request.travelMode ?? 'car'];

    const url = new URL('https://valhalla1.openstreetmap.de/route');
    url.searchParams.set(
      'json',
      JSON.stringify({
        locations: request.coordinates.map((c) => ({ lat: c.latitude, lon: c.longitude })),
        costing,
      })
    );

    console.log('[IPC] route:getDirections →', costing, request.coordinates.length, 'points');

    const data = (await httpsGetJson(url, 8000, {
      'X-Client-Id': 'Signl-Desktop-App',
    })) as {
      trip?: {
        legs?: Array<{ shape?: string }>;
        summary?: { length?: number; time?: number };
      };
    };

    const legs = data.trip?.legs;
    if (!legs || legs.length === 0) {
      return {
        success: false,
        error: { code: 'BACKEND_ERROR', message: 'No route found between these points.' },
      };
    }

    // Each leg's geometry is a separately encoded polyline; stitch them
    // into one continuous line, dropping the duplicate point every two
    // legs share at their shared waypoint.
    const geometry: [number, number][] = [];
    for (const leg of legs) {
      if (!leg.shape) continue;
      const points = decodePolyline(leg.shape);
      geometry.push(...(geometry.length > 0 ? points.slice(1) : points));
    }

    if (geometry.length === 0) {
      return {
        success: false,
        error: { code: 'BACKEND_ERROR', message: 'No route found between these points.' },
      };
    }

    // Valhalla reports length in kilometers; the rest of the app works in meters.
    const distanceMeters =
      data.trip?.summary?.length !== undefined ? data.trip.summary.length * 1000 : undefined;
    const durationSeconds = data.trip?.summary?.time;

    console.log('[IPC] route:getDirections ←', geometry.length, 'points,', distanceMeters, 'm');

    return {
      success: true,
      geometry,
      ...(distanceMeters !== undefined ? { distanceMeters } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    };
  } catch (error) {
    console.error('[IPC] route:getDirections error:', error);
    return {
      success: false,
      error: {
        code: 'BACKEND_ERROR',
        message: error instanceof Error ? error.message : 'Directions request failed.',
      },
    };
  }
}

/**
 * Decodes a Valhalla-style encoded polyline (Google polyline algorithm
 * with 6 decimal places of precision, rather than the usual 5) into
 * [longitude, latitude] pairs (GeoJSON coordinate order).
 */
function decodePolyline(encoded: string): [number, number][] {
  const factor = 1e6;
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lng / factor, lat / factor]);
  }

  return coordinates;
}

/**
 * gpx:import - Parses a GPX file into waypoints.
 *
 * TODO: Use gpx-builder or xml parser to extract waypoints
 */
async function handleGpxImport(
  _event: Electron.IpcMainInvokeEvent,
  request: GpxImportRequest
): Promise<GpxImportResponse> {
  console.log('[IPC] gpx:import', request);

  // Mock imported waypoints
  return {
    success: true,
    waypoints: [
      { id: 'gpx-mock-0', index: 0, latitude: 37.7749, longitude: -122.4194, name: 'San Francisco' },
      { id: 'gpx-mock-1', index: 1, latitude: 37.8044, longitude: -122.2712, name: 'Oakland' },
      { id: 'gpx-mock-2', index: 2, latitude: 37.8716, longitude: -122.2727, name: 'Berkeley' },
    ],
    routeName: 'Bay Area Tour',
  };
}

/**
 * gpx:export - Serializes waypoints to a GPX file.
 *
 * TODO: Use gpx-builder to generate valid GPX XML
 */
async function handleGpxExport(
  _event: Electron.IpcMainInvokeEvent,
  request: GpxExportRequest
): Promise<GpxExportResponse> {
  console.log('[IPC] gpx:export', request);

  return {
    success: true,
    filePath: request.filePath,
  };
}

/**
 * tools:check - Checks if a CLI tool is installed.
 */
async function handleToolsCheck(
  _event: Electron.IpcMainInvokeEvent,
  request: ToolCheckRequest
): Promise<ToolCheckResponse> {
  console.log('[IPC] tools:check', request);

  const { toolId } = request;

  try {
    switch (toolId) {
      case 'xcode': {
        // Check for Xcode CLI tools by running xcrun simctl
        await execAsync('xcrun simctl help', { timeout: 5000 });
        // Extract version from xcode-select
        try {
          const { stdout: versionOut } = await execAsync('xcode-select --version', { timeout: 5000 });
          const versionMatch = versionOut.match(/version (\d+)/);
          return {
            installed: true,
            ...(versionMatch ? { version: `v${versionMatch[1]}` } : {}),
            detail: 'simctl available',
          };
        } catch {
          return { installed: true, detail: 'simctl available' };
        }
      }

      case 'adb': {
        // Check for Android Debug Bridge
        const { stdout } = await execAsync('adb version', { timeout: 5000 });
        const versionMatch = stdout.match(/Android Debug Bridge version ([\d.]+)/);
        return {
          installed: true,
          ...(versionMatch ? { version: `v${versionMatch[1]}` } : {}),
          detail: 'adb available',
        };
      }

      case 'libimobiledevice': {
        // Check for idevice_id command from libimobiledevice
        const { stdout } = await execAsync('idevice_id --version', { timeout: 5000 });
        const versionMatch = stdout.match(/([\d.]+)/);
        return {
          installed: true,
          ...(versionMatch ? { version: `v${versionMatch[1]}` } : {}),
          detail: 'libimobiledevice available',
        };
      }

      case 'idevicelocation': {
        // Check for idevicelocation
        await execAsync('which idevicelocation', { timeout: 5000 });
        return {
          installed: true,
          detail: 'idevicelocation available',
        };
      }

      case 'ideviceimagemounter': {
        // Check for ideviceimagemounter
        await execAsync('which ideviceimagemounter', { timeout: 5000 });
        return {
          installed: true,
          detail: 'ideviceimagemounter available',
        };
      }

      default:
        return { installed: false, detail: `Unknown tool: ${toolId}` };
    }
  } catch {
    return { installed: false };
  }
}

/**
 * tools:install - Installs a CLI tool via Homebrew.
 */
async function handleToolsInstall(
  _event: Electron.IpcMainInvokeEvent,
  request: ToolInstallRequest
): Promise<ToolInstallResponse> {
  console.log('[IPC] tools:install', request);

  const { toolId } = request;

  // Map tool IDs to brew install commands (some need taps)
  const brewCommands: Record<string, { tap?: string; package: string }> = {
    libimobiledevice: { package: 'libimobiledevice' },
    ideviceimagemounter: { package: 'libimobiledevice' }, // Part of libimobiledevice
    // Note: idevicelocation must be built from source, not available via brew
  };

  const brewInfo = brewCommands[toolId];
  if (!brewInfo) {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: `Tool "${toolId}" cannot be installed via this method`,
      },
    };
  }

  try {
    // Check if brew is available
    await execAsync('which brew', { timeout: 5000 });
  } catch {
    return {
      success: false,
      error: {
        code: 'BACKEND_ERROR',
        message: 'Homebrew is not installed. Please install Homebrew first: https://brew.sh',
      },
    };
  }

  try {
    // Add tap if required
    if (brewInfo.tap) {
      console.log(`[IPC] Adding tap ${brewInfo.tap}...`);
      try {
        await execAsync(`brew tap ${brewInfo.tap}`, { timeout: 60000 });
      } catch (tapError) {
        // Tap might already exist, continue anyway
        console.log('[IPC] Tap may already exist, continuing...');
      }
    }

    console.log(`[IPC] Installing ${brewInfo.package} via brew...`);

    // Run brew install (this can take a while)
    const { stdout, stderr } = await execAsync(`brew install ${brewInfo.package}`, {
      timeout: 300000, // 5 minute timeout for installation
    });

    console.log('[IPC] brew install stdout:', stdout);
    if (stderr) {
      console.log('[IPC] brew install stderr:', stderr);
    }

    // Verify installation by checking the tool
    const checkResult = await handleToolsCheck(_event, { toolId });

    if (checkResult.installed) {
      return {
        success: true,
        ...(checkResult.version !== undefined ? { version: checkResult.version } : {}),
      };
    } else {
      return {
        success: false,
        error: {
          code: 'BACKEND_ERROR',
          message: 'Installation completed but tool verification failed',
        },
      };
    }
  } catch (error) {
    console.error('[IPC] tools:install error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check for common errors
    if (errorMessage.includes('already installed')) {
      // Tool is already installed, verify it
      const checkResult = await handleToolsCheck(_event, { toolId });
      if (checkResult.installed) {
        return {
          success: true,
          ...(checkResult.version !== undefined ? { version: checkResult.version } : {}),
        };
      }
    }

    return {
      success: false,
      error: {
        code: 'BACKEND_ERROR',
        message: errorMessage,
      },
    };
  }
}

/**
 * browsers:connect — Launches (or reconnects to) an external browser with
 * remote debugging enabled, then returns the updated device entry.
 */
async function handleBrowserConnect(
  _event: Electron.IpcMainInvokeEvent,
  request: BrowserConnectRequest
): Promise<BrowserConnectResponse> {
  console.log('[IPC] browsers:connect', request.browserId);
  try {
    const device = await connectExternalBrowser(request.browserId);
    // Update the device kind cache so location:set can resolve this device.
    deviceKindCache.set(device.id, device.kind);
    return { success: true, device };
  } catch (error) {
    console.error('[IPC] browsers:connect error:', error);
    return { success: false, error: toIpcError(error) };
  }
}

/**
 * browsers:disconnect — Disconnects from an external browser, clears its
 * geolocation override, and kills the process if we launched it.
 */
async function handleBrowserDisconnect(
  _event: Electron.IpcMainInvokeEvent,
  request: BrowserDisconnectRequest
): Promise<BrowserDisconnectResponse> {
  console.log('[IPC] browsers:disconnect', request.deviceId);
  try {
    const browserId = browserIdFrom(request.deviceId);
    await disconnectExternalBrowser(browserId);
    deviceKindCache.delete(request.deviceId);
    return { success: true };
  } catch (error) {
    console.error('[IPC] browsers:disconnect error:', error);
    return { success: false, error: toIpcError(error) };
  }
}
