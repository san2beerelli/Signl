/**
 * IPC Handlers
 *
 * Registers all ipcMain.handle() calls for request/response channels.
 * Each handler delegates to the appropriate backend module; the handlers
 * themselves live in ./handlers/, split by domain.
 */

import { ipcMain } from 'electron';
import { handleDevicesList } from './handlers/devices.js';
import { handleGetUserLocation, handleGetHomeLocation, handleSetHomeLocation } from './handlers/system.js';
import { handleLocationSet, handleStartRoute, handleStopRoute, handleLocationReset } from './handlers/location.js';
import { handleReverseGeocode, handleGetDirections } from './handlers/geo.js';
import { handleGpxImport, handleGpxExport } from './handlers/gpx.js';
import { handleToolsCheck, handleToolsInstall } from './handlers/tools.js';
import { handleBrowserConnect, handleBrowserDisconnect } from './handlers/browsers.js';

/**
 * Registers all IPC handlers. Call once during app initialization.
 */
export const registerIpcHandlers = (): void => {
  // Device discovery
  ipcMain.handle('devices:list', handleDevicesList);

  // User's real location (for centering the map)
  ipcMain.handle('system:getUserLocation', handleGetUserLocation);
  ipcMain.handle('system:getHomeLocation', handleGetHomeLocation);
  ipcMain.handle('system:setHomeLocation', handleSetHomeLocation);

  // Location control
  ipcMain.handle('location:set', handleLocationSet);
  ipcMain.handle('location:startRoute', handleStartRoute);
  ipcMain.handle('location:stopRoute', handleStopRoute);
  ipcMain.handle('location:reset', handleLocationReset);
  ipcMain.handle('location:reverseGeocode', handleReverseGeocode);
  ipcMain.handle('route:getDirections', handleGetDirections);

  // GPX import/export
  ipcMain.handle('gpx:import', handleGpxImport);
  ipcMain.handle('gpx:export', handleGpxExport);

  // Tool checking
  ipcMain.handle('tools:check', handleToolsCheck);

  // Tool installation
  ipcMain.handle('tools:install', handleToolsInstall);

  // Browser connect/disconnect
  ipcMain.handle('browsers:connect', handleBrowserConnect);
  ipcMain.handle('browsers:disconnect', handleBrowserDisconnect);

  console.log('[IPC] All handlers registered');
};
