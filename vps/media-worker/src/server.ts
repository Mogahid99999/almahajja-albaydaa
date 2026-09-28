// Internal HTTP surface (almahajja_net; /recordings gets a tunnel hostname in P6):
//   GET  /health                → Docker HEALTHCHECK
//   POST /lk                    → LiveKit webhooks (raw body needed for the signature hash)
//   GET  /recordings/:sessionId → staff download of a live raw (recordingDownload.ts)

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { WebhookResult } from './webhooks.js';

export const MAX_BODY_BYTES = 1024 * 1024;

export interface HealthBody {
  ok: boolean;
  env: string;
  busy: boolean;
  egressActive: boolean;
}

export interface ServerDeps {
  health: () => HealthBody;
  onWebhook: (rawBody: string, authHeader: string | undefined) => Promise<WebhookResult>;
  onRecording?: (req: IncomingMessage, res: ServerResponse, sessionId: string) => Promise<void>;
}

class BodyTooLarge extends Error {}

function readRaw(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

const RECORDING_ROUTE = /^\/recordings\/([^/]+)$/;

export function createHttpServer(deps: ServerDeps): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    if (path === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false });
      const h = deps.health();
      return send(res, h.ok ? 200 : 503, h);
    }

    if (path === '/lk') {
      if (req.method !== 'POST') return send(res, 405, { ok: false });
      const header = req.headers['authorization'] ?? req.headers['authorize'];
      const auth = Array.isArray(header) ? header[0] : header;
      readRaw(req, MAX_BODY_BYTES)
        .then((raw) => deps.onWebhook(raw, auth))
        .then((r) => send(res, r.status, r.body))
        .catch((err: unknown) => {
          if (res.headersSent) return;
          send(res, err instanceof BodyTooLarge ? 413 : 500, { ok: false });
        });
      return;
    }

    const rec = RECORDING_ROUTE.exec(path);
    if (rec && deps.onRecording) {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(rec[1] ?? '');
      } catch {
        return send(res, 404, { ok: false });
      }
      deps.onRecording(req, res, sessionId).catch(() => {
        if (!res.headersSent) send(res, 500, { ok: false });
        else res.destroy();
      });
      return;
    }

    send(res, 404, { ok: false });
  });
}
