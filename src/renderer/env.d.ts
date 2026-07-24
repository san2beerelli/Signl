/**
 * Global Type Declarations
 *
 * Extends Window interface with our typed IPC API.
 */

import type { LocationSimulatorAPI } from '../preload/index.js';

declare global {
  interface Window {
    api: LocationSimulatorAPI;
  }
}

export {};
