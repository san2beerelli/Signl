/**
 * Route Playback Math
 *
 * Linear interpolation along a waypoint sequence — used to compute the
 * simulated position and bearing at each tick of route playback.
 */

/**
 * Simple linear interpolation along a sequence of waypoints.
 * Returns { lat, lng, bearing } at a given distance from route start.
 */
export const interpolatePosition = (
  waypoints: { latitude: number; longitude: number }[],
  targetDistanceMeters: number
): { latitude: number; longitude: number; bearing: number; waypointIndex: number } => {
  let accumulated = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;

    const segLat = b.latitude - a.latitude;
    const segLng = b.longitude - a.longitude;
    // Approximate metres using equirectangular projection
    const segMeters = Math.sqrt(
      (segLat * 111_320) ** 2 + (segLng * 111_320 * Math.cos((a.latitude * Math.PI) / 180)) ** 2
    );

    if (accumulated + segMeters >= targetDistanceMeters) {
      const t = (targetDistanceMeters - accumulated) / segMeters;
      const bearing = (Math.atan2(segLng * Math.cos((a.latitude * Math.PI) / 180), segLat) * 180) / Math.PI;
      return {
        latitude: a.latitude + t * segLat,
        longitude: a.longitude + t * segLng,
        bearing: (bearing + 360) % 360,
        waypointIndex: i + 1,
      };
    }

    accumulated += segMeters;
  }

  const last = waypoints[waypoints.length - 1]!;
  return { latitude: last.latitude, longitude: last.longitude, bearing: 0, waypointIndex: waypoints.length - 1 };
};

/** Compute total route distance in metres between all waypoints. */
export const totalRouteMeters = (waypoints: { latitude: number; longitude: number }[]): number => {
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    const dLat = b.latitude - a.latitude;
    const dLng = b.longitude - a.longitude;
    total += Math.sqrt((dLat * 111_320) ** 2 + (dLng * 111_320 * Math.cos((a.latitude * Math.PI) / 180)) ** 2);
  }
  return total;
};
