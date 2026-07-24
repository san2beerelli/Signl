/**
 * Window Registry
 *
 * Holds a reference to the main BrowserWindow so main-process modules
 * (e.g., the embedded browser backend) can reach it without importing
 * the app entry point (which would create a circular dependency).
 */

import type { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  return null;
}
