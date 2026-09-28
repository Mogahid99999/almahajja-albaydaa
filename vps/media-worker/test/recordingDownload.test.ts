import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentDisposition, handleRecordingDownload, parseRange } from '../src/recordingDownload.js';
import { RecordingsDir } from '../src/recordings.js';
import { createHttpServer } from '../src/server.js';
import { FakeDb, FakeStorage } from './fakes.js';

const SESSION = '0b6f2c1e-8d7a-4c3b-9e21-5f4a3b2c1d0e';
const OTHER = '1c7e3d2f-9e8b-4d4c-8f32-6e5b4c3d2e1f';
const BYTES = Buffer.from('OggS0123456789abcdefghijklmnopqrstuvwxyz'); // 40 bytes

let root: string;
let stg: string;
let db: FakeDb;
let storage: FakeStorage;
let server: Server;
let base: string;

const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  fetch(`${base}${path}`, { method, headers });
const admin = { Authorization: 'Bearer admin-jwt' };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mw-dl-'));
  stg = join(root, 'recordings', 'stg');
  await mkdir(stg, { recursive: true });
  await mkdir(join(root, 'recordings', 'prd'), { recursive: true });
  await writeFile(join(stg, 'stg_abc-2026-09-28T190000.ogg'), BYTES);

  db = new FakeDb();
  db.tokens.set('admin-jwt', { userId: 'u-admin', role: 'admin' });
  db.tokens.set('publisher-jwt', { userId: 'u-pub', role: 'publisher' });
  db.tokens.set('sheikh-jwt', { userId: 'u-sh', role: 'sheikh' });
  db.tokens.set('student-jwt', { userId: 'u-st', role: 'student' });
  db.tokens.set('norole-jwt', { userId: 'u-x', role: null });
  db.sessionRaws.set(SESSION, {
    rawPath: join(stg, 'stg_abc-2026-09-28T190000.ogg'),
    rawBackupKey: 'live-raw/stg_abc-2026-09-28T190000.ogg',
  });

  const recordings = new RecordingsDir(stg);
  storage = new FakeStorage();
  server = createHttpServer({
    health: () => ({ ok: true, env: 'stg', busy: false, egressActive: false }),
    onWebhook: async () => ({ status: 200, body: {} }),
    onRecording: (req, res, id) => handleRecordingDownload(req, res, id, { db, recordings, storage }),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(root, { recursive: true, force: true });
});

describe('GET /recordings/:sessionId — auth', () => {
  it('401 without a bearer token, or with an invalid one', async () => {
    expect((await get(`/recordings/${SESSION}`)).status).toBe(401);
    expect((await get(`/recordings/${SESSION}`, { Authorization: 'Basic abc' })).status).toBe(401);
    expect((await get(`/recordings/${SESSION}`, { Authorization: 'Bearer forged' })).status).toBe(401);
  });

  it('403 for roles other than admin / publisher (sheikh, student, no profile)', async () => {
    for (const t of ['sheikh-jwt', 'student-jwt', 'norole-jwt']) {
      expect((await get(`/recordings/${SESSION}`, { Authorization: `Bearer ${t}` })).status).toBe(403);
    }
  });

  it('auth runs before any lookup: an outsider cannot probe which sessions exist', async () => {
    expect((await get(`/recordings/${OTHER}`)).status).toBe(401);
    expect((await get(`/recordings/${OTHER}`, { Authorization: 'Bearer student-jwt' })).status).toBe(403);
  });

  it('503 when the auth lookup itself fails', async () => {
    db.staffError = new Error('auth down');
    expect((await get(`/recordings/${SESSION}`, admin)).status).toBe(503);
  });
});

