/**
 * HTTP JSON Client
 *
 * Uses Node's https module (not native fetch) so rejectUnauthorized can be
 * disabled, which handles corporate SSL-inspection proxies that present a
 * self-signed CA cert.
 */

import https from 'node:https';

export const httpsGetJson = (
  url: string | URL,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<Record<string, unknown>> => {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false, headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as Record<string, unknown>);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Timeout'));
    });
    req.on('error', reject);
  });
};
