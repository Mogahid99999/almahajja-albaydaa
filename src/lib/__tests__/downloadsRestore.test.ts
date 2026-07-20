/**
 * src/lib/downloads.ts — restore-after-reinstall (V19).
 *
 * A reinstall wipes the app's private manifest + SAF grant, but the audio files
 * survive in the user's public folder. `restoreDownloadsFromPublicFolder` walks
 * that folder and relinks each .mp3 back to a lecture id by matching its
 * sanitized `<section>/<lesson>` name against the user's server lecture list —
 * the only bridge from a lossy filename to a real id.
 *
 * Guards:
 *  - a file whose name matches a lecture is relinked with the lecture's real id
 *    + its live SAF content:// URI (so it plays offline);
 *  - the collision suffix « (2)» and case/spacing differences still match;
 *  - a file with no matching lecture is counted as unmatched, never mis-linked;
 *  - an already-downloaded lecture isn't clobbered.
 *
 * Platform is forced to android so the SAF path is exercised.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

// In-memory FS fake (mirrors downloadsManifest.test.ts) for the PRIVATE manifest.
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
  }
  return {
    Directory: FakeDirectory,
    File: FakeFile,
    Paths: { document: 'file:///doc', cache: 'file:///cache' },
  };
});

// The public folder, modeled as a tree of SAF content:// URIs. Mirrors the real
// on-device layout: the GRANTED ROOT the user picks contains the app folder
// «المحجة البيضاء», which contains section dirs, each holding lesson files whose
// display name is URL-encoded into the URI tail (like real SAF). restore scans
// from the root down, so the shape here is root → appFolder → section → files.
const ROOT_URI = 'content://saf/root';
const APP_FOLDER_URI = `${ROOT_URI}/${encodeURIComponent('المحجة البيضاء')}`;
type SafNode = Record<string, string[]>; // dirUri -> child uris
const safTree: SafNode = {};

function enc(s: string): string {
  return encodeURIComponent(s);
}

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  StorageAccessFramework: {
    getUriForDirectoryInRoot: () => 'content://saf/Download',
    requestDirectoryPermissionsAsync: jest.fn(async () => ({
      granted: true,
      directoryUri: 'content://saf/root',
    })),
    deleteAsync: jest.fn(async () => undefined),
    readDirectoryAsync: jest.fn(async (uri: string) => {
      if (safTree[uri]) return safTree[uri];
      throw new Error('not a directory');
    }),
    makeDirectoryAsync: jest.fn(async () => `content://saf/root/${encodeURIComponent('المحجة البيضاء')}`),
  },
}));

import type { RestorableAttachment, RestorableLecture } from '@/api/progress';

function freshDownloads() {
  jest.resetModules();
  // Grant a public-storage root on the SAME module instance downloads.ts will
  // read (resetModules gives each test a fresh store) so ensurePublicRoot
  // resolves without touching the mocked picker.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { usePublicStorageStore } = require('@/stores/publicStorageStore');
  usePublicStorageStore.setState({
    rootUri: ROOT_URI,
    appFolderUri: APP_FOLDER_URI,
    sectionDirs: {},
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../downloads') as typeof import('../downloads');
}

/** Build the public folder tree root → appFolder → section -> [file display names]. */
function seedPublicFolder(sections: Record<string, string[]>) {
  for (const k of Object.keys(safTree)) delete safTree[k];
  const sectionUris: string[] = [];
  for (const [section, files] of Object.entries(sections)) {
    const sectionUri = `${APP_FOLDER_URI}/${enc(section)}`;
    sectionUris.push(sectionUri);
    safTree[sectionUri] = files.map((f) => `${sectionUri}/${enc(f)}`);
  }
  safTree[APP_FOLDER_URI] = sectionUris;
  safTree[ROOT_URI] = [APP_FOLDER_URI];
}

const LEC = (over: Partial<RestorableLecture>): RestorableLecture => ({
  id: 'lec-1',
  title: 'الدرس الأول',
  sheikhName: 'الشيخ',
  durationSec: 600,
  sectionTitle: 'التوحيد',
  sectionId: 'sec-1',
  order: 1,
  positionSec: 0,
  ...over,
});

beforeEach(() => {
  mockFiles.clear();
  mockDirs.clear();
});

