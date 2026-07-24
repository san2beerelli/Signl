/**
 * External Browser Backend
 *
 * Discovers Chromium-based browsers installed on the host Mac, launches them
 * with a remote-debugging port, and controls geolocation via CDP
 * (Emulation.setGeolocationOverride).
 *
 * Supported browsers: Chrome, Edge, Brave, Arc, Chromium, Vivaldi, Opera.
 *
 * CDP Flow:
 *   1. Launch browser with --remote-debugging-port=PORT
 *   2. GET http://localhost:PORT/json → list of open page targets
 *   3. WebSocket to each target's webSocketDebuggerUrl
 *   4. Send Emulation.setGeolocationOverride (lat/lng/accuracy)
 *
 * Route playback mirrors the embedded backend — the handler calls
 * setLocation on a fixed interval, updating all open pages each tick.
 */

import { spawn } from 'node:child_process';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import type { Device, Coordinate, DeviceCapabilities } from '@shared/types/index.js';
import type {
  DeviceBackend,
  StartRouteOptions,
  RouteProgressCallback,
  PlaybackCompleteCallback,
} from './types.js';
import { BackendError } from './types.js';

// ─── Browser catalogue ───────────────────────────────────────────────────────

interface BrowserDef {
  /** Short stable identifier — used in device IDs and session map keys */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Absolute path to the macOS binary */
  execPath: string;
  /** Icon name used in the drawer (future) */
  iconName: string;
}

const KNOWN_BROWSERS: BrowserDef[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    execPath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    iconName: 'chrome',
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    execPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    iconName: 'edge',
  },
  {
    id: 'brave',
    name: 'Brave Browser',
    execPath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    iconName: 'brave',
  },
  {
    id: 'arc',
    name: 'Arc',
    execPath: '/Applications/Arc.app/Contents/MacOS/Arc',
    iconName: 'arc',
  },
  {
    id: 'chromium',
    name: 'Chromium',
    execPath: '/Applications/Chromium.app/Contents/MacOS/Chromium',
    iconName: 'chromium',
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    execPath: '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
    iconName: 'vivaldi',
  },
  {
    id: 'opera',
    name: 'Opera',
    execPath: '/Applications/Opera.app/Contents/MacOS/Opera',
    iconName: 'opera',
  },
];

// ─── Capability declaration ──────────────────────────────────────────────────

const BROWSER_EXTERNAL_CAPABILITIES: DeviceCapabilities = {
  setLocation: true,
  resetLocation: true,
  routePlayback: true,
  pauseRoute: false,
  altitude: false,
  speed: false,
  heading: false,
  accuracy: true,
};

// ─── Session state ───────────────────────────────────────────────────────────

interface CdpSession {
  port: number;
  /** PID of the browser process we launched (undefined if pre-existing) */
  pid?: number;
  /**
   * Persistent per-page-target WebSocket connections. `Emulation.*`
   * overrides (geolocation included) are scoped to the CDP client session —
   * Chrome reverts them the moment the debugger connection closes — so
   * these have to stay open for the override to actually stick, rather
   * than reconnecting for every command.
   */
  pageSockets: Map<string, WebSocket>;
}

/** browserId → active CDP session */
const sessions = new Map<string, CdpSession>();

/** playbackId → active playback timer */
const activePlaybacks = new Map<string, NodeJS.Timeout>();

// ─── File-system helpers ─────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Return BrowserDef entries that have an installed binary on disk. */
async function findInstalledBrowsers(): Promise<BrowserDef[]> {
  const results = await Promise.all(
    KNOWN_BROWSERS.map(async (b) => ({ browser: b, installed: await fileExists(b.execPath) }))
  );
  return results.filter((r) => r.installed).map((r) => r.browser);
}

// ─── Port management ─────────────────────────────────────────────────────────

const PORT_RANGE_START = 9222;
const PORT_RANGE_END = 9260;

/** Return a port that isn't already claimed by an active session. */
function pickFreePort(): number {
  const used = new Set([...sessions.values()].map((s) => s.port));
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!used.has(p)) return p;
  }
  throw new BackendError('No free debug port available (all ports 9222-9260 in use).', 'BACKEND_ERROR');
}

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
async function findExternallyLaunchedSession(browserId: string): Promise<number | null> {
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
}

