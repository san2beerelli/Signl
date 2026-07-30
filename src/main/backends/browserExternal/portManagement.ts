/**
 * Debug Port Management
 *
 * Picks a free port for a newly-spawned browser instance, and scans the
 * managed range for a CDP endpoint the user already launched themselves
 * with `--remote-debugging-port`.
 */

import { BackendError } from '../types.js';
import { fetchCdpVersion } from './cdpTransport.js';
import { sessions } from './sessionState.js';

export const PORT_RANGE_START = 9222;
export const PORT_RANGE_END = 9260;

/** Return a port that isn't already claimed by an active session. */
export const pickFreePort = (): number => {
  const used = new Set([...sessions.values()].map((s) => s.port));
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!used.has(p)) return p;
  }
  throw new BackendError('No free debug port available (all ports 9222-9260 in use).', 'BACKEND_ERROR');
};

/**
 * Substrings that identify a browser brand from its CDP `Browser` version
 * string (e.g. "Chrome/120.0.6099.129", "Edg/120.0.2210.91"). Best-effort:
 * several Chromium-based browsers (Brave, Arc, Vivaldi) deliberately
 * self-report as "Chrome" for web compatibility, so this can reliably tell
 * real Chrome/Edge/Opera apart from each other, but can't distinguish
 * Chrome from Brave/Arc/Vivaldi — those fall back to matching on "Chrome"
 * like real Chrome does. Good enough to adopt *a* manually-launched
 * debuggable browser; not a guarantee it's exactly the clicked brand.
 */
const CDP_BRAND_HINTS: Record<string, string[]> = {
  chrome: ['Chrome'],
  edge: ['Edg'],
  opera: ['OPR', 'Opera'],
  brave: ['Chrome'],
  arc: ['Chrome'],
  chromium: ['Chromium', 'Chrome'],
  vivaldi: ['Chrome'],
};

/**
 * Scans the managed port range for a CDP endpoint that isn't already one of
 * our own sessions and whose reported browser brand matches `browserId`.
 * Lets "Connect" adopt a browser the user started themselves with
 * `--remote-debugging-port`, instead of always spawning a new isolated
 * instance — see the macOS single-instance note on `connectExternalBrowser`.
 */
export const findExternallyLaunchedSession = async (browserId: string): Promise<number | null> => {
  const hints = CDP_BRAND_HINTS[browserId];
  if (!hints) return null;

  const claimedPorts = new Set([...sessions.values()].map((s) => s.port));
  const candidatePorts: number[] = [];
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!claimedPorts.has(p)) candidatePorts.push(p);
  }

  const results = await Promise.all(
    candidatePorts.map(async (port) => ({ port, version: await fetchCdpVersion(port) }))
  );

  const match = results.find(
    ({ version }) => version?.Browser && hints.some((hint) => version.Browser!.includes(hint))
  );

  return match?.port ?? null;
};
