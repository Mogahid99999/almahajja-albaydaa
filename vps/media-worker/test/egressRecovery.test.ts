import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  copyIntoRecordings,
  EgressTmpDir,
  isEnvRoomName,
  isOwnRecordingName,
  recoveredFileName,
} from '../src/egressRecovery.js';

const STG_ROOM = 'stg_0a1b2c3d4e5f';
const PRD_ROOM = 'prd_9f8e7d6c5b4a';
const STG_FILE = `${STG_ROOM}-2026-09-29T100000.ogg`;
const PRD_FILE = `${PRD_ROOM}-2026-09-29T100000.ogg`;

let root: string;
let tmpRoot: string;
let recDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mw-egress-'));
  tmpRoot = join(root, 'egress-tmp');
  recDir = join(root, 'recordings', 'stg');
  await mkdir(tmpRoot, { recursive: true });
  await mkdir(recDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe('env-prefix safety (the tmp dir holds BOTH envs\' files)', () => {
  it('a stg worker only ever accepts <stg room>-….ogg; never a prd_ file or a prd room', () => {
    expect(isEnvRoomName(STG_ROOM, 'stg')).toBe(true);
    expect(isEnvRoomName(PRD_ROOM, 'stg')).toBe(false);
    expect(isEnvRoomName('stg_', 'stg')).toBe(false);
    expect(isEnvRoomName('stgroom', 'stg')).toBe(false);

    expect(isOwnRecordingName(STG_FILE, STG_ROOM, 'stg')).toBe(true);
    expect(isOwnRecordingName(PRD_FILE, STG_ROOM, 'stg')).toBe(false); // other env's file
    expect(isOwnRecordingName(PRD_FILE, PRD_ROOM, 'stg')).toBe(false); // other env's room
    expect(isOwnRecordingName(PRD_FILE, PRD_ROOM, 'prd')).toBe(true);
    expect(isOwnRecordingName(STG_FILE, STG_ROOM, 'prd')).toBe(false);
    // another stg room, traversal, wrong type, bare room name
    expect(isOwnRecordingName(`stg_ffffffffffff-2026.ogg`, STG_ROOM, 'stg')).toBe(false);
    expect(isOwnRecordingName(`${STG_ROOM}-../x.ogg`, STG_ROOM, 'stg')).toBe(false);
    expect(isOwnRecordingName(`${STG_ROOM}-2026.json`, STG_ROOM, 'stg')).toBe(false);
    expect(isOwnRecordingName(`${STG_ROOM}.ogg`, STG_ROOM, 'stg')).toBe(false);
  });

  it('find() in a shared egress dir returns only the own-env file; a prd worker only the prd one', async () => {
    const eg = join(tmpRoot, 'EG_shared1');
    await mkdir(eg);
    await writeFile(join(eg, STG_FILE), 'stg-partial');
    await writeFile(join(eg, PRD_FILE), 'prd-partial-longer');

    const stg = new EgressTmpDir(tmpRoot, 'stg');
    const prd = new EgressTmpDir(tmpRoot, 'prd');
    expect((await stg.find('EG_shared1', STG_ROOM))?.name).toBe(STG_FILE);
    expect((await prd.find('EG_shared1', PRD_ROOM))?.name).toBe(PRD_FILE);
    // a stg worker asking about a prd room gets nothing, even though the file is there
    expect(await stg.find('EG_shared1', PRD_ROOM)).toBeNull();
    expect(await prd.find('EG_shared1', STG_ROOM)).toBeNull();
  });

  it('refuses egress ids that are not a single EG_ segment', async () => {
    await mkdir(join(tmpRoot, 'EG_ok'));
    await writeFile(join(tmpRoot, 'EG_ok', STG_FILE), 'x');
    const stg = new EgressTmpDir(tmpRoot, 'stg');
    for (const id of ['../EG_ok', 'EG_ok/..', 'EG_ok/../EG_ok', 'eg_ok', '', 'EG_', 'EG_ok\\x']) {
      expect(await stg.find(id, STG_ROOM)).toBeNull();
    }
    expect(await stg.find('EG_ok', STG_ROOM)).not.toBeNull();
  });

  it('never follows a symlinked egress dir out of the tmp root', async (ctx) => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, STG_FILE), 'secret');
    try {
      await symlink(outside, join(tmpRoot, 'EG_link'), 'junction');
    } catch {
      ctx.skip();
    }
    expect(await new EgressTmpDir(tmpRoot, 'stg').find('EG_link', STG_ROOM)).toBeNull();
  });

  it('several candidates → the largest; missing mount → unavailable, nothing found', async () => {
    const eg = join(tmpRoot, 'EG_two');
    await mkdir(eg);
    await writeFile(join(eg, `${STG_ROOM}-a.ogg`), 'small');
    await writeFile(join(eg, `${STG_ROOM}-b.ogg`), 'much bigger partial');
    const stg = new EgressTmpDir(tmpRoot, 'stg');
    expect(await stg.available()).toBe(true);
    expect((await stg.find('EG_two', STG_ROOM))?.name).toBe(`${STG_ROOM}-b.ogg`);

    const gone = new EgressTmpDir(join(root, 'no-such-mount'), 'stg');
    expect(await gone.available()).toBe(false);
    expect(await gone.find('EG_two', STG_ROOM)).toBeNull();
  });
});

