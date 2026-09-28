import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectRecordingsDir, RecordingsDir, recordingsDirMatchesEnv } from '../src/recordings.js';

let root: string;
let stg: string;
let prd: string;
let rec: RecordingsDir;

/** Symlinks to files need privileges on Windows; directory junctions don't. */
async function trySymlink(target: string, path: string, type: 'file' | 'junction'): Promise<boolean> {
  try {
    await symlink(target, path, type);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mw-recdir-'));
  stg = join(root, 'recordings', 'stg');
  prd = join(root, 'recordings', 'prd');
  await mkdir(stg, { recursive: true });
  await mkdir(prd, { recursive: true });
  await writeFile(join(stg, 'stg_a-1.ogg'), 'OggS-stg');
  await writeFile(join(prd, 'prd_a-1.ogg'), 'OggS-prd');
  rec = new RecordingsDir(stg);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('RecordingsDir.check / resolve', () => {
  it('accepts a regular file inside RECORDINGS_DIR (canonical path, size, name)', async () => {
    const r = await rec.resolve(join(stg, 'stg_a-1.ogg'));
    expect(r).toEqual({ path: await realpath(join(stg, 'stg_a-1.ogg')), size: 8, name: 'stg_a-1.ogg' });
  });

  it('refuses the other env folder, ".." segments, relative paths, NUL, non-strings', async () => {
    expect(await rec.check(join(prd, 'prd_a-1.ogg'))).toBe('outside');
    expect(await rec.check(`${stg}/../prd/prd_a-1.ogg`)).toBe('invalid');
    expect(await rec.check(`${stg}/sub/../stg_a-1.ogg`)).toBe('invalid'); // even if it would land inside
    expect(await rec.check('stg_a-1.ogg')).toBe('invalid');
    expect(await rec.check(`${stg}/x\0.ogg`)).toBe('invalid');
    expect(await rec.check(undefined)).toBe('invalid');
    expect(await rec.check(42)).toBe('invalid');
  });

  it('the root itself and a prefix-sibling folder are outside ("/recordings/stg2")', async () => {
    const sibling = `${stg}2`;
    await mkdir(sibling);
    await writeFile(join(sibling, 'x.ogg'), 'x');
    expect(await rec.check(stg)).toBe('outside');
    expect(await rec.check(join(sibling, 'x.ogg'))).toBe('outside');
  });

  it('missing file → missing; a directory → not_file', async () => {
    expect(await rec.check(join(stg, 'nope.ogg'))).toBe('missing');
    await mkdir(join(stg, 'dir.ogg'));
    expect(await rec.check(join(stg, 'dir.ogg'))).toBe('not_file');
  });

  it('refuses a directory symlink/junction that escapes RECORDINGS_DIR', async (ctx) => {
    if (!(await trySymlink(prd, join(stg, 'escape'), 'junction'))) ctx.skip();
    expect(await rec.check(join(stg, 'escape', 'prd_a-1.ogg'))).toBe('outside');
  });

  it('refuses a file symlink that escapes RECORDINGS_DIR (Linux / privileged Windows)', async (ctx) => {
    if (!(await trySymlink(join(prd, 'prd_a-1.ogg'), join(stg, 'link.ogg'), 'file'))) ctx.skip();
    expect(await rec.check(join(stg, 'link.ogg'))).toBe('outside');
  });

  it('follows a symlink that stays inside RECORDINGS_DIR', async (ctx) => {
    await mkdir(join(stg, 'real'));
    await writeFile(join(stg, 'real', 'in.ogg'), 'inside');
    if (!(await trySymlink(join(stg, 'real'), join(stg, 'alias'), 'junction'))) ctx.skip();
    const r = await rec.resolve(join(stg, 'alias', 'in.ogg'));
    expect(r?.path).toBe(await realpath(join(stg, 'real', 'in.ogg')));
  });

  it('a missing RECORDINGS_DIR mount → everything is "missing" (nothing is ever read)', async () => {
    const gone = new RecordingsDir(join(root, 'recordings', 'nope'));
    expect(await gone.check(join(root, 'recordings', 'nope', 'x.ogg'))).toBe('missing');
  });
});

describe('RecordingsDir.delete', () => {
  it('deletes only a regular file inside RECORDINGS_DIR', async () => {
    expect(await rec.delete(join(prd, 'prd_a-1.ogg'))).toBe(false);
    expect(await readFile(join(prd, 'prd_a-1.ogg'), 'utf8')).toBe('OggS-prd');
    expect(await rec.delete(join(stg, 'stg_a-1.ogg'))).toBe(true);
    expect(await rec.check(join(stg, 'stg_a-1.ogg'))).toBe('missing');
  });
});

describe('startup helpers', () => {
  it('inspectRecordingsDir: existing dir is readable (and writable here); missing → not exists', async () => {
    expect(await inspectRecordingsDir(stg)).toEqual({ exists: true, writable: true });
    expect(await inspectRecordingsDir(join(root, 'nope'))).toEqual({ exists: false, writable: false });
    expect((await inspectRecordingsDir(join(stg, 'stg_a-1.ogg'))).exists).toBe(false);
  });

  it('recordingsDirMatchesEnv: the folder must be named after WORKER_ENV', () => {
    expect(recordingsDirMatchesEnv('/recordings/stg', 'stg')).toBe(true);
    expect(recordingsDirMatchesEnv('/recordings/stg/', 'stg')).toBe(true);
    expect(recordingsDirMatchesEnv('/recordings/prd', 'stg')).toBe(false);
    expect(recordingsDirMatchesEnv('/recordings', 'stg')).toBe(false);
  });
});
