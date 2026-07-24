/**
 * Coordinate Validation
 *
 * Shared between renderer (to block invalid IPC calls) and main
 * (to defend the backend boundary). Returns human-readable messages.
 */

import type { Coordinate } from './types/device.js';

export interface CoordinateValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a coordinate against the documented ranges:
 *
 *   Latitude:  -90 to 90
 *   Longitude: -180 to 180
 *   Heading:   0 to 360
 *   Speed:     >= 0
 *   Accuracy:  >= 0
 *   Altitude:  any finite number
 */
export function validateCoordinate(coordinate: Coordinate): CoordinateValidationResult {
  const errors: string[] = [];

  if (!Number.isFinite(coordinate.latitude)) {
    errors.push('Latitude is required and must be a number.');
  } else if (coordinate.latitude < -90 || coordinate.latitude > 90) {
    errors.push('Latitude must be between -90 and 90.');
  }

  if (!Number.isFinite(coordinate.longitude)) {
    errors.push('Longitude is required and must be a number.');
  } else if (coordinate.longitude < -180 || coordinate.longitude > 180) {
    errors.push('Longitude must be between -180 and 180.');
  }

  if (coordinate.altitude !== undefined && !Number.isFinite(coordinate.altitude)) {
    errors.push('Altitude must be a finite number.');
  }

  if (coordinate.speed !== undefined) {
    if (!Number.isFinite(coordinate.speed) || coordinate.speed < 0) {
      errors.push('Speed must be a number greater than or equal to 0.');
    }
  }

  if (coordinate.heading !== undefined) {
    if (!Number.isFinite(coordinate.heading) || coordinate.heading < 0 || coordinate.heading > 360) {
      errors.push('Heading must be between 0 and 360.');
    }
  }

  if (coordinate.accuracy !== undefined) {
    if (!Number.isFinite(coordinate.accuracy) || coordinate.accuracy < 0) {
      errors.push('Accuracy must be a number greater than or equal to 0.');
    }
  }

  return { valid: errors.length === 0, errors };
}
