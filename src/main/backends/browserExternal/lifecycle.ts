/**
 * Browser Connect / Disconnect
 *
 * Launches (or reconnects to/adopts) a debuggable browser instance, and
 * tears one down cleanly on disconnect.
 */

import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Device } from '@shared/types/index.js';
import { BackendError } from '../types.js';
import { KNOWN_BROWSERS, buildDevice } from './catalogue.js';
import { closeAllPageSockets, fetchCdpTargets, waitForCdp } from './cdpTransport.js';
import { clearGeolocationOnAllPages, grantGeolocationPermission } from './geolocation.js';
import { findExternallyLaunchedSession, pickFreePort } from './portManagement.js';
import { sessions } from './sessionState.js';

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
export const connectExternalBrowser = async (browserId: string): Promise<Device> => {
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
};

/**
 * Disconnect from a browser session.
 * Clears geolocation and optionally kills the process if we launched it.
 */
export const disconnectExternalBrowser = async (browserId: string): Promise<void> => {
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
};
