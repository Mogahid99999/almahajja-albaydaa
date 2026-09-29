// Recovery of a crashed egress's partial recording (0146; owner rule: a live
// recording is never lost).
//
// LiveKit egress writes the IN-PROGRESS file to its tmp dir
// (`/home/egress/tmp/<EG_id>/<room>-<time>.ogg`) and moves it to
// /recordings/<env>/ only when it ends cleanly. That tmp dir is mounted into
// BOTH workers (EGRESS_TMP_DIR, default /egress-tmp) and holds BOTH envs' files,
// so every access here is fenced:
//   * the egress id must look like `EG_<alnum>` (one path segment, no `..`),
//   * the file name must start with `<room>-` of a room of THIS worker's env
//     (`stg_…` / `prd_…`) and end in `.ogg` — a stg worker never opens,
//     copies or deletes a prd_ file (and vice versa),
//   * regular files only (lstat: symlinks refused), canonical path inside the root.
// A recovered file is COPIED (the tmp dir is another mount: no rename) into
// RECORDINGS_DIR under a new unique name, flushed to disk, and verified: the
// source must not have changed during the copy (else the egress is still
// writing → abort) and both sizes must match. Only then may the caller delete
// the source.

import { constants } from 'node:fs';
import { copyFile, lstat, open, readdir, realpath, rmdir, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { WorkerEnv } from './config.js';

export const EGRESS_ID_RE = /^EG_[A-Za-z0-9]{1,64}$/;
const SAFE_FILE_RE = /^[A-Za-z0-9_.-]{1,200}$/;

/** A room of this env: `<env>_` + something. */
export function isEnvRoomName(roomName: string, env: WorkerEnv): boolean {
  return typeof roomName === 'string' && roomName.length > env.length + 1 && roomName.startsWith(`${env}_`) &&
    SAFE_FILE_RE.test(roomName);
}

/**
 * Env-prefix safety: an egress file of room `roomName` — `<room>-….ogg` — and
 * only if that room belongs to `env`. Anything else is never touched.
 */
export function isOwnRecordingName(name: string, roomName: string, env: WorkerEnv): boolean {
  return (
    isEnvRoomName(roomName, env) &&
    SAFE_FILE_RE.test(name) &&
    name.startsWith(`${roomName}-`) &&
    name.length > roomName.length + 5 &&
    name.toLowerCase().endsWith('.ogg')
  );
}

/**
 * `<room>-<time>.ogg` → `<room>-<time>-recovered.ogg`, then `-recovered-2`, …
 * — the first name `taken` says is free (never overwrites a raw).
 */
export function recoveredFileName(original: string, taken: (name: string) => boolean): string {
  const stem = original.replace(/\.ogg$/i, '');
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${stem}-recovered.ogg` : `${stem}-recovered-${i}.ogg`;
    if (!taken(name)) return name;
  }
  throw new Error('no free name for the recovered recording');
}

export interface TmpRecording {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
}

function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export class EgressTmpDir {
  constructor(
    public readonly root: string,
    private readonly env: WorkerEnv,
  ) {}

  /** The mount exists and is a readable directory. */
  async available(): Promise<boolean> {
    try {
      const st = await stat(this.root);
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * The in-progress recording of egress `egressId` for room `roomName`
   * (`<root>/<EG_id>/<room>-<time>.ogg`), or null. Several candidates → the
   * largest. Never follows a symlink, never leaves the root, never returns a
   * file of another env's room.
   */
  async find(egressId: string, roomName: string): Promise<TmpRecording | null> {
    if (!EGRESS_ID_RE.test(egressId) || !isEnvRoomName(roomName, this.env)) return null;
    let root: string;
    try {
      root = await realpath(this.root);
    } catch {
      return null;
    }
    const dir = join(root, egressId);
    try {
      const d = await lstat(dir);
      if (!d.isDirectory()) return null; // a symlinked dir is refused too
    } catch {
      return null;
    }
    let best: TmpRecording | null = null;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !isOwnRecordingName(entry.name, roomName, this.env)) continue;
      const path = join(dir, entry.name);
      try {
        const st = await lstat(path);
        if (!st.isFile() || !inside(root, path)) continue;
        if (!best || st.size > best.size) best = { path, name: entry.name, size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        // vanished meanwhile
      }
    }
    return best;
  }

  /** After a verified copy: delete the source and its (now empty) egress dir. Best-effort. */
  async remove(rec: TmpRecording, egressId: string, roomName: string): Promise<{ removed: boolean; error?: string }> {
    // Re-check the fence on the exact file we are about to delete.
    const again = await this.find(egressId, roomName);
    if (!again || again.path !== rec.path) return { removed: false, error: 'source changed or vanished' };
    try {
      await unlink(rec.path);
    } catch (err) {
      return { removed: false, error: (err as Error).message };
    }
    await rmdir(join(await realpath(this.root), egressId)).catch(() => undefined); // only if empty
    return { removed: true };
  }
}

export interface CopiedRecording {
  path: string;
  name: string;
  size: number;
}

export class SourceChangedError extends Error {
  constructor() {
    super('the egress file changed while it was being copied (still being written)');
    this.name = 'SourceChangedError';
  }
}

/**
 * Copy a stopped egress's partial into `recordingsRoot` as
 * `<room>-<time>-recovered[-n].ogg` (exclusive create), fsync it, and verify
 * the source did not change and the sizes match. On any failure the copy is
 * removed again and the source is left untouched.
 */
export async function copyIntoRecordings(src: TmpRecording, recordingsRoot: string): Promise<CopiedRecording> {
  const before = await lstat(src.path);
  if (!before.isFile()) throw new Error('egress file is not a regular file');
  const existing = new Set(await readdir(recordingsRoot));
  const name = recoveredFileName(src.name, (n) => existing.has(n));
  const dest = join(recordingsRoot, name);
  // COPYFILE_EXCL: never overwrite (a raw is never replaced). EEXIST → the file
  // at `dest` is not ours: never clean it up. Any other error (disk full…) → our
  // half-written copy is removed.
  try {
    await copyFile(src.path, dest, constants.COPYFILE_EXCL);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') await unlink(dest).catch(() => undefined);
    throw err;
  }
  try {
    const fh = await open(dest, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    const after = await lstat(src.path);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new SourceChangedError();
    const copied = await stat(dest);
    if (copied.size !== before.size) throw new Error(`copy size mismatch (${copied.size} ≠ ${before.size} bytes)`);
    return { path: dest, name, size: copied.size };
  } catch (err) {
    await unlink(dest).catch(() => undefined);
    throw err;
  }
}
