/**
 * External browser connect/disconnect handlers — delegate to the browser
 * backend for the actual CDP work, and keep the device-kind cache and
 * error shape consistent with the other device handlers.
 */

import { connectExternalBrowser, disconnectExternalBrowser, browserIdFrom } from '../../backends/browserExternal.js';
import { setCachedDeviceKind, deleteCachedDeviceKind } from './deviceKindCache.js';
import { toIpcError } from './errors.js';
import type {
  BrowserConnectRequest,
  BrowserConnectResponse,
  BrowserDisconnectRequest,
  BrowserDisconnectResponse,
} from '@shared/types/index.js';

/**
 * browsers:connect — Launches (or reconnects to) an external browser with
 * remote debugging enabled, then returns the updated device entry.
 */
export const handleBrowserConnect = async (
  _event: Electron.IpcMainInvokeEvent,
  request: BrowserConnectRequest
): Promise<BrowserConnectResponse> => {
  console.log('[IPC] browsers:connect', request.browserId);
  try {
    const device = await connectExternalBrowser(request.browserId);
    // Update the device kind cache so location:set can resolve this device.
    setCachedDeviceKind(device.id, device.kind);
    return { success: true, device };
  } catch (error) {
    console.error('[IPC] browsers:connect error:', error);
    return { success: false, error: toIpcError(error) };
  }
};

/**
 * browsers:disconnect — Disconnects from an external browser, clears its
 * geolocation override, and kills the process if we launched it.
 */
export const handleBrowserDisconnect = async (
  _event: Electron.IpcMainInvokeEvent,
  request: BrowserDisconnectRequest
): Promise<BrowserDisconnectResponse> => {
  console.log('[IPC] browsers:disconnect', request.deviceId);
  try {
    const browserId = browserIdFrom(request.deviceId);
    await disconnectExternalBrowser(browserId);
    deleteCachedDeviceKind(request.deviceId);
    return { success: true };
  } catch (error) {
    console.error('[IPC] browsers:disconnect error:', error);
    return { success: false, error: toIpcError(error) };
  }
};
