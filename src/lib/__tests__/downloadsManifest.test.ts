/**
 * src/lib/downloads.ts — manifest bookkeeping (audit phase 5).
 *
 * Guards:
 *  - the F-506 in-memory manifest mirror stays COHERENT with every write path
 *    (download, position update, delete, verify-prune) — a stale cache here
 *    would show phantom "downloaded" rows or lose resume positions;
 *  - the F-502 offline neighbour resolution (findDownloadedNeighbor) that
 *    next/prev + auto-advance rely on when there is no connection;
 *  - the download → play → resume round-trip through the sidecar.
 *
 * Runs against an in-memory expo-file-system fake (same approach as the
 * resumeCache tests). Platform is jest-expo's default iOS, so the private
 * Documents path (no SAF) is what's exercised.
 */

// In-memory FS fake. Keyed by full uri.
const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();

jest.mock('expo-file-system', () => {
  class FakeDirectory {
    uri: string;
    constructor(parent: string | FakeDirectory, name?: string) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = name ? `${base}/${name}` : base;
    }
    get exists() {
      return mockDirs.has(this.uri);
    }
    create() {
      mockDirs.add(this.uri);
    }
    delete() {
      mockDirs.delete(this.uri);
      for (const key of [...mockFiles.keys()]) {
        if (key.startsWith(`${this.uri}/`)) mockFiles.delete(key);
      }
    }
    list() {
      return [];
    }
  }
  class FakeFile {
    uri: string;
    constructor(dir: FakeDirectory | string, name?: string) {
      const base = typeof dir === 'string' ? dir : dir.uri;
      this.uri = name ? `${base}/${name}` : base;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    create() {
      mockFiles.set(this.uri, '');
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    write(text: string) {
      mockFiles.set(this.uri, text);
    }
    textSync() {
      const v = mockFiles.get(this.uri);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    }
    static async downloadFileAsync(_url: string, dest: FakeFile) {
      mockFiles.set(dest.uri, 'AUDIO-BYTES');
      return dest;
    }
  }
  return {
    Directory: FakeDirectory,
    File: FakeFile,
    Paths: { document: 'file:///doc', cache: 'file:///cache' },
  };
});

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  StorageAccessFramework: {},
}));

import type { DownloadMeta } from '../downloads';

const META: DownloadMeta = {
  id: 'lec-2',
  title: 'الدرس الثاني',
  sheikhName: 'الشيخ',
  durationSec: 600,
  sectionTitle: 'التوحيد',
  sectionId: 'sec-1',
  order: 2,
};

// downloads.ts caches the manifest at module level — re-require per test for
// isolation, with the fake FS cleared first.
function freshDownloads() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../downloads') as typeof import('../downloads');
}

beforeEach(() => {
  mockFiles.clear();
  mockDirs.clear();
});

async function seed(dl: typeof import('../downloads'), meta: DownloadMeta) {
  await dl.downloadLecture(meta.id, `https://cdn/audio-${meta.id}.mp3`, meta);
}

describe('download → manifest round-trip (F-506 cache coherence)', () => {
  test('a downloaded lecture is immediately visible through every read path', async () => {
    const dl = freshDownloads();
    await seed(dl, META);
    expect(dl.localUriFor('lec-2')).toMatch(/الدرس الثاني\.mp3$/);
    expect(dl.readDownloadMeta('lec-2')).toMatchObject({
      title: 'الدرس الثاني',
      sectionId: 'sec-1',
      order: 2,
    });
    expect(dl.listDownloadedIds()).toEqual(['lec-2']);
  });

  test('updateDownloadPosition is read back by readDownloadMeta (offline resume)', async () => {
    const dl = freshDownloads();
    await seed(dl, META);
    dl.updateDownloadPosition('lec-2', 123.6);
    expect(dl.readDownloadMeta('lec-2')?.positionSec).toBe(124);
  });

  test('deleteLecture drops the entry from every read path', async () => {
    const dl = freshDownloads();
    await seed(dl, META);
    await dl.deleteLecture('lec-2');
    expect(dl.localUriFor('lec-2')).toBeNull();
    expect(dl.readDownloadMeta('lec-2')).toBeNull();
    expect(dl.listDownloadedIds()).toEqual([]);
  });

  test('verifyDownload prunes an entry whose audio file was deleted externally', async () => {
    const dl = freshDownloads();
    await seed(dl, META);
    const uri = dl.localUriFor('lec-2')!;
    mockFiles.delete(uri); // the user removed it in a file manager
    await expect(dl.verifyDownload('lec-2')).resolves.toBe(false);
    // The prune must hit the cached manifest too, not just the disk copy.
    expect(dl.localUriFor('lec-2')).toBeNull();
    expect(dl.listDownloadedIds()).toEqual([]);
  });
});

describe('findDownloadedNeighbor (F-502 — offline next/prev/auto-advance)', () => {
  test('resolves the closest downloaded neighbour in each direction', async () => {
    const dl = freshDownloads();
    await seed(dl, { ...META, id: 'lec-1', title: 'الأول', order: 1 });
    await seed(dl, { ...META, id: 'lec-2', title: 'الثاني', order: 2 });
    await seed(dl, { ...META, id: 'lec-5', title: 'الخامس', order: 5 });
    // Gaps are fine: the next DOWNLOADED lecture is what's playable offline.
    expect(dl.findDownloadedNeighbor('sec-1', 2, 'next')).toEqual({ id: 'lec-5' });
    expect(dl.findDownloadedNeighbor('sec-1', 5, 'prev')).toEqual({ id: 'lec-2' });
    expect(dl.findDownloadedNeighbor('sec-1', 1, 'prev')).toBeNull();
    expect(dl.findDownloadedNeighbor('sec-1', 5, 'next')).toBeNull();
  });

  test('never crosses into another section', async () => {
    const dl = freshDownloads();
    await seed(dl, { ...META, id: 'lec-1', title: 'الأول', order: 1 });
    await seed(dl, { ...META, id: 'other-2', title: 'آخر', sectionId: 'sec-9', order: 2 });
    expect(dl.findDownloadedNeighbor('sec-1', 1, 'next')).toBeNull();
  });

  test('legacy sidecars without section context are skipped, not crashed on', async () => {
    const dl = freshDownloads();
    await seed(dl, { ...META, id: 'old-1', title: 'قديم', sectionId: undefined, order: undefined });
    await seed(dl, { ...META, id: 'lec-3', title: 'الثالث', order: 3 });
    expect(dl.findDownloadedNeighbor('sec-1', 2, 'next')).toEqual({ id: 'lec-3' });
  });
});