describe('recovered copy', () => {
  it('names: -recovered, then -recovered-2 … never an existing name', () => {
    expect(recoveredFileName(STG_FILE, () => false)).toBe(`${STG_ROOM}-2026-09-29T100000-recovered.ogg`);
    const taken = new Set([`${STG_ROOM}-2026-09-29T100000-recovered.ogg`, `${STG_ROOM}-2026-09-29T100000-recovered-2.ogg`]);
    expect(recoveredFileName(STG_FILE, (n) => taken.has(n))).toBe(`${STG_ROOM}-2026-09-29T100000-recovered-3.ogg`);
  });

  it('copies byte-for-byte under a new name, never overwriting a raw; the source is left for the caller', async () => {
    const eg = join(tmpRoot, 'EG_copy');
    await mkdir(eg);
    const bytes = Buffer.from('OggS-partial-without-EOS-page');
    await writeFile(join(eg, STG_FILE), bytes);
    // an earlier recovered copy of the same original already exists
    await writeFile(join(recDir, `${STG_ROOM}-2026-09-29T100000-recovered.ogg`), 'older copy');

    const src = await new EgressTmpDir(tmpRoot, 'stg').find('EG_copy', STG_ROOM);
    const copied = await copyIntoRecordings(src!, recDir);
    expect(copied.name).toBe(`${STG_ROOM}-2026-09-29T100000-recovered-2.ogg`);
    expect(copied.size).toBe(bytes.length);
    expect(await readFile(copied.path)).toEqual(bytes);
    expect(await readFile(join(recDir, `${STG_ROOM}-2026-09-29T100000-recovered.ogg`), 'utf8')).toBe('older copy');
    expect(await exists(join(eg, STG_FILE))).toBe(true);
  });

  it('remove() deletes the source and its now-empty egress dir — only the fenced file', async () => {
    const eg = join(tmpRoot, 'EG_rm');
    await mkdir(eg);
    await writeFile(join(eg, STG_FILE), 'partial');
    const tmp = new EgressTmpDir(tmpRoot, 'stg');
    const src = (await tmp.find('EG_rm', STG_ROOM))!;
    expect(await tmp.remove(src, 'EG_rm', STG_ROOM)).toEqual({ removed: true });
    expect(await exists(eg)).toBe(false);

    // a dir shared with a prd file: the stg file goes, the prd file and the dir stay
    const shared = join(tmpRoot, 'EG_rm2');
    await mkdir(shared);
    await writeFile(join(shared, STG_FILE), 'stg');
    await writeFile(join(shared, PRD_FILE), 'prd');
    const s2 = (await tmp.find('EG_rm2', STG_ROOM))!;
    expect((await tmp.remove(s2, 'EG_rm2', STG_ROOM)).removed).toBe(true);
    expect(await readdir(shared)).toEqual([PRD_FILE]);

    // refuses when the fence no longer matches (wrong room)
    await writeFile(join(shared, STG_FILE), 'stg again');
    const s3 = (await tmp.find('EG_rm2', STG_ROOM))!;
    expect((await tmp.remove(s3, 'EG_rm2', PRD_ROOM)).removed).toBe(false);
    expect(await exists(join(shared, STG_FILE))).toBe(true);
  });
});
