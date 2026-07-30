/**
 * System location handlers — the user's approximate IP-based location
 * (for centering the map) and the persisted "home" location the user can
 * drag the blue dot to, which takes priority over IP geolocation.
 */

import { app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { httpsGetJson } from './httpClient.js';
import type { UserLocationResponse, HomeLocationResponse, SetHomeLocationRequest } from '@shared/types/index.js';

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

/**
 * system:getUserLocation - Resolves the user's approximate real position
 * via IP geolocation. Used to center the map on startup; never injected
 * into a device automatically.
 */
export const handleGetUserLocation = async (): Promise<UserLocationResponse> => {
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
};

const HOME_LOCATION_FILE = (): string => join(app.getPath('userData'), 'homeLocation.json');

/**
 * system:getHomeLocation - Returns the user's saved home/default map center,
 * or success:true with no coordinate when none has been saved yet.
 */
export const handleGetHomeLocation = async (): Promise<HomeLocationResponse> => {
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
};

/**
 * system:setHomeLocation - Persists a coordinate as the user's preferred
 * home/default map center so the next startup skips the IP geolocation call.
 */
export const handleSetHomeLocation = async (
  _event: Electron.IpcMainInvokeEvent,
  request: SetHomeLocationRequest
): Promise<{ success: boolean }> => {
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
};