describe('GET /recordings/:sessionId — streaming', () => {
  it('admin gets the whole file as an attachment with the right length', async () => {
    const res = await get(`/recordings/${SESSION}`, admin);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/ogg');
    expect(res.headers.get('content-length')).toBe(String(BYTES.length));
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="stg_abc-2026-09-28T190000.ogg"');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
  });

  it('publisher is allowed too', async () => {
    expect((await get(`/recordings/${SESSION}`, { Authorization: 'Bearer publisher-jwt' })).status).toBe(200);
  });

  it('Range: bytes=a-b → 206 with Content-Range; suffix and open ranges work', async () => {
    const r1 = await get(`/recordings/${SESSION}`, { ...admin, Range: 'bytes=4-13' });
    expect(r1.status).toBe(206);
    expect(r1.headers.get('content-range')).toBe(`bytes 4-13/${BYTES.length}`);
    expect(r1.headers.get('content-length')).toBe('10');
    expect(Buffer.from(await r1.arrayBuffer())).toEqual(BYTES.subarray(4, 14));

    const r2 = await get(`/recordings/${SESSION}`, { ...admin, Range: 'bytes=-5' });
    expect(Buffer.from(await r2.arrayBuffer())).toEqual(BYTES.subarray(BYTES.length - 5));

    const r3 = await get(`/recordings/${SESSION}`, { ...admin, Range: 'bytes=35-' });
    expect(Buffer.from(await r3.arrayBuffer())).toEqual(BYTES.subarray(35));
  });

  it('unsatisfiable range → 416 with bytes */size', async () => {
    const res = await get(`/recordings/${SESSION}`, { ...admin, Range: 'bytes=999-' });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${BYTES.length}`);
  });

  it('HEAD returns headers only', async () => {
    const res = await get(`/recordings/${SESSION}`, admin, 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(BYTES.length));
  });

  it('OPTIONS preflight is answered for the admin web (Authorization + Range allowed)', async () => {
    const res = await get(`/recordings/${SESSION}`, {}, 'OPTIONS');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });
});

describe('GET /recordings/:sessionId — 404s never expose paths', () => {
  it('unknown session, deleted raw, file gone, non-uuid id', async () => {
    expect((await get(`/recordings/${OTHER}`, admin)).status).toBe(404);
    expect((await get('/recordings/not-a-uuid', admin)).status).toBe(404);
    db.sessionRaws.set(OTHER, { rawPath: join(stg, 'gone.ogg'), rawBackupKey: null });
    const res = await get(`/recordings/${OTHER}`, admin);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('gone.ogg');
  });

  it('a raw_path pointing outside RECORDINGS_DIR (other env / ".." / legacy R2 key) → 404', async () => {
    const prd = join(root, 'recordings', 'prd', 'prd_x.ogg');
    await writeFile(prd, 'secret');
    for (const p of [prd, `${stg}/../prd/prd_x.ogg`, 'live-raw/prd_x.ogg']) {
      db.sessionRaws.set(OTHER, { rawPath: p, rawBackupKey: null });
      const res = await get(`/recordings/${OTHER}`, admin);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('prd_x');
    }
  });

  it('a symlink escaping RECORDINGS_DIR → 404', async (ctx) => {
    const prdDir = join(root, 'recordings', 'prd');
    await writeFile(join(prdDir, 'p.ogg'), 'secret');
    try {
      await symlink(prdDir, join(stg, 'escape'), 'junction');
    } catch {
      ctx.skip();
    }
    db.sessionRaws.set(OTHER, { rawPath: join(stg, 'escape', 'p.ogg'), rawBackupKey: null });
    expect((await get(`/recordings/${OTHER}`, admin)).status).toBe(404);
  });

  it('path traversal in the URL never reaches the filesystem', async () => {
    expect((await get('/recordings/..%2F..%2Fetc%2Fpasswd', admin)).status).toBe(404);
  });
});

describe('GET /recordings/:sessionId — local raw deleted → R2 backup', () => {
  const noFollow = (path: string, headers: Record<string, string>) =>
    fetch(`${base}${path}`, { headers, redirect: 'manual' });

  it('302 to a 10-minute presigned GET of the backup, as an attachment', async () => {
    db.sessionRaws.set(OTHER, { rawPath: null, rawBackupKey: 'live-raw/stg_abc-2026-09-21T190000.ogg' });
    const res = await noFollow(`/recordings/${OTHER}`, admin);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('https://r2.test/');
    expect(storage.presigned).toEqual([
      {
        key: 'live-raw/stg_abc-2026-09-21T190000.ogg',
        expiresInSec: 600,
        contentDisposition: contentDisposition('stg_abc-2026-09-21T190000.ogg'),
        contentType: 'audio/ogg',
      },
    ]);
  });

  it('also when raw_path is still set but the file is gone from disk', async () => {
    db.sessionRaws.set(OTHER, { rawPath: join(stg, 'gone.ogg'), rawBackupKey: 'live-raw/gone.ogg' });
    expect((await noFollow(`/recordings/${OTHER}`, admin)).status).toBe(302);
  });

  it('prefers the local file while it exists (no presign)', async () => {
    expect((await noFollow(`/recordings/${SESSION}`, admin)).status).toBe(200);
    expect(storage.presigned).toEqual([]);
  });

  it('never presigns a key outside live-raw/ → 404', async () => {
    for (const k of ['lectures/x/y.mp3', 'live-raw/../lectures/x.mp3', 'incoming/a.m4a']) {
      db.sessionRaws.set(OTHER, { rawPath: null, rawBackupKey: k });
      expect((await noFollow(`/recordings/${OTHER}`, admin)).status).toBe(404);
    }
    expect(storage.presigned).toEqual([]);
  });

  it('auth still comes first (401/403 before any presign), and a presign error → 503', async () => {
    db.sessionRaws.set(OTHER, { rawPath: null, rawBackupKey: 'live-raw/x.ogg' });
    expect((await noFollow(`/recordings/${OTHER}`, {})).status).toBe(401);
    expect((await noFollow(`/recordings/${OTHER}`, { Authorization: 'Bearer student-jwt' })).status).toBe(403);
    expect(storage.presigned).toEqual([]);
    storage.presignError = new Error('clock skew');
    expect((await noFollow(`/recordings/${OTHER}`, admin)).status).toBe(503);
  });
});

describe('helpers', () => {
  it('parseRange', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=0-4', 10)).toEqual({ start: 0, end: 4 });
    expect(parseRange('bytes=5-99', 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull(); // multi-range → whole file
    expect(parseRange('bytes=10-', 10)).toBe('invalid');
    expect(parseRange('bytes=5-2', 10)).toBe('invalid');
    expect(parseRange('bytes=-', 10)).toBe('invalid');
  });

  it('contentDisposition: ASCII fallback + UTF-8 filename*', () => {
    expect(contentDisposition('مجلس.ogg')).toBe(
      `attachment; filename="____.ogg"; filename*=UTF-8''${encodeURIComponent('مجلس.ogg')}`,
    );
  });
});