describe('restoreDownloadsFromPublicFolder (V19)', () => {
  test('relinks a matching file to its real lecture id + live SAF uri', async () => {
    const dl = freshDownloads();
    seedPublicFolder({ التوحيد: ['الدرس الأول.mp3'] });

    const res = await dl.restoreDownloadsFromPublicFolder([LEC({})]);
    expect(res).toEqual({ restored: 1, alreadyPresent: 0, unmatched: 0 });

    // Now visible through the normal read paths, with the SAF content:// URI.
    expect(dl.listDownloadedIds()).toEqual(['lec-1']);
    expect(dl.localUriFor('lec-1')).toBe(`${APP_FOLDER_URI}/${enc('التوحيد')}/${enc('الدرس الأول.mp3')}`);
    expect(dl.readDownloadMeta('lec-1')).toMatchObject({ title: 'الدرس الأول', sectionId: 'sec-1' });
  });

  test('matches through the « (2)» collision suffix and case differences', async () => {
    const dl = freshDownloads();
    seedPublicFolder({ التوحيد: ['الدرس الأول (2).mp3'] });
    const res = await dl.restoreDownloadsFromPublicFolder([LEC({})]);
    expect(res.restored).toBe(1);
    expect(dl.listDownloadedIds()).toEqual(['lec-1']);
  });

  test('folds Arabic alef/hamza variants — «الاول» file matches «الأول» title', async () => {
    const dl = freshDownloads();
    // File on disk named from an older title spelling; server returns the corrected one.
    seedPublicFolder({ 'الأصول الثلاثة': ['المجلس الاول.mp3'] });
    const res = await dl.restoreDownloadsFromPublicFolder([
      LEC({ title: 'المجلس الأول', sectionTitle: 'الأصول الثلاثة' }),
    ]);
    expect(res.restored).toBe(1);
    expect(dl.listDownloadedIds()).toEqual(['lec-1']);
  });

  test('a file with no matching lecture is counted unmatched, never mis-linked', async () => {
    const dl = freshDownloads();
    seedPublicFolder({ التوحيد: ['درس غير معروف.mp3'] });
    const res = await dl.restoreDownloadsFromPublicFolder([LEC({})]);
    expect(res).toEqual({ restored: 0, alreadyPresent: 0, unmatched: 1 });
    expect(dl.listDownloadedIds()).toEqual([]);
  });

  test('carries the resume position from the server progress row', async () => {
    const dl = freshDownloads();
    seedPublicFolder({ التوحيد: ['الدرس الأول.mp3'] });
    await dl.restoreDownloadsFromPublicFolder([LEC({ positionSec: 321 })]);
    expect(dl.readDownloadMeta('lec-1')?.positionSec).toBe(321);
  });

  test('empty folder → nothing restored', async () => {
    const dl = freshDownloads();
    seedPublicFolder({});
    const res = await dl.restoreDownloadsFromPublicFolder([LEC({})]);
    expect(res).toEqual({ restored: 0, alreadyPresent: 0, unmatched: 0 });
  });

  test('re-running after a restore reports alreadyPresent, not "not found"', async () => {
    const dl = freshDownloads();
    seedPublicFolder({ التوحيد: ['الدرس الأول.mp3'] });
    // First run links it.
    expect((await dl.restoreDownloadsFromPublicFolder([LEC({})])).restored).toBe(1);
    // Second run finds the same file already linked — counted as alreadyPresent.
    const again = await dl.restoreDownloadsFromPublicFolder([LEC({})]);
    expect(again).toEqual({ restored: 0, alreadyPresent: 1, unmatched: 0 });
  });
});

