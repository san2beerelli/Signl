/**
 * Browser Catalogue
 *
 * The list of Chromium-based browsers this backend knows how to find and
 * launch, plus the plain data <-> Device conversions shared by discovery,
 * connect, and disconnect.
 */

import { access } from 'node:fs/promises';
import type { Device, DeviceCapabilities } from '@shared/types/index.js';

export interface BrowserDef {
  /** Short stable identifier — used in device IDs and session map keys */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Absolute path to the macOS binary */
  execPath: string;
  /** Icon name used in the drawer (future) */
  iconName: string;
}

export const KNOWN_BROWSERS: BrowserDef[] = [
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

export const BROWSER_EXTERNAL_CAPABILITIES: DeviceCapabilities = {
  setLocation: true,
  resetLocation: true,
  routePlayback: true,
  pauseRoute: false,
  altitude: false,
  speed: false,
  heading: false,
  accuracy: true,
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/** Return BrowserDef entries that have an installed binary on disk. */
export const findInstalledBrowsers = async (): Promise<BrowserDef[]> => {
  const results = await Promise.all(
    KNOWN_BROWSERS.map(async (b) => ({ browser: b, installed: await fileExists(b.execPath) }))
  );
  return results.filter((r) => r.installed).map((r) => r.browser);
};

const DEVICE_ID_PREFIX = 'browser-external-';

export const deviceIdFor = (browserId: string): string => `${DEVICE_ID_PREFIX}${browserId}`;

export const browserIdFrom = (deviceId: string): string => deviceId.replace(DEVICE_ID_PREFIX, '');

/** Converts a browser definition + live session info into the app's Device shape. */
export const buildDevice = (def: BrowserDef, port: number | undefined, connected: boolean): Device => ({
  id: deviceIdFor(def.id),
  name: def.name,
  kind: 'browser-external',
  state: connected ? 'connected' : 'offline',
  capabilities: { ...BROWSER_EXTERNAL_CAPABILITIES },
  ...(port !== undefined ? { metadata: { model: `CDP :${port}` } } : {}),
});
