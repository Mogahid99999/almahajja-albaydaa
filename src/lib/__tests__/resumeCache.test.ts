/**
 * src/lib/resumeCache.ts — the file-per-lecture resume-position sidecar that
 * closes the force-kill/stale-query-cache gap (see the module doc). Tested
 * against an in-memory expo-file-system fake that mirrors the Directory/File
 * class API the module uses.
 */

// In-memory FS fake. Keyed by "<parent>/<name>".
const mockStore = new Map<string, string>();

jest.mock('expo-file-system', () => {
  class FakeDirectory {
    uri: string;
    constructor(parent: string | FakeDirectory, name?: string) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = name ? `${base}/${name}` : base;
    }
    get exists() {
      return true; // create() is idempotent below; existence isn't tracked per-dir
    }
    create() {}
  }
  class FakeFile {
    uri: string;
    constructor(dir: FakeDirectory, name: string) {
      this.uri = `${dir.uri}/${name}`;
    }
    get exists() {
      return mockStore.has(this.uri);
    }
    create() {
      mockStore.set(this.uri, '');
    }
    delete() {
      mockStore.delete(this.uri);
    }
    write(text: string) {
      mockStore.set(this.uri, text);
    }
    textSync() {
      const v = mockStore.get(this.uri);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    }
  }
  return {
    Directory: FakeDirectory,
    File: FakeFile,
    Paths: { document: 'file:///doc' },
  };
});

import {
  getMostRecentlyActiveLectureId,
  readResumePosition,
  saveResumePosition,
} from '../resumeCache';

beforeEach(() => {
  mockStore.clear();
});

describe('save → read round-trip', () => {
  test('persists a rounded, non-negative position with a timestamp', () => {
    jest.useFakeTimers().setSystemTime(1_000_000);
    saveResumePosition('lec-1', 123.6);
    expect(readResumePosition('lec-1')).toEqual({ positionSec: 124, updatedAt: 1_000_000 });
    jest.useRealTimers();
  });

  test('negative positions clamp to 0', () => {
    saveResumePosition('lec-1', -10);
    expect(readResumePosition('lec-1')?.positionSec).toBe(0);
  });

  test('a later save replaces the earlier one', () => {
    saveResumePosition('lec-1', 100);
    saveResumePosition('lec-1', 250);
    expect(readResumePosition('lec-1')?.positionSec).toBe(250);
  });

  test('unknown lecture id reads null', () => {
    expect(readResumePosition('nope')).toBeNull();
  });

  test('corrupt sidecar JSON reads null instead of throwing', () => {
    saveResumePosition('lec-1', 100);
    mockStore.set('file:///doc/resume/lec-1.json', '{broken');
    expect(readResumePosition('lec-1')).toBeNull();
  });
});

describe('last-active pointer (cold-launch reconciliation target)', () => {
  test('tracks the most recently saved lecture', () => {
    saveResumePosition('lec-1', 10);
    saveResumePosition('lec-2', 20);
    expect(getMostRecentlyActiveLectureId()).toBe('lec-2');
  });

  test('null when nothing was ever saved', () => {
    expect(getMostRecentlyActiveLectureId()).toBeNull();
  });

  test('corrupt pointer file degrades to null', () => {
    saveResumePosition('lec-1', 10);
    mockStore.set('file:///doc/resume/_lastActive.json', 'xx');
    expect(getMostRecentlyActiveLectureId()).toBeNull();
  });
});
