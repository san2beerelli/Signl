/**
 * Main Process Entry Point
 *
 * Bootstraps the Electron app, creates the main window,
 * and sets up IPC handlers.
 */

import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'path';
import { registerIpcHandlers } from './ipc/handlers.js';
import { setMainWindow } from './windows.js';

// Must run before the app is ready (and before any Menu is built) — this is
// what makes the macOS menu bar and "About/Hide/Quit" items say "Signl"
// instead of the packaged productName only applying to a built app. Note:
// in unpackaged dev mode, macOS's bold top-level menu-bar label is still
// read from the actual running Electron.app bundle's Info.plist and stays
// "Electron" regardless — that's an OS-level constraint this call can't
// override; only a real packaged build (`npm run package:mac`) shows
// "Signl" there too.
app.setName('Signl');

// Disable hardware acceleration if needed for Linux/VM compatibility
// app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;

const createWindow = (): void => {
  const appIconPath = app.isPackaged
    ? join(process.resourcesPath, 'build/icon.png')
    : join(__dirname, '../../build/icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon: appIconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Make the window reachable by the embedded browser backend (CDP target)
  setMainWindow(mainWindow);
  mainWindow.on('closed', () => {
    setMainWindow(null);
    mainWindow = null;
  });

  // Show window when ready to avoid visual flash
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Load the renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    // Dev mode: load from Vite dev server
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    // Production: load from built files
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
};

// App lifecycle
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = app.isPackaged
      ? join(process.resourcesPath, 'build/icon.png')
      : join(__dirname, '../../build/icon.png');
    app.dock.setIcon(dockIconPath);
  }

  // Register all IPC handlers before creating window
  registerIpcHandlers();

  // Allow geolocation requests from our own window so the embedded
  // browser target (CDP geolocation override) can be exercised.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'geolocation');
  });

  createWindow();

  // macOS: re-create window when dock icon clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: prevent navigation to unknown URLs
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event) => {
    event.preventDefault();
  });
});
