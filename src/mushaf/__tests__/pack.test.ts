/**
 * Madinah pack download: resume, interruption, retry, integrity, versioning.
 *
 * expo-file-system is replaced by an in-memory disk that SURVIVES
 * jest.resetModules(), so "kill the app and reopen it" = re-import pack.ts
 * against the same disk. The pack server (static files over HTTPS) is faked.
 */
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';

// ---------- in-memory disk ----------
type Disk = { files: Map<string, Uint8Array>; dirs: Set<string>; free: number };
const mockDisk: Disk = { files: new Map(), dirs: new Set(), free: 1e12 };
// ---------- fake server ----------
type Server = {
  manifest: any;
  blobs: Map<string, Uint8Array>;
  /** paths that fail (network error) — consumed per attempt when a number. */
  fail: Map<string, number>;
  /** paths served with corrupted bytes — consumed per attempt. */
  corrupt: Map<string, number>;
  downloads: string[];
};
const mockServer: Server = { manifest: null, blobs: new Map(), fail: new Map(), corrupt: new Map(), downloads: [] };
const mockBase = 'https://pack.test/mushaf';
const mockEnv = { mushafPackUrl: mockBase as string | null };

jest.mock('expo-file-system', () => {
  const uriOf = (parts: any[]) =>
    parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/').replace(/\/+/g, '/').replace('file:/', 'file:///');
  const baseName = (u: string) => u.split('/').filter(Boolean).pop()!;
  const parentOf = (u: string) => u.slice(0, u.lastIndexOf('/'));
  class File {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = uriOf(parts);
    }
    get name() {
      return baseName(this.uri);
    }
    get exists() {
      return mockDisk.files.has(this.uri);
    }
    get size() {
      return mockDisk.files.get(this.uri)?.length ?? 0;
    }
    create() {
      if (!mockDisk.dirs.has(parentOf(this.uri))) throw new Error('no parent ' + this.uri);
      mockDisk.files.set(this.uri, new Uint8Array());
    }
    write(c: string | Uint8Array) {
      mockDisk.files.set(this.uri, typeof c === 'string' ? new TextEncoder().encode(c) : new Uint8Array(c));
    }
    async text() {
      const b = mockDisk.files.get(this.uri);
      if (!b) throw new Error('missing ' + this.uri);
      return new TextDecoder().decode(b);
    }
    async bytes() {
      const b = mockDisk.files.get(this.uri);
      if (!b) throw new Error('missing ' + this.uri);
      return b;
    }
    delete() {
      if (!mockDisk.files.delete(this.uri)) throw new Error('delete missing ' + this.uri);
    }
    rename(n: string) {
      const to = parentOf(this.uri) + '/' + n;
      mockDisk.files.set(to, mockDisk.files.get(this.uri)!);
      mockDisk.files.delete(this.uri);
      this.uri = to;
    }
    info(o?: { md5?: boolean }) {
      const b = mockDisk.files.get(this.uri);
      return { exists: !!b, size: b?.length, md5: o?.md5 && b ? require('crypto').createHash('md5').update(b).digest('hex') : undefined };
    }
    static async downloadFileAsync(url: string, dest: File) {
      const path = url.replace(mockBase + '/', '');
      mockServer.downloads.push(path);
      const f = mockServer.fail.get(path);
      if (f) {
        mockServer.fail.set(path, f - 1);
        throw new Error('network');
      }
      let b = mockServer.blobs.get(path)!;
      const c = mockServer.corrupt.get(path);
      if (c) {
        mockServer.corrupt.set(path, c - 1);
        b = new Uint8Array(b);
        b[b.length - 9] ^= 0xff; // flip a byte inside the gzip payload trailer
      }
      mockDisk.files.set(dest.uri, b);
      return dest;
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = uriOf(parts);
    }
    get name() {
      return baseName(this.uri);
    }
    get exists() {
      return mockDisk.dirs.has(this.uri);
    }
    create() {
      mockDisk.dirs.add(this.uri);
    }
    delete() {
      for (const k of [...mockDisk.files.keys()]) if (k.startsWith(this.uri + '/')) mockDisk.files.delete(k);
      for (const d of [...mockDisk.dirs]) if (d === this.uri || d.startsWith(this.uri + '/')) mockDisk.dirs.delete(d);
    }
    rename(n: string) {
      const to = parentOf(this.uri) + '/' + n;
      for (const [k, v] of [...mockDisk.files]) if (k.startsWith(this.uri + '/')) {
        mockDisk.files.delete(k);
        mockDisk.files.set(to + k.slice(this.uri.length), v);
      }
      mockDisk.dirs.delete(this.uri);
      mockDisk.dirs.add(to);
      this.uri = to;
    }
    list() {
      const kids = new Set<string>();
      for (const d of mockDisk.dirs) if (parentOf(d) === this.uri) kids.add('d:' + d);
      for (const f of mockDisk.files.keys()) if (parentOf(f) === this.uri) kids.add('f:' + f);
      return [...kids].map((k) => (k[0] === 'd' ? new Directory(k.slice(2)) : new File(k.slice(2))));
    }
  }
  const document = new Directory('file:///doc');
  return {
    File,
    Directory,
    Paths: {
      document,
      get availableDiskSpace() {
        return mockDisk.free;
      },
    },
  };
});

