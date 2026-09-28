// Staff download of a live session's LOCAL raw recording (P2; tunnel hostname
// comes in P6):  GET /recordings/:sessionId   Authorization: Bearer <user JWT>
//
//  1. JWT verified with auth.getUser → profiles.role must be admin | publisher
//     (401 without / with a bad token, 403 for any other role). Auth happens
//     BEFORE any lookup, so existence never leaks to outsiders.
//  2. live_sessions.raw_path (service role) holds the local path; it must
//     resolve to a regular file inside RECORDINGS_DIR (symlink / `..` escapes
//     refused) — otherwise 404, and the path is never echoed.
//  3. Streamed with Content-Disposition: attachment, Content-Length, and a
//     single `Range: bytes=a-b` (206 / 416).
//  4. Local raw already deleted (it goes as soon as the R2 backup is confirmed)
//     but live_sessions.raw_backup_key is set → 302 to a 10-minute presigned R2
//     GET of the backup with response-content-disposition=attachment. Only keys
//     under live-raw/ are ever presigned.

import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JobDb } from './db.js';
import { errorMessage, type Logger, silentLogger } from './log.js';
import type { RecordingsDir } from './recordings.js';
import type { Storage } from './storage.js';

export const DOWNLOAD_ROLES = new Set(['admin', 'publisher']);
export const BACKUP_URL_TTL_SEC = 10 * 60;
const BACKUP_KEY_RE = /^live-raw\/[^/]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DownloadDeps {
  db: Pick<JobDb, 'staffForToken' | 'liveSessionRaw'>;
  recordings: Pick<RecordingsDir, 'resolve'>;
  storage: Pick<Storage, 'presignGet'>;
  log?: Logger;
}

type ByteRange = { start: number; end: number };

/** Single-range parser. null = no/ignored Range header; 'invalid' = 416. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range / other units: serve the whole file
  const [, a, b] = m;
  if (a === '' && b === '') return 'invalid';
  let start: number;
  let end: number;
  if (a === '') {
    // suffix range: last N bytes
    const n = Number(b);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

/** RFC 6266: ASCII fallback + UTF-8 filename*. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(s),
    'Cache-Control': 'no-store',
    ...CORS,
  });
  res.end(s);
}

/** The admin web calls this with fetch + Authorization (no cookies) → `*` is safe. */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges',
  'Access-Control-Max-Age': '600',
} as const;

export async function handleRecordingDownload(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  deps: DownloadDeps,
): Promise<void> {
  const log = deps.log ?? silentLogger;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false });

  // 1. auth
  const header = req.headers['authorization'];
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m?.[1]) return json(res, 401, { ok: false, error: 'unauthorized' });
  let staff;
  try {
    staff = await deps.db.staffForToken(m[1]);
  } catch (err) {
    log('error', 'recording.auth_error', { error: errorMessage(err, 200) });
    return json(res, 503, { ok: false, error: 'unavailable' });
  }
  if (!staff) return json(res, 401, { ok: false, error: 'unauthorized' });
  if (!staff.role || !DOWNLOAD_ROLES.has(staff.role)) return json(res, 403, { ok: false, error: 'forbidden' });

  // 2. resolve (never leaks paths)
  if (!UUID_RE.test(sessionId)) return json(res, 404, { ok: false, error: 'not found' });
  let row;
  try {
    row = await deps.db.liveSessionRaw(sessionId);
  } catch (err) {
    log('error', 'recording.lookup_error', { session: sessionId, error: errorMessage(err, 200) });
    return json(res, 503, { ok: false, error: 'unavailable' });
  }
  const file = row?.rawPath ? await deps.recordings.resolve(row.rawPath) : null;
  if (!file) {
    // Local raw gone → the R2 backup (kept forever), via a short-lived presigned URL.
    const backup = row?.rawBackupKey ?? null;
    if (backup && BACKUP_KEY_RE.test(backup)) {
      let url: string;
      try {
        url = await deps.storage.presignGet(backup, {
          expiresInSec: BACKUP_URL_TTL_SEC,
          contentDisposition: contentDisposition(backup.slice(backup.lastIndexOf('/') + 1)),
          contentType: 'audio/ogg',
        });
      } catch (err) {
        log('error', 'recording.presign_error', { session: sessionId, error: errorMessage(err, 200) });
        return json(res, 503, { ok: false, error: 'unavailable' });
      }
      log('info', 'recording.download_backup', { session: sessionId, user: staff.userId });
      res.writeHead(302, { Location: url, 'Cache-Control': 'no-store', ...CORS });
      res.end();
      return;
    }
    log('warn', 'recording.not_found', { session: sessionId, user: staff.userId });
    return json(res, 404, { ok: false, error: 'not found' });
  }

  // 3. stream
  const range = parseRange(req.headers['range'], file.size);
  const common = {
    'Content-Type': 'audio/ogg',
    'Content-Disposition': contentDisposition(file.name),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...CORS,
  };
  if (range === 'invalid') {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${file.size}`, 'Content-Length': 0 });
    res.end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: file.size - 1 };
  const length = file.size === 0 ? 0 : end - start + 1;
  res.writeHead(range ? 206 : 200, {
    ...common,
    'Content-Length': length,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.size}` } : {}),
  });
  log('info', 'recording.download', { session: sessionId, user: staff.userId, bytes: length, partial: !!range });
  if (req.method === 'HEAD' || length === 0) {
    res.end();
    return;
  }
  const stream = createReadStream(file.path, { start, end });
  stream.on('error', (err) => {
    log('error', 'recording.stream_error', { session: sessionId, error: errorMessage(err, 200) });
    res.destroy(err);
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