// ─── CDP HTTP helpers ────────────────────────────────────────────────────────

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/**
 * GET http://localhost:PORT/json and return parsed target list.
 *
 * The `Host` header must be `localhost:<port>`, not just `localhost` —
 * Chrome's DevTools endpoint echoes the request's Host header back into
 * each target's `webSocketDebuggerUrl`. Omitting the port here means
 * every returned URL is missing it too (`ws://localhost/devtools/...`),
 * and a bare `ws://` URL with no port defaults to port 80 — which is not
 * where the browser is listening.
 */
function fetchCdpTargets(port: number, timeoutMs = 5000): Promise<CdpTarget[]> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/json', headers: { Host: `localhost:${port}` } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { body += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as CdpTarget[]);
          } catch (e) {
            reject(new Error(`Failed to parse /json response: ${e}`));
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('CDP /json timeout')); });
    req.on('error', reject);
  });
}

/**
 * GET http://localhost:PORT/json/version — returns `null` if nothing's
 * listening on the port, or it doesn't look like a CDP endpoint. Used to
 * probe for browsers the user launched with `--remote-debugging-port`
 * themselves, without waiting the full connect timeout on every dead port.
 * `webSocketDebuggerUrl` here is the *browser-level* endpoint (for
 * `Browser.*` commands like granting permissions) — distinct from each
 * page target's own `webSocketDebuggerUrl` used for `Emulation.*` commands.
 */
function fetchCdpVersion(
  port: number,
  timeoutMs = 800
): Promise<{ Browser?: string; webSocketDebuggerUrl?: string } | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/json/version', headers: { Host: `localhost:${port}` } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { body += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as { Browser?: string; webSocketDebuggerUrl?: string });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** Poll `http://localhost:PORT/json` until it responds (browser is ready). */
async function waitForCdp(port: number, maxMs = 20_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetchCdpTargets(port, 1500);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new BackendError(
    `Browser did not expose its CDP endpoint on port ${port} within ${maxMs}ms.`,
    'BACKEND_ERROR'
  );
}

// ─── CDP WebSocket command ───────────────────────────────────────────────────

/**
 * Send a single CDP command over a fresh WebSocket, then close the socket.
 * Only safe for commands whose effect persists independently of the
 * debugger connection (e.g. `Browser.grantPermissions`) — NOT for
 * `Emulation.*` overrides, which are torn down the moment this socket
 * closes. Use `getOrCreatePageSocket` + `sendOnSocket` for those.
 */
function sendOneShotCdpCommand(
  wsUrl: string,
  method: string,
  params: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let done = false;

    const finish = (err?: Error): void => {
      if (done) return;
      done = true;
      try { ws.close(); } catch { /* best-effort */ }
      if (err) reject(err);
      else resolve();
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method, params }), (sendErr) => {
        if (sendErr) { finish(sendErr); return; }
        // Give the browser a moment to apply the command before we close.
        setTimeout(() => finish(), 150);
      });
    });

    ws.on('error', (err) => finish(err));

    // Safety timeout
    const guard = setTimeout(() => finish(new Error('CDP WebSocket timed out')), 4000);
    ws.on('close', () => clearTimeout(guard));
  });
}

let nextCdpMessageId = 1;

