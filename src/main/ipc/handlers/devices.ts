/**
 * devices:list handler — returns all discoverable devices across backends.
 */

import { discoverAllDevices } from '../../devices/discovery.js';
import { rebuildDeviceKindCache } from './deviceKindCache.js';
import type { DevicesListResponse } from '@shared/types/index.js';

export const handleDevicesList = async (): Promise<DevicesListResponse> => {
  try {
    const devices = await discoverAllDevices();
    rebuildDeviceKindCache(devices);

    return {
      success: true,
      devices,
    };
  } catch (error) {
    console.error('[IPC] devices:list error:', error);
    return {
      success: false,
      devices: [],
      error: {
        code: 'BACKEND_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
};