// One network state shared by every simulated app launch.
const mockOnline = { on: true };
jest.mock('@tanstack/react-query', () => ({
  onlineManager: {
    isOnline: () => mockOnline.on,
    setOnline: (v: boolean) => {
      mockOnline.on = v;
    },
  },
}));

jest.mock('@/lib/env', () => ({ env: mockEnv }));

// current.json → <version>/manifest.json, as the server publishes them.
const fetchMock = jest.fn(async (url: string) => {
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  if (url === `${mockBase}/current.json`) return json({ version: mockServer.manifest.version });
  if (url === `${mockBase}/${mockServer.manifest?.version}/manifest.json`) return json(mockServer.manifest);
  return { ok: false, status: 404, json: async () => ({}) };
});
(global as any).fetch = fetchMock;

const md5 = (b: Uint8Array) => createHash('md5').update(b).digest('hex');

function publish(version: string, names = ['glyphs.json', 'p001.ttf', 'p002.ttf', 'p003.ttf', 'p004.ttf', 'p005.ttf']) {
  const files = names.map((name, i) => {
    const raw = new TextEncoder().encode(
      name === 'glyphs.json'
        ? JSON.stringify({ v: 1, fx: { width: 340, font: 21, gap: 2 }, shrink: {}, pages: [[version]] })
        : `${version}:${name}:`.repeat(40 + i),
    );
    const gz = new Uint8Array(gzipSync(raw));
    mockServer.blobs.set(`${version}/${name}.gz`, gz);
    return { name, path: name + '.gz', size: gz.length, raw: raw.length, md5: md5(raw) };
  });
  mockServer.manifest = {
    version,
    totalSize: files.reduce((a, f) => a + f.size, 0),
    totalRaw: files.reduce((a, f) => a + f.raw, 0),
    files,
  };
  return mockServer.manifest;
}

/** A fresh app process over the same disk. */
function launch(): typeof import('../pack') {
  let mod: typeof import('../pack');
  jest.isolateModules(() => {
    mod = require('../pack');
  });
  return mod!;
}

const ROOT = 'file:///doc/mushaf-pack';

beforeEach(() => {
  mockDisk.files.clear();
  mockDisk.dirs.clear();
  mockDisk.dirs.add('file:///doc');
  mockDisk.free = 1e12;
  mockEnv.mushafPackUrl = mockBase;
  mockServer.blobs.clear();
  mockServer.fail.clear();
  mockServer.corrupt.clear();
  mockServer.downloads = [];
  const { onlineManager } = require('@tanstack/react-query');
  onlineManager.setOnline(true);
});