/** Send a CDP command over an already-open socket. Does not close it. */
function sendOnSocket(ws: WebSocket, method: string, params: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(JSON.stringify({ id: nextCdpMessageId++, method, params }), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Returns a persistent, already-open WebSocket for a page target, reusing
 * the session's cached connection when possible. `Emulation.*` overrides
 * only stick for as long as this connection stays open, so callers must
 * NOT close what this returns — it's closed centrally via
 * `closeAllPageSockets` on disconnect, or automatically dropped from the
 * cache if the page itself closes/navigates away underneath us.
 */
function getOrCreatePageSocket(session: CdpSession, target: CdpTarget): Promise<WebSocket> {
  const existing = session.pageSockets.get(target.id);
  if (existing && existing.readyState === WebSocket.OPEN) {
    return Promise.resolve(existing);
  }
  if (existing) {
    session.pageSockets.delete(target.id);
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl!);

    const guard = setTimeout(() => {
      ws.terminate();
      reject(new Error('CDP WebSocket connect timed out'));
    }, 4000);

    ws.once('open', () => {
      clearTimeout(guard);
      session.pageSockets.set(target.id, ws);
      resolve(ws);
    });

    ws.once('error', (err) => {
      clearTimeout(guard);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    // The page closed or navigated to a different target — Chrome closes
    // this socket on its own. Drop it from the cache so the next call
    // reconnects instead of reusing a dead connection.
    ws.on('close', () => {
      if (session.pageSockets.get(target.id) === ws) {
        session.pageSockets.delete(target.id);
      }
    });
  });
}

/** Closes and forgets every persistent per-page socket for a session. */
function closeAllPageSockets(session: CdpSession): void {
  for (const ws of session.pageSockets.values()) {
    try { ws.close(); } catch { /* best-effort */ }
  }
  session.pageSockets.clear();
}

// ─── Geolocation helpers ─────────────────────────────────────────────────────

const DEFAULT_ACCURACY = 5;

/**
 * Grants the geolocation permission at the browser-context level so pages
 * don't need to show (or silently block on) a permission prompt before
 * `navigator.geolocation` reflects the overridden position. Best-effort —
 * very old browser builds may not support `Browser.grantPermissions`.
 */
async function grantGeolocationPermission(port: number): Promise<void> {
  const info = await fetchCdpVersion(port, 3000);
  if (!info?.webSocketDebuggerUrl) return;
  await sendOneShotCdpCommand(info.webSocketDebuggerUrl, 'Browser.grantPermissions', {
    permissions: ['geolocation'],
  }).catch(() => {
    // Non-fatal — the override may still work if the origin already had
    // permission from a previous grant/click-through.
  });
}

/** Apply a geolocation override to all open page targets. */
async function applyGeolocationToAllPages(
  session: CdpSession,
  coordinate: Coordinate
): Promise<void> {
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
    console.error(
      `[Browser External] setLocation failed for "${target.title}" (${target.url}):`,
      r.reason
    );
  }

  if (failures.length === results.length) {
    throw new BackendError(
      `Could not apply the location to any open tab (${failures.length} of ${results.length} failed). ` +
        'Check the main-process log for details.',
      'BACKEND_ERROR',
      failures.map((f) => f.r.reason)
    );
  }
}

/** Clear the geolocation override on all pages. */
async function clearGeolocationOnAllPages(session: CdpSession): Promise<void> {
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
}

// ─── Route playback ──────────────────────────────────────────────────────────

const PLAYBACK_INTERVAL_MS = 1000;

/**
 * Simple linear interpolation along a sequence of waypoints.
 * Returns { lat, lng, bearing } at a given distance from route start.
 */
function interpolatePosition(
  waypoints: { latitude: number; longitude: number }[],
  targetDistanceMeters: number
): { latitude: number; longitude: number; bearing: number; waypointIndex: number } {
  let accumulated = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;

    const segLat = b.latitude - a.latitude;
    const segLng = b.longitude - a.longitude;
    // Approximate metres using equirectangular projection
    const segMeters = Math.sqrt(
      (segLat * 111_320) ** 2 +
      (segLng * 111_320 * Math.cos((a.latitude * Math.PI) / 180)) ** 2
    );

    if (accumulated + segMeters >= targetDistanceMeters) {
      const t = (targetDistanceMeters - accumulated) / segMeters;
      const bearing =
        (Math.atan2(segLng * Math.cos((a.latitude * Math.PI) / 180), segLat) * 180) / Math.PI;
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
}

/** Compute total route distance in metres between all waypoints. */
function totalRouteMeters(waypoints: { latitude: number; longitude: number }[]): number {
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    const dLat = b.latitude - a.latitude;
    const dLng = b.longitude - a.longitude;
    total += Math.sqrt(
      (dLat * 111_320) ** 2 +
      (dLng * 111_320 * Math.cos((a.latitude * Math.PI) / 180)) ** 2
    );
  }
  return total;
}

// ─── deviceId helpers ────────────────────────────────────────────────────────

const DEVICE_ID_PREFIX = 'browser-external-';

function deviceIdFor(browserId: string): string {
  return `${DEVICE_ID_PREFIX}${browserId}`;
}

function browserIdFrom(deviceId: string): string {
  return deviceId.replace(DEVICE_ID_PREFIX, '');
}

// ─── Public connect / disconnect ─────────────────────────────────────────────

/**
 * Launch (or reconnect to) a browser with CDP, returning updated device info.
 * Called by the `browsers:connect` IPC handler.
 *
 * macOS single-instance problem: Chromium-family browsers on macOS use a
 * single-instance model. Spawning the binary when Chrome is already running
 * just signals the existing instance (which has no debug port) and the new
 * process exits immediately. The fix is `--user-data-dir` pointing to a
 * temp directory — this forces an entirely separate browser profile/process
 * that is always fresh and always accepts the debug port flag.
 *
 * Before falling back to that, though, we check whether the user already
 * has a debuggable instance running themselves (e.g. launched manually with
 * `--remote-debugging-port`) via `findExternallyLaunchedSession` — if so we
 * adopt it instead of spawning a redundant instance. We can never attach to
 * a *regular*, already-open browser window that wasn't started with that
 * flag; that's a hard OS-level limitation, not something this app can work
 * around.
 */
export async function connectExternalBrowser(browserId: string): Promise<Device> {
  const def = KNOWN_BROWSERS.find((b) => b.id === browserId);
  if (!def) {
    throw new BackendError(`Unknown browser: ${browserId}`, 'DEVICE_NOT_FOUND');
  }

  // Reuse existing session if already connected.
  const existing = sessions.get(browserId);
  if (existing) {
    try {
      await fetchCdpTargets(existing.port, 2000);
      await grantGeolocationPermission(existing.port);
      return buildDevice(def, existing.port, true);
    } catch {
      // Session stale — fall through to launch a new one.
      sessions.delete(browserId);
    }
  }

  // Adopt a browser the user already launched themselves with a debug
  // port, rather than always spawning a fresh isolated instance. No `pid`
  // is recorded for it, so `disconnectExternalBrowser` won't try to kill a
  // process we didn't start.
  const externalPort = await findExternallyLaunchedSession(browserId);
  if (externalPort !== null) {
    sessions.set(browserId, { port: externalPort, pageSockets: new Map() });
    await grantGeolocationPermission(externalPort);
    console.log(`[Browser External] Adopted externally-launched ${def.name} on port ${externalPort}`);
    return buildDevice(def, externalPort, true);
  }

  const port = pickFreePort();

  // Create a dedicated temp user-data-dir so this instance is always
  // independent of any running Chrome — avoids the macOS single-instance trap.
  let userDataDir: string;
  try {
    userDataDir = await mkdtemp(join(tmpdir(), `signl-${browserId}-`));
  } catch {
    userDataDir = join(tmpdir(), `signl-${browserId}-debug`);
  }

  console.log(`[Browser External] Launching ${def.name} on port ${port} (data dir: ${userDataDir})`);

  const child = spawn(
    def.execPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=IsolateOrigins,site-per-process',
      '--new-window',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
  const pid = child.pid;

  // Wait up to 20 s — Chrome startup can be slow on a cold launch.
  try {
    await waitForCdp(port, 20_000);
  } catch (error) {
    throw new BackendError(
      `${def.name} launched but did not expose its debug endpoint. ` +
        `Make sure no other app is using port ${port} and that Chrome isn't blocking remote debugging.`,
      'BACKEND_ERROR',
      error
    );
  }

  sessions.set(browserId, { port, pageSockets: new Map(), ...(pid !== undefined ? { pid } : {}) });
  await grantGeolocationPermission(port);
  console.log(`[Browser External] Connected to ${def.name} on port ${port}`);

  return buildDevice(def, port, true);
}

/**
 * Disconnect from a browser session.
 * Clears geolocation and optionally kills the process if we launched it.
 */
export async function disconnectExternalBrowser(browserId: string): Promise<void> {
  const session = sessions.get(browserId);
  if (!session) return;

  // Best-effort clear geolocation, then drop the persistent connections
  // that were keeping the override alive.
  await clearGeolocationOnAllPages(session).catch(() => {});
  closeAllPageSockets(session);

  // Kill only if we spawned this instance
  if (session.pid !== undefined) {
    try {
      process.kill(session.pid, 'SIGTERM');
    } catch {
      // Process already gone
    }
  }

  sessions.delete(browserId);
}

// ─── Device builder ──────────────────────────────────────────────────────────

function buildDevice(def: BrowserDef, port: number | undefined, connected: boolean): Device {
  return {
    id: deviceIdFor(def.id),
    name: def.name,
    kind: 'browser-external',
    state: connected ? 'connected' : 'offline',
    capabilities: { ...BROWSER_EXTERNAL_CAPABILITIES },
    ...(port !== undefined
      ? { metadata: { model: `CDP :${port}` } }
      : {}),
  };
}

// ─── DeviceBackend implementation ────────────────────────────────────────────

export const browserExternalBackend: DeviceBackend = {
  name: 'Browser (external)',

  getCapabilities(): DeviceCapabilities {
    return { ...BROWSER_EXTERNAL_CAPABILITIES };
  },

  async listDevices(): Promise<Device[]> {
    const installed = await findInstalledBrowsers();

    return installed.map((def) => {
      const session = sessions.get(def.id);
      return buildDevice(def, session?.port, session !== undefined);
    });
  },

  async setLocation(deviceId: string, coordinate: Coordinate): Promise<Coordinate> {
    const browserId = browserIdFrom(deviceId);
    const session = sessions.get(browserId);
    if (!session) {
      throw new BackendError(
        'Browser is not connected. Click "Connect" in the Browsers panel first.',
        'DEVICE_OFFLINE'
      );
    }

    await applyGeolocationToAllPages(session, coordinate);

    return {
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      accuracy: coordinate.accuracy ?? DEFAULT_ACCURACY,
      timestamp: Date.now(),
    };
  },

  async startRoute(
    deviceId: string,
    options: StartRouteOptions,
    onProgress: RouteProgressCallback,
    onComplete: PlaybackCompleteCallback
  ): Promise<string> {
    const browserId = browserIdFrom(deviceId);
    const session = sessions.get(browserId);
    if (!session) {
      throw new BackendError('Browser is not connected.', 'DEVICE_OFFLINE');
    }

    if (options.waypoints.length < 2) {
      throw new BackendError('Route needs at least 2 waypoints.', 'INVALID_WAYPOINTS');
    }

    const playbackId = `bext-${Date.now()}`;
    const total = totalRouteMeters(options.waypoints);
    let travelled = 0;
    const speed = options.speedMetersPerSecond;
    const distancePerTick = speed * (PLAYBACK_INTERVAL_MS / 1000);

    const tick = setInterval(async () => {
      travelled += distancePerTick;

      if (travelled >= total) {
        if (options.loop) {
          travelled = travelled % total;
        } else {
          clearInterval(tick);
          activePlaybacks.delete(playbackId);
          const last = options.waypoints[options.waypoints.length - 1]!;
          onComplete('completed');
          // Best-effort final position
          await applyGeolocationToAllPages(session, {
            latitude: last.latitude,
            longitude: last.longitude,
          }).catch(() => {});
          return;
        }
      }

      const pos = interpolatePosition(options.waypoints, travelled);
      const coord: Coordinate = {
        latitude: pos.latitude,
        longitude: pos.longitude,
        timestamp: Date.now(),
      };

      try {
        await applyGeolocationToAllPages(session, coord);
      } catch (error) {
        clearInterval(tick);
        activePlaybacks.delete(playbackId);
        onComplete('error', error instanceof Error ? error : new Error(String(error)));
        return;
      }

      onProgress(coord, pos.bearing, travelled / total);
    }, PLAYBACK_INTERVAL_MS);

    activePlaybacks.set(playbackId, tick);
    return playbackId;
  },

  async stopRoute(_deviceId: string, playbackId: string): Promise<void> {
    const timer = activePlaybacks.get(playbackId);
    if (timer) {
      clearInterval(timer);
      activePlaybacks.delete(playbackId);
    }
  },

  async reset(deviceId: string): Promise<void> {
    const browserId = browserIdFrom(deviceId);
    const session = sessions.get(browserId);
    if (!session) return;
    await clearGeolocationOnAllPages(session);
  },
};

// ─── Exported helpers for IPC handlers ──────────────────────────────────────

export { deviceIdFor, browserIdFrom, findInstalledBrowsers, KNOWN_BROWSERS };
export type { BrowserDef };
