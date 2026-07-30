/**
 * IPC Error Mapping
 *
 * Maps backend exceptions to structured IPC errors with readable messages.
 * Raw details stay in main-process logs, not in the renderer payload.
 */

import { NotSupportedError, BackendError } from '../../backends/types.js';
import type { IpcError, IpcErrorCode } from '@shared/types/index.js';

const KNOWN_ERROR_CODES: IpcErrorCode[] = [
  'NOT_SUPPORTED',
  'VALIDATION_ERROR',
  'NOT_BOOTED',
  'DEVICE_NOT_FOUND',
  'DEVICE_BUSY',
  'DEVICE_OFFLINE',
  'PLAYBACK_ACTIVE',
  'NO_PLAYBACK_ACTIVE',
  'INVALID_WAYPOINTS',
  'FILE_NOT_FOUND',
  'PARSE_ERROR',
  'WRITE_ERROR',
  'BACKEND_ERROR',
  'UNKNOWN',
];

export const toIpcError = (error: unknown): IpcError => {
  if (error instanceof NotSupportedError) {
    return { code: 'NOT_SUPPORTED', message: error.message };
  }
  if (error instanceof BackendError) {
    const code = KNOWN_ERROR_CODES.includes(error.code as IpcErrorCode)
      ? (error.code as IpcErrorCode)
      : 'BACKEND_ERROR';
    return { code, message: error.message };
  }
  return {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Unknown error',
  };
};
