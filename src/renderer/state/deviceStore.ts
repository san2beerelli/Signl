/**
 * Device Store
 *
 * Zustand store for managing connected devices and selection state.
 */

import { create } from 'zustand';
import type { Device } from '@shared/types/index.js';

interface DeviceState {
  /** All discovered devices */
  devices: Device[];
  /** Currently selected device ID */
  selectedDeviceId: string | null;
  /** Whether device discovery is in progress */
  isLoading: boolean;
  /** Last error from device operations */
  error: string | null;
}

interface DeviceActions {
  /** Set the list of devices */
  setDevices: (devices: Device[]) => void;
  /** Select a device by ID */
  selectDevice: (deviceId: string | null) => void;
  /** Set loading state */
  setLoading: (isLoading: boolean) => void;
  /** Set error state */
  setError: (error: string | null) => void;
  /** Get the currently selected device */
  getSelectedDevice: () => Device | undefined;
  /** Refresh device list from backend */
  refreshDevices: () => Promise<void>;
}

export const useDeviceStore = create<DeviceState & DeviceActions>((set, get) => ({
  devices: [],
  selectedDeviceId: null,
  isLoading: false,
  error: null,

  setDevices: (devices) => set({ devices }),

  selectDevice: (deviceId) => set({ selectedDeviceId: deviceId }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  getSelectedDevice: () => {
    const { devices, selectedDeviceId } = get();
    return devices.find((d) => d.id === selectedDeviceId);
  },

  refreshDevices: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await window.api.listDevices();
      if (response.success) {
        set({ devices: response.devices, isLoading: false });
      } else {
        set({
          error: response.error?.message ?? 'Failed to fetch devices',
          isLoading: false,
        });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        isLoading: false,
      });
    }
  },
}));
