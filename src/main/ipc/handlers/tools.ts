/**
 * CLI Tool Handlers
 *
 * Checks (and, for a couple of tools, installs via Homebrew) the
 * command-line dependencies the device backends rely on.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ToolCheckRequest,
  ToolCheckResponse,
  ToolInstallRequest,
  ToolInstallResponse,
} from '@shared/types/index.js';

const execAsync = promisify(exec);

/**
 * tools:check - Checks if a CLI tool is installed.
 */
export const handleToolsCheck = async (
  _event: Electron.IpcMainInvokeEvent,
  request: ToolCheckRequest
): Promise<ToolCheckResponse> => {
  console.log('[IPC] tools:check', request);

  const { toolId } = request;

  try {
    switch (toolId) {
      case 'xcode': {
        // Check for Xcode CLI tools by running xcrun simctl
        await execAsync('xcrun simctl help', { timeout: 5000 });
        // Extract version from xcode-select
        try {
          const { stdout: versionOut } = await execAsync('xcode-select --version', { timeout: 5000 });
          const versionMatch = versionOut.match(/version (\d+)/);
          return {
            installed: true,
            ...(versionMatch ? { version: `v${versionMatch[1]}` } : {}),
            detail: 'simctl available',
          };
        } catch {
          return { installed: true, detail: 'simctl available' };
        }
      }

      case 'adb': {
        // Check for Android Debug Bridge
        const { stdout } = await execAsync('adb version', { timeout: 5000 });
        const versionMatch = stdout.match(/Android Debug Bridge version ([\d.]+)/);
        return {
          installed: true,
          ...(versionMatch ? { version: `v${versionMatch[1]}` } : {}),
          detail: 'adb available',
        };
      }

      case 'libimobiledevice': {
        // Check for idevice_id command from libimobiledevice
        const { stdout } = await execAsync('idevice_id --version', { timeout: 5000 });
        const versionMatch = stdout.match(/([\d.]+)/);
        return {
          installed: true,
          ...(versionMatch ? { version: `v${versionMatch[1]}` } : {}),
          detail: 'libimobiledevice available',
        };
      }

      case 'idevicelocation': {
        // Check for idevicelocation
        await execAsync('which idevicelocation', { timeout: 5000 });
        return {
          installed: true,
          detail: 'idevicelocation available',
        };
      }

      case 'ideviceimagemounter': {
        // Check for ideviceimagemounter
        await execAsync('which ideviceimagemounter', { timeout: 5000 });
        return {
          installed: true,
          detail: 'ideviceimagemounter available',
        };
      }

      default:
        return { installed: false, detail: `Unknown tool: ${toolId}` };
    }
  } catch {
    return { installed: false };
  }
};

/**
 * tools:install - Installs a CLI tool via Homebrew.
 */
export const handleToolsInstall = async (
  _event: Electron.IpcMainInvokeEvent,
  request: ToolInstallRequest
): Promise<ToolInstallResponse> => {
  console.log('[IPC] tools:install', request);

  const { toolId } = request;

  // Map tool IDs to brew install commands (some need taps)
  const brewCommands: Record<string, { tap?: string; package: string }> = {
    libimobiledevice: { package: 'libimobiledevice' },
    ideviceimagemounter: { package: 'libimobiledevice' }, // Part of libimobiledevice
    // Note: idevicelocation must be built from source, not available via brew
  };

  const brewInfo = brewCommands[toolId];
  if (!brewInfo) {
    return {
      success: false,
      error: {
        code: 'NOT_SUPPORTED',
        message: `Tool "${toolId}" cannot be installed via this method`,
      },
    };
  }

  try {
    // Check if brew is available
    await execAsync('which brew', { timeout: 5000 });
  } catch {
    return {
      success: false,
      error: {
        code: 'BACKEND_ERROR',
        message: 'Homebrew is not installed. Please install Homebrew first: https://brew.sh',
      },
    };
  }

  try {
    // Add tap if required
    if (brewInfo.tap) {
      console.log(`[IPC] Adding tap ${brewInfo.tap}...`);
      try {
        await execAsync(`brew tap ${brewInfo.tap}`, { timeout: 60000 });
      } catch {
        // Tap might already exist, continue anyway
        console.log('[IPC] Tap may already exist, continuing...');
      }
    }

    console.log(`[IPC] Installing ${brewInfo.package} via brew...`);

    // Run brew install (this can take a while)
    const { stdout, stderr } = await execAsync(`brew install ${brewInfo.package}`, {
      timeout: 300000, // 5 minute timeout for installation
    });

    console.log('[IPC] brew install stdout:', stdout);
    if (stderr) {
      console.log('[IPC] brew install stderr:', stderr);
    }

    // Verify installation by checking the tool
    const checkResult = await handleToolsCheck(_event, { toolId });

    if (checkResult.installed) {
      return {
        success: true,
        ...(checkResult.version !== undefined ? { version: checkResult.version } : {}),
      };
    } else {
      return {
        success: false,
        error: {
          code: 'BACKEND_ERROR',
          message: 'Installation completed but tool verification failed',
        },
      };
    }
  } catch (error) {
    console.error('[IPC] tools:install error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check for common errors
    if (errorMessage.includes('already installed')) {
      // Tool is already installed, verify it
      const checkResult = await handleToolsCheck(_event, { toolId });
      if (checkResult.installed) {
        return {
          success: true,
          ...(checkResult.version !== undefined ? { version: checkResult.version } : {}),
        };
      }
    }

    return {
      success: false,
      error: {
        code: 'BACKEND_ERROR',
        message: errorMessage,
      },
    };
  }
};
