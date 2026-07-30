/**
 * Preload Script
 *
 * Exposes a typed IPC API to the renderer process via contextBridge.
 * This is the only bridge between main and renderer processes.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  IpcInvokeChannel,
  IpcPushChannel,
  InvokePayload,
  InvokeResponse,
  PushPayload,
} from '@shared/types/index.js';

/**
 * Type-safe invoke wrapper.
 */
const invoke = async <C extends IpcInvokeChannel>(
  channel: C,
  ...args: InvokePayload<C> extends void ? [] : [InvokePayload<C>]
): Promise<InvokeResponse<C>> => {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResponse<C>>;
};

/**
 * Type-safe event subscription.
 */
const on = <C extends IpcPushChannel>(
  channel: C,
  callback: (payload: PushPayload<C>) => void
): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: PushPayload<C>): void => {
    callback(payload);
  };
  ipcRenderer.on(channel, handler);

  // Return unsubscribe function
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

/**
 * API exposed to renderer via window.api
 */
const api = {
  // Device discovery
  listDevices: () => invoke('devices:list'),

  // User's real (approximate) location for centering the map
  getUserLocation: () => invoke('system:getUserLocation'),

  // Persisted home location (user-dragged dot) — used instead of IP geolocation
  getHomeLocation: () => invoke('system:getHomeLocation'),
  setHomeLocation: (request: InvokePayload<'system:setHomeLocation'>) =>
    invoke('system:setHomeLocation', request),

  // Location control
  setLocation: (request: InvokePayload<'location:set'>) =>
    invoke('location:set', request),
  startRoute: (request: InvokePayload<'location:startRoute'>) =>
    invoke('location:startRoute', request),
  stopRoute: (request: InvokePayload<'location:stopRoute'>) =>
    invoke('location:stopRoute', request),
  resetLocation: (request: InvokePayload<'location:reset'>) =>
    invoke('location:reset', request),
  reverseGeocode: (request: InvokePayload<'location:reverseGeocode'>) =>
    invoke('location:reverseGeocode', request),
  getDirections: (request: InvokePayload<'route:getDirections'>) =>
    invoke('route:getDirections', request),

  // GPX import/export
  importGpx: (request: InvokePayload<'gpx:import'>) =>
    invoke('gpx:import', request),
  exportGpx: (request: InvokePayload<'gpx:export'>) =>
    invoke('gpx:export', request),

  // Tool checking
  checkTool: (toolId: string) =>
    invoke('tools:check', { toolId }) as Promise<{ installed: boolean; version?: string; detail?: string }>,

  // Tool installation
  installTool: (toolId: string) =>
    invoke('tools:install', { toolId }) as Promise<{ success: boolean; version?: string; error?: { code: string; message: string } }>,

  // Push event subscriptions
  onLocationProgress: (callback: (payload: PushPayload<'location:progress'>) => void) =>
    on('location:progress', callback),
  onPlaybackComplete: (callback: (payload: PushPayload<'location:playbackComplete'>) => void) =>
    on('location:playbackComplete', callback),
  onDevicesChanged: (callback: (payload: PushPayload<'devices:changed'>) => void) =>
    on('devices:changed', callback),

  // External browser connect/disconnect
  connectBrowser: (request: InvokePayload<'browsers:connect'>) =>
    invoke('browsers:connect', request),
  disconnectBrowser: (request: InvokePayload<'browsers:disconnect'>) =>
    invoke('browsers:disconnect', request),
};

// Expose API to renderer
contextBridge.exposeInMainWorld('api', api);

// Export type for use in renderer
export type LocationSimulatorAPI = typeof api;
