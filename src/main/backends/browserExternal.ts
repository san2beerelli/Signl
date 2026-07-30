/**
 * External Browser Backend
 *
 * Re-exports the split-out implementation — see ./browserExternal/ for the
 * catalogue, CDP transport, port management, geolocation, playback math,
 * and connect/disconnect lifecycle modules.
 */

export {
  browserExternalBackend,
  connectExternalBrowser,
  disconnectExternalBrowser,
  deviceIdFor,
  browserIdFrom,
  findInstalledBrowsers,
  KNOWN_BROWSERS,
} from './browserExternal/index.js';
export type { BrowserDef } from './browserExternal/index.js';
