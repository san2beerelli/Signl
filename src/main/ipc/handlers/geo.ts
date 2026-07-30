/**
 * Geo handlers — reverse geocoding (Nominatim) and road-following
 * directions (Valhalla), plus the polyline decoder Valhalla's shapes need.
 */

import { httpsGetJson } from './httpClient.js';
import type {
  ReverseGeocodeRequest,
  ReverseGeocodeResponse,
  GetDirectionsRequest,
  GetDirectionsResponse,
  TravelMode,
} from '@shared/types/index.js';

/**
 * location:reverseGeocode - Resolves a coordinate to a short human-readable
 * address (e.g. "11 Maple St") via OpenStreetMap's Nominatim, matching the
 * base map tiles already in use. Nominatim's usage policy caps the public
 * instance at 1 request/second and requires an identifying User-Agent —
 * fine for interactive, one-click-at-a-time use like this, not for bulk
 * lookups.
 */
export const handleReverseGeocode = async (
  _event: Electron.IpcMainInvokeEvent,
  request: ReverseGeocodeRequest
): Promise<ReverseGeocodeResponse> => {
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
};

/**
 * Builds a short "11 Maple St"-style address from a Nominatim response,
 * falling back to progressively coarser pieces when a street-level match
 * isn't available (e.g. clicks in the middle of a field or lake).
 */
const formatShortAddress = (
  data: { display_name?: string; address?: Record<string, string> }
): string | undefined => {
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
};

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
export const handleGetDirections = async (
  _event: Electron.IpcMainInvokeEvent,
  request: GetDirectionsRequest
): Promise<GetDirectionsResponse> => {
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
};

/**
 * Decodes a Valhalla-style encoded polyline (Google polyline algorithm
 * with 6 decimal places of precision, rather than the usual 5) into
 * [longitude, latitude] pairs (GeoJSON coordinate order).
 */
const decodePolyline = (encoded: string): [number, number][] => {
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
};
