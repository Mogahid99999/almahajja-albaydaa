// Local live recordings (P2). LiveKit egress writes raw `.ogg` files to the VPS
// disk; each worker has ONLY its own env's folder mounted, at the same path the
// egress reports: RECORDINGS_DIR = /recordings/<env>.
//
// Every path that reaches the worker from outside (webhook payloads, DB rows)
// goes through `resolve()`: it must be absolute, contain no `..` segment,
// resolve (symlinks included) to a REGULAR file inside RECORDINGS_DIR —
// anything else is treated as "not there". The worker never exposes, reads or
// deletes a path outside that folder.

import { constants } from 'node:fs';
import { access, realpath, stat, unlink } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

export interface ResolvedRecording {
  /** Canonical (symlink-free) absolute path inside RECORDINGS_DIR. */
  path: string;
  size: number;
  name: string;
}

export type ResolveFailure = 'invalid' | 'outside' | 'missing' | 'not_file';

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function hasDotDot(p: string): boolean {
  return p.split(/[\\/]+/).some((seg) => seg === '..');
}

export class RecordingsDir {
  private realRoot: Promise<string> | null = null;

  constructor(public readonly root: string) {}

  private async canonicalRoot(): Promise<string> {
    // Cached on success; retried if the mount was missing earlier.
    this.realRoot ??= realpath(this.root).catch((err: unknown) => {
      this.realRoot = null;
      throw err;
    });
    return this.realRoot;
  }

  /** Detailed variant of `resolve` for logging (never includes the path itself). */
  async check(p: unknown): Promise<ResolvedRecording | ResolveFailure> {
    if (typeof p !== 'string' || !p || p.includes('\0') || !isAbsolute(p) || hasDotDot(p)) return 'invalid';
    const lexical = resolve(p);
    const configured = resolve(this.root);

    let root: string;
    try {
      root = await this.canonicalRoot();
    } catch {
      return isInside(configured, lexical) ? 'missing' : 'outside';
    }
    // Cheap lexical gate first — against the configured root OR its canonical
    // form (a path we handed out earlier is already canonical).
    if (!isInside(configured, lexical) && !isInside(root, lexical)) return 'outside';

    let real: string;
    try {
      real = await realpath(lexical);
    } catch {
      return 'missing';
    }
    // Symlink escape: the canonical target must still be inside the canonical root.
    if (!isInside(root, real)) return 'outside';
    try {
      const st = await stat(real);
      if (!st.isFile()) return 'not_file';
      return { path: real, size: st.size, name: basename(real) };
    } catch {
      return 'missing';
    }
  }

  /** The recording, or null when invalid / outside RECORDINGS_DIR / missing / not a file. */
  async resolve(p: unknown): Promise<ResolvedRecording | null> {
    const r = await this.check(p);
    return typeof r === 'string' ? null : r;
  }

  /** Delete a recording — only ever a regular file inside RECORDINGS_DIR. */
  async delete(p: string): Promise<boolean> {
    const r = await this.resolve(p);
    if (!r) return false;
    await unlink(r.path);
    return true;
  }
}

/** Startup probe of the mount: a readable directory, and whether we may delete in it. */
export async function inspectRecordingsDir(dir: string): Promise<{ exists: boolean; writable: boolean }> {
  try {
    const st = await stat(dir);
    if (!st.isDirectory()) return { exists: false, writable: false };
    await access(dir, constants.R_OK | constants.X_OK);
  } catch {
    return { exists: false, writable: false };
  }
  try {
    await access(dir, constants.W_OK);
    return { exists: true, writable: true };
  } catch {
    return { exists: true, writable: false };
  }
}

/** `/recordings/stg` style check used by config: the folder must be named after the env. */
export function recordingsDirMatchesEnv(dir: string, env: string): boolean {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) === env;
}

