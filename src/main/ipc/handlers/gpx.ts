/**
 * GPX import/export handlers (currently mocked pending real GPX parsing).
 */

import type { GpxImportRequest, GpxImportResponse, GpxExportRequest, GpxExportResponse } from '@shared/types/index.js';

/**
 * gpx:import - Parses a GPX file into waypoints.
 *
 * TODO: Use gpx-builder or xml parser to extract waypoints
 */
export const handleGpxImport = async (
  _event: Electron.IpcMainInvokeEvent,
  request: GpxImportRequest
): Promise<GpxImportResponse> => {
  console.log('[IPC] gpx:import', request);

  // Mock imported waypoints
  return {
    success: true,
    waypoints: [
      { id: 'gpx-mock-0', index: 0, latitude: 37.7749, longitude: -122.4194, name: 'San Francisco' },
      { id: 'gpx-mock-1', index: 1, latitude: 37.8044, longitude: -122.2712, name: 'Oakland' },
      { id: 'gpx-mock-2', index: 2, latitude: 37.8716, longitude: -122.2727, name: 'Berkeley' },
    ],
    routeName: 'Bay Area Tour',
  };
};

/**
 * gpx:export - Serializes waypoints to a GPX file.
 *
 * TODO: Use gpx-builder to generate valid GPX XML
 */
export const handleGpxExport = async (
  _event: Electron.IpcMainInvokeEvent,
  request: GpxExportRequest
): Promise<GpxExportResponse> => {
  console.log('[IPC] gpx:export', request);

  return {
    success: true,
    filePath: request.filePath,
  };
};
