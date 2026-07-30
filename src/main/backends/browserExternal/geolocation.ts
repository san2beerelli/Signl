/**
 * Geolocation Overrides
 *
 * Grants the geolocation permission and applies/clears CDP
 * `Emulation.setGeolocationOverride` across a session's open page targets.
 */

import type { Coordinate } from '@shared/types/index.js';
import { BackendError } from '../types.js';
import {
  fetchCdpTargets,
  fetchCdpVersion,
  getOrCreatePageSocket,
  sendOneShotCdpCommand,
  sendOnSocket,
} from './cdpTransport.js';
import type { CdpTarget } from './cdpTransport.js';
import type { CdpSession } from './sessionState.js';

export const DEFAULT_ACCURACY = 5;

/**
 * Grants the geolocation permission at the browser-context level so pages
 * don't need to show (or silently block on) a permission prompt before
 * `navigator.geolocation` reflects the overridden position. Best-effort —
 * very old browser builds may not support `Browser.grantPermissions`.
 */
export const grantGeolocationPermission = async (port: number): Promise<void> => {
  const info = await fetchCdpVersion(port, 3000);
  if (!info?.webSocketDebuggerUrl) return;
  await sendOneShotCdpCommand(info.webSocketDebuggerUrl, 'Browser.grantPermissions', {
    permissions: ['geolocation'],
  }).catch(() => {
    // Non-fatal — the override may still work if the origin already had
    // permission from a previous grant/click-through.
  });
};

/** Apply a geolocation override to all open page targets. */
export const applyGeolocationToAllPages = async (session: CdpSession, coordinate: Coordinate): Promise<void> => {
  let targets: CdpTarget[];
  try {
    targets = await fetchCdpTargets(session.port, 3000);
  } catch (error) {
    throw new BackendError(
      `Cannot reach CDP endpoint on port ${session.port} — is the browser still open?`,
      'DEVICE_OFFLINE',
      error
    );
  }

  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (pages.length === 0) {
    // No open pages — that's fine, nothing to update.
    console.log(`[Browser External] setLocation: no page targets on port ${session.port} — nothing to update.`);
    return;
  }

  const params = {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    accuracy: coordinate.accuracy ?? DEFAULT_ACCURACY,
  };

  const results = await Promise.allSettled(
    pages.map(async (target) => {
      const ws = await getOrCreatePageSocket(session, target);
      await sendOnSocket(ws, 'Emulation.setGeolocationOverride', params);
    })
  );

  // Promise.allSettled never rejects, so a failure here would otherwise be
  // completely silent — the caller would report "success" even if every
  // page-level command actually failed. Log each one, and only treat it as
  // an overall failure if literally nothing got through (a partial success
  // across several tabs is still useful).
  const failures = results
    .map((r, i) => ({ r, target: pages[i]! }))
    .filter((x): x is { r: PromiseRejectedResult; target: CdpTarget } => x.r.status === 'rejected');

  for (const { r, target } of failures) {
    console.error(`[Browser External] setLocation failed for "${target.title}" (${target.url}):`, r.reason);
  }

  if (failures.length === results.length) {
    throw new BackendError(
      `Could not apply the location to any open tab (${failures.length} of ${results.length} failed). ` +
        'Check the main-process log for details.',
      'BACKEND_ERROR',
      failures.map((f) => f.r.reason)
    );
  }
};

/** Clear the geolocation override on all pages. */
export const clearGeolocationOnAllPages = async (session: CdpSession): Promise<void> => {
  let targets: CdpTarget[];
  try {
    targets = await fetchCdpTargets(session.port, 3000);
  } catch {
    return; // Browser already closed — nothing to clear.
  }

  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  await Promise.allSettled(
    pages.map(async (target) => {
      const ws = await getOrCreatePageSocket(session, target);
      await sendOnSocket(ws, 'Emulation.clearGeolocationOverride', {});
    })
  );
};
