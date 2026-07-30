/**
 * CDP Transport
 *
 * HTTP polling of the DevTools `/json` endpoints and the WebSocket
 * command plumbing used to talk to a browser's debug port.
 */

import http from 'node:http';
import WebSocket from 'ws';
import { BackendError } from '../types.js';
import type { CdpSession } from './sessionState.js';

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/**
 * GET http://localhost:PORT/json and return parsed target list.
 *
 * The `Host` header must be `localhost:<port>`, not just `localhost` —
 * Chrome's DevTools endpoint echoes the request's Host header back into
 * each target's `webSocketDebuggerUrl`. Omitting the port here means
 * every returned URL is missing it too (`ws://localhost/devtools/...`),
 * and a bare `ws://` URL with no port defaults to port 80 — which is not
 * where the browser is listening.
 */
export const fetchCdpTargets = (port: number, timeoutMs = 5000): Promise<CdpTarget[]> => {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/json', headers: { Host: `localhost:${port}` } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          body += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as CdpTarget[]);
          } catch (e) {
            reject(new Error(`Failed to parse /json response: ${e}`));
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('CDP /json timeout'));
    });
    req.on('error', reject);
  });
};

/**
 * GET http://localhost:PORT/json/version — returns `null` if nothing's
 * listening on the port, or it doesn't look like a CDP endpoint. Used to
 * probe for browsers the user launched with `--remote-debugging-port`
 * themselves, without waiting the full connect timeout on every dead port.
 * `webSocketDebuggerUrl` here is the *browser-level* endpoint (for
 * `Browser.*` commands like granting permissions) — distinct from each
 * page target's own `webSocketDebuggerUrl` used for `Emulation.*` commands.
 */
export const fetchCdpVersion = (
  port: number,
  timeoutMs = 800
): Promise<{ Browser?: string; webSocketDebuggerUrl?: string } | null> => {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/json/version', headers: { Host: `localhost:${port}` } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          body += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as { Browser?: string; webSocketDebuggerUrl?: string });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy());
    req.on('error', () => resolve(null));
  });
};

/** Poll `http://localhost:PORT/json` until it responds (browser is ready). */
export const waitForCdp = async (port: number, maxMs = 20_000): Promise<void> => {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetchCdpTargets(port, 1500);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new BackendError(
    `Browser did not expose its CDP endpoint on port ${port} within ${maxMs}ms.`,
    'BACKEND_ERROR'
  );
};

/**
 * Send a single CDP command over a fresh WebSocket, then close the socket.
 * Only safe for commands whose effect persists independently of the
 * debugger connection (e.g. `Browser.grantPermissions`) — NOT for
 * `Emulation.*` overrides, which are torn down the moment this socket
 * closes. Use `getOrCreatePageSocket` + `sendOnSocket` for those.
 */
export const sendOneShotCdpCommand = (
  wsUrl: string,
  method: string,
  params: Record<string, unknown>
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let done = false;

    const finish = (err?: Error): void => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* best-effort */
      }
      if (err) reject(err);
      else resolve();
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method, params }), (sendErr) => {
        if (sendErr) {
          finish(sendErr);
          return;
        }
        // Give the browser a moment to apply the command before we close.
        setTimeout(() => finish(), 150);
      });
    });

    ws.on('error', (err) => finish(err));

    // Safety timeout
    const guard = setTimeout(() => finish(new Error('CDP WebSocket timed out')), 4000);
    ws.on('close', () => clearTimeout(guard));
  });
};

let nextCdpMessageId = 1;

/** Send a CDP command over an already-open socket. Does not close it. */
export const sendOnSocket = (ws: WebSocket, method: string, params: Record<string, unknown>): Promise<void> => {
  return new Promise((resolve, reject) => {
    ws.send(JSON.stringify({ id: nextCdpMessageId++, method, params }), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

/**
 * Returns a persistent, already-open WebSocket for a page target, reusing
 * the session's cached connection when possible. `Emulation.*` overrides
 * only stick for as long as this connection stays open, so callers must
 * NOT close what this returns — it's closed centrally via
 * `closeAllPageSockets` on disconnect, or automatically dropped from the
 * cache if the page itself closes/navigates away underneath us.
 */
export const getOrCreatePageSocket = (session: CdpSession, target: CdpTarget): Promise<WebSocket> => {
  const existing = session.pageSockets.get(target.id);
  if (existing && existing.readyState === WebSocket.OPEN) {
    return Promise.resolve(existing);
  }
  if (existing) {
    session.pageSockets.delete(target.id);
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl!);

    const guard = setTimeout(() => {
      ws.terminate();
      reject(new Error('CDP WebSocket connect timed out'));
    }, 4000);

    ws.once('open', () => {
      clearTimeout(guard);
      session.pageSockets.set(target.id, ws);
      resolve(ws);
    });

    ws.once('error', (err) => {
      clearTimeout(guard);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    // The page closed or navigated to a different target — Chrome closes
    // this socket on its own. Drop it from the cache so the next call
    // reconnects instead of reusing a dead connection.
    ws.on('close', () => {
      if (session.pageSockets.get(target.id) === ws) {
        session.pageSockets.delete(target.id);
      }
    });
  });
};

/** Closes and forgets every persistent per-page socket for a session. */
export const closeAllPageSockets = (session: CdpSession): void => {
  for (const ws of session.pageSockets.values()) {
    try {
      ws.close();
    } catch {
      /* best-effort */
    }
  }
  session.pageSockets.clear();
};
