/**
 * CDP Session State
 *
 * The live session and playback-timer registries shared across the
 * external-browser backend's connect/disconnect, geolocation, and route
 * playback logic.
 */

import type WebSocket from 'ws';

export interface CdpSession {
  port: number;
  /** PID of the browser process we launched (undefined if pre-existing) */
  pid?: number;
  /**
   * Persistent per-page-target WebSocket connections. `Emulation.*`
   * overrides (geolocation included) are scoped to the CDP client session —
   * Chrome reverts them the moment the debugger connection closes — so
   * these have to stay open for the override to actually stick, rather
   * than reconnecting for every command.
   */
  pageSockets: Map<string, WebSocket>;
}

/** browserId → active CDP session */
export const sessions = new Map<string, CdpSession>();

/** playbackId → active playback timer */
export const activePlaybacks = new Map<string, NodeJS.Timeout>();