describe('picking «المحجة البيضاء» itself (no nested duplicate)', () => {
  // The user picks the app folder directly in the SAF picker: the granted ROOT
  // display name IS «المحجة البيضاء». It must be reused as the app folder — NOT
  // have a second «المحجة البيضاء» created inside it — and its lessons must relink.
  function freshWithAppFolderPicked() {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { usePublicStorageStore } = require('@/stores/publicStorageStore');
    // Root = the app folder itself; NO cached appFolderUri (fresh reinstall).
    usePublicStorageStore.setState({
      rootUri: APP_FOLDER_URI,
      appFolderUri: null,
      sectionDirs: {},
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../downloads') as typeof import('../downloads');
  }

  test('reuses the picked folder, creates no child, and relinks its lessons', async () => {
    // Sections live DIRECTLY under the picked app folder (root).
    for (const k of Object.keys(safTree)) delete safTree[k];
    const sectionUri = `${APP_FOLDER_URI}/${enc('الأصول الثلاثة')}`;
    safTree[sectionUri] = [`${sectionUri}/${enc('المجلس الاول.mp3')}`];
    safTree[APP_FOLDER_URI] = [sectionUri];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacy = require('expo-file-system/legacy');
    legacy.StorageAccessFramework.makeDirectoryAsync.mockClear();

    const dl = freshWithAppFolderPicked();
    const res = await dl.restoreDownloadsFromPublicFolder([
      LEC({ title: 'المجلس الأول', sectionTitle: 'الأصول الثلاثة' }),
    ]);

    expect(res.restored).toBe(1);
    expect(dl.listDownloadedIds()).toEqual(['lec-1']);
    // The crux: NO nested «المحجة البيضاء» folder was created under the app folder.
    expect(legacy.StorageAccessFramework.makeDirectoryAsync).not.toHaveBeenCalled();
  });
});

// ── Section files (attachments) restore ──────────────────────────────────────
//
// Section files download into the SAME <section> folders as lectures and are
// relinked by the SAME scan. A restore must recover a .pdf (or .txt/.jpg) next to
// its lectures, matching by sanitized <section>/<title>, keyed `att:<id>` so it
// never collides with a lecture-id key.
const ATT = (over: Partial<RestorableAttachment>): RestorableAttachment => ({
  id: 'att-1',
  attachmentType: 'pdf',
  title: 'كتاب التوحيد',
  sectionTitle: 'التوحيد',
  ...over,
});

describe('relinkScannedAttachments (section files)', () => {
  test('relinks a matching .pdf to its attachment id + live SAF uri', async () => {
    const dl = freshDownloads();
    seedPublicFolder({ التوحيد: ['كتاب التوحيد.pdf'] });
    const { attachmentFiles } = await dl.scanPublicFolderForRestore();

    const res = dl.relinkScannedAttachments(attachmentFiles, [ATT({})]);
    expect(res).toEqual({ restored: 1, alreadyPresent: 0, unmatched: 0 });

    // Visible through the attachment read paths — and NOT counted as a lecture.
    expect(dl.listDownloadedAttachmentIds()).toEqual(['att-1']);
    expect(dl.listDownloadedIds()).toEqual([]);
    expect(dl.localUriForAttachmentEntry('att-1')).toBe(
      `${APP_FOLDER_URI}/${enc('التوحيد')}/${enc('كتاب التوحيد.pdf')}`,
    );
  });

  test('lectures and section files in the same folder both relink', async () => {
    const dl = freshDownloads();
    seedPublicFolder({ التوحيد: ['الدرس الأول.mp3', 'كتاب التوحيد.pdf'] });
    const { files, attachmentFiles } = await dl.scanPublicFolderForRestore();

    const lecRes = dl.relinkScannedFiles(files, [LEC({})]);
    const attRes = dl.relinkScannedAttachments(attachmentFiles, [ATT({})]);
    const merged = dl.mergeRestoreResults(lecRes, attRes);

    expect(merged).toEqual({ restored: 2, alreadyPresent: 0, unmatched: 0 });
    expect(dl.listDownloadedIds()).toEqual(['lec-1']);
    expect(dl.listDownloadedAttachmentIds()).toEqual(['att-1']);
  });

  test('folds the « (2)» collision suffix and Arabic variants for section files', async () => {
    const dl = freshDownloads();
    seedPublicFolder({ 'الأصول الثلاثة': ['كتاب الاصول (2).pdf'] });
    const { attachmentFiles } = await dl.scanPublicFolderForRestore();
    const res = dl.relinkScannedAttachments(attachmentFiles, [
      ATT({ title: 'كتاب الأصول', sectionTitle: 'الأصول الثلاثة' }),
    ]);
    expect(res.restored).toBe(1);
    expect(dl.listDownloadedAttachmentIds()).toEqual(['att-1']);
  });

  test('a section file with no matching attachment is unmatched, never mis-linked', async () => {
    const dl = freshDownloads();
    seedPublicFolder({ التوحيد: ['ملف غير معروف.pdf'] });
    const { attachmentFiles } = await dl.scanPublicFolderForRestore();
    const res = dl.relinkScannedAttachments(attachmentFiles, [ATT({})]);
    expect(res).toEqual({ restored: 0, alreadyPresent: 0, unmatched: 1 });
    expect(dl.listDownloadedAttachmentIds()).toEqual([]);
  });
});