describe('Madinah pack download', () => {
  it('downloads, verifies and switches atomically; then works with no network', async () => {
    const m = publish('v1');
    const app = launch();
    await app.initPack();
    expect(app.usePackStore.getState().status).toEqual({ state: 'idle', total: null });
    await app.startPackDownload();
    expect(app.usePackStore.getState().status).toEqual({ state: 'ready', version: 'v1' });
    expect(app.usePackStore.getState().justCompleted).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(mockDisk.files.get(`${ROOT}/active.json`)!))).toEqual({ version: 'v1' });
    for (const f of m.files) expect(mockDisk.files.has(`${ROOT}/v1/${f.name}`)).toBe(true);
    expect([...mockDisk.dirs].some((d) => d.includes('staging-'))).toBe(false);

    // Reopen offline: ready from disk, nothing fetched.
    require('@tanstack/react-query').onlineManager.setOnline(false);
    mockServer.downloads = [];
    const again = launch();
    await again.initPack();
    expect(again.usePackStore.getState().status.state).toBe('ready');
    expect(again.activePackUri()).toBe(`${ROOT}/v1`);
    expect((await again.loadGlyphIndex()).pages[0][0]).toBe('v1');
    expect(mockServer.downloads).toEqual([]);
  });

  it('an interrupted download survives an app kill and resumes without refetching finished files', async () => {
    publish('v1');
    mockServer.fail.set('v1/p003.ttf.gz', 99); // network drops on this file
    const app = launch();
    await app.startPackDownload();
    const s = app.usePackStore.getState().status;
    expect(s.state).toBe('paused');
    if (s.state !== 'paused') throw new Error();
    expect(s.done).toBeGreaterThan(0);
    expect(app.activePackUri()).toBeNull(); // never print mode with missing files

    // Kill + reopen: the partial is detected with the same progress.
    const reopened = launch();
    await reopened.initPack();
    const r = reopened.usePackStore.getState().status;
    expect(r).toMatchObject({ state: 'paused', reason: 'interrupted', done: s.done });

    mockServer.fail.clear();
    const before = new Set(mockServer.downloads.filter((p) => p !== 'v1/p003.ttf.gz'));
    mockServer.downloads = [];
    await reopened.startPackDownload();
    expect(reopened.usePackStore.getState().status.state).toBe('ready');
    // Only what was missing was fetched again.
    for (const p of mockServer.downloads) expect(before.has(p)).toBe(false);
  });

  it('a corrupted file is fetched again; persistent corruption never becomes the active pack', async () => {
    publish('v1');
    mockServer.corrupt.set('v1/p002.ttf.gz', 1);
    let app = launch();
    await app.startPackDownload();
    expect(app.usePackStore.getState().status.state).toBe('ready');
    expect(mockServer.downloads.filter((p) => p === 'v1/p002.ttf.gz')).toHaveLength(2);

    mockDisk.files.clear();
    mockDisk.dirs.clear();
    mockDisk.dirs.add('file:///doc');
    mockServer.corrupt.set('v1/p004.ttf.gz', 99);
    app = launch();
    await app.startPackDownload();
    expect(app.usePackStore.getState().status).toMatchObject({ state: 'paused', reason: 'error' });
    expect(app.activePackUri()).toBeNull();
    expect(mockDisk.files.has(`${ROOT}/active.json`)).toBe(false);
  });

  it('checks free space first and reports the need only when short', async () => {
    const m = publish('v1');
    mockDisk.free = 1000;
    const app = launch();
    await app.startPackDownload();
    const s = app.usePackStore.getState().status;
    expect(s).toMatchObject({ state: 'paused', reason: 'nospace' });
    if (s.state === 'paused') expect(s.needBytes).toBeGreaterThan(m.totalRaw);
    expect(mockServer.downloads).toEqual([]);
  });

  it('offline before starting: a clear stopped state, nothing lost', async () => {
    publish('v1');
    require('@tanstack/react-query').onlineManager.setOnline(false);
    const app = launch();
    await app.startPackDownload();
    expect(app.usePackStore.getState().status).toMatchObject({ state: 'paused', reason: 'offline' });
  });

  it('a damaged installed pack is not served and only the bad file is re-downloaded', async () => {
    publish('v1');
    let app = launch();
    await app.startPackDownload();
    mockDisk.files.delete(`${ROOT}/v1/p005.ttf`);

    app = launch();
    await app.initPack();
    expect(app.usePackStore.getState().status).toMatchObject({ state: 'paused', reason: 'interrupted' });
    expect(app.activePackUri()).toBeNull();

    mockServer.downloads = [];
    await app.startPackDownload();
    expect(app.usePackStore.getState().status.state).toBe('ready');
    expect(mockServer.downloads).toEqual(['v1/p005.ttf.gz']);
  });

  it('a new version never replaces the good one until it has fully verified', async () => {
    publish('v1');
    let app = launch();
    await app.startPackDownload();
    publish('v2');
    mockServer.fail.set('v2/p004.ttf.gz', 99);
    app = launch();
    await app.initPack();
    await app.startPackDownload();
    expect(app.activePackUri()).toBe(`${ROOT}/v1`); // still reading v1
    expect(mockDisk.files.has(`${ROOT}/v1/p001.ttf`)).toBe(true);

    mockServer.fail.clear();
    await app.startPackDownload();
    expect(app.usePackStore.getState().status).toEqual({ state: 'ready', version: 'v2' });
    expect(app.activePackUri()).toBe(`${ROOT}/v2`);
    expect([...mockDisk.dirs].some((d) => d.endsWith('/v1'))).toBe(false);
  });

  it('a crash between the switch and the pointer write adopts the verified pack', async () => {
    publish('v1');
    let app = launch();
    await app.startPackDownload();
    mockDisk.files.delete(`${ROOT}/active.json`);
    mockServer.downloads = [];
    app = launch();
    await app.initPack();
    expect(app.usePackStore.getState().status.state).toBe('ready');
    expect(mockServer.downloads).toEqual([]);
  });

  it('a manifest naming files outside the pack is refused before anything is written', async () => {
    const m = publish('v1');
    m.files[1] = { ...m.files[1], name: '../../evil.ttf', path: '../../evil.ttf.gz' };
    const app = launch();
    await app.startPackDownload();
    expect(app.usePackStore.getState().status).toMatchObject({ state: 'paused', reason: 'error' });
    expect(mockServer.downloads).toEqual([]);
    expect([...mockDisk.files.keys()].some((k) => k.includes('evil'))).toBe(false);
  });

  it('no pack source configured: print mode is not offered, the simplified mushaf opens directly', async () => {
    mockEnv.mushafPackUrl = null;
    const app = launch();
    await app.initPack();
    expect(app.usePackStore.getState().status).toEqual({ state: 'unsupported' });
  });
});
