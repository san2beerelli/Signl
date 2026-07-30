/**
 * Geo Math
 *
 * Pure geometry helpers for the map: haversine distance and interpolation
 * along a route's line-string geometry.
 */

/** Haversine distance in meters between two [longitude, latitude] points. */
export const distanceBetween = (a: [number, number], b: [number, number]): number => {
  const R = 6_371_000;
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const Δφ = ((b[1] - a[1]) * Math.PI) / 180;
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180;
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

/**
 * Linearly interpolate a [longitude, latitude] position at `targetMeters`
 * along `geometry`, using a pre-built cumulative distance array.
 */
export const interpolateAlongRoute = (
  geometry: [number, number][],
  cumDist: number[],
  targetMeters: number
): [number, number] => {
  for (let i = 0; i < geometry.length - 1; i++) {
    const segEnd = cumDist[i + 1]!;
    if (targetMeters <= segEnd) {
      const segStart = cumDist[i]!;
      const t = segEnd === segStart ? 0 : (targetMeters - segStart) / (segEnd - segStart);
      const a = geometry[i]!;
      const b = geometry[i + 1]!;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
  }
  return geometry[geometry.length - 1]!;
};
