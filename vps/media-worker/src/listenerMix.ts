// The listener-rec mix of a live room (vps/listener-rec, recording beside the egress since
// 2026-11-14). It follows the server's arrival clock, so it has none of the egress mixer's
// holes; the owner made it the lecture's primary source on 2026-11-14, with the egress raw as
// the fallback (it is still backed up as before).
//
// Layout written by listener-rec: <LISTENER_DIR>/<room>-<YYYYMMDDTHHMMSSZ>/ with per-track
// .ogg files, manifest.json, then mix.ogg — written as mix.part.ogg and renamed only when
// ffmpeg has finished, so mix.ogg present = complete. mix.failed = the mix will never come.
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type ListenerMix = { path: string; size: number; dirName: string };
export type ListenerState =
  | { state: 'ready'; mix: ListenerMix }
  /** `writtenAtMs`: last write of mix.part.ogg, when ffmpeg is mixing right now. */
  | { state: 'pending'; writtenAtMs?: number }
  | { state: 'none'; reason: string };

const ROOM_RE = /^(?:prd|stg)_[a-z0-9]+$/;

/** The room of an egress raw name: `prd_f1ec5df8db7f-2026-11-14T191528.ogg` → `prd_f1ec5df8db7f`. */
export function roomFromRawName(name: string): string | null {
  const m = /^((?:prd|stg)_[a-z0-9]+)-\d{4}-\d{2}-\d{2}T/.exec(name);
  return m ? (m[1] as string) : null;
}

export class ListenerDir {
  constructor(private readonly root: string) {}

  async state(room: string): Promise<ListenerState> {
    if (!ROOM_RE.test(room)) return { state: 'none', reason: 'bad room name' };
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch {
      return { state: 'none', reason: 'listener dir unreadable' };
    }
    const dirRe = new RegExp(`^${room}-\\d{8}T\\d{6}Z$`);
    const dirs = names.filter((n) => dirRe.test(n));
    if (dirs.length === 0) return { state: 'none', reason: 'no listener recording' };
    // Several folders = the recorder rejoined mid-live; joining them is not done yet.
    if (dirs.length > 1) return { state: 'none', reason: `several listener folders (${dirs.length})` };
    const dirName = dirs[0] as string;
    const dir = join(this.root, dirName);
    if (await isFile(join(dir, 'mix.failed'))) return { state: 'none', reason: 'listener mix failed' };
    try {
      const st = await lstat(join(dir, 'mix.ogg'));
      if (st.isFile() && st.size > 0) return { state: 'ready', mix: { path: join(dir, 'mix.ogg'), size: st.size, dirName } };
      return { state: 'none', reason: 'mix.ogg is not a regular non-empty file' };
    } catch {
      try {
        const part = await lstat(join(dir, 'mix.part.ogg'));
        if (part.isFile()) return { state: 'pending', writtenAtMs: part.mtimeMs };
      } catch {
        // the mix has not started yet
      }
      return { state: 'pending' };
    }
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await lstat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * The mix takes time in proportion to the live (2026-11-18: 3 h 14 min with 6 tracks took
 * ~13 min of one core), so a fixed wait would give a long live to the egress fallback. Past
 * `timeoutMs` the wait goes on while ffmpeg is still writing mix.part.ogg (a write within
 * `stallMs`), up to `maxWaitMs` in all.
 */
export const LISTENER_STALL_MS = 5 * 60_000;
export const LISTENER_MAX_WAIT_MS = 90 * 60_000;

/** Polls until the mix is ready, will never come, or the wait runs out (→ none). */
export async function waitListenerMix(
  dir: Pick<ListenerDir, 'state'>,
  room: string,
  o: {
    timeoutMs: number;
    pollMs: number;
    stallMs?: number;
    maxWaitMs?: number;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<ListenerState> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  const deadline = start + o.timeoutMs;
  const hardDeadline = start + Math.max(o.timeoutMs, o.maxWaitMs ?? LISTENER_MAX_WAIT_MS);
  const stallMs = o.stallMs ?? LISTENER_STALL_MS;
  for (;;) {
    const s = await dir.state(room);
    if (s.state !== 'pending') return s;
    if (o.signal?.aborted) return { state: 'none', reason: 'aborted' };
    const t = now();
    if (t >= deadline) {
      const mixing = s.writtenAtMs !== undefined && t - s.writtenAtMs < stallMs;
      if (!mixing) {
        return {
          state: 'none',
          reason: s.writtenAtMs !== undefined ? 'listener mix stalled' : 'listener mix not ready in time',
        };
      }
      if (t >= hardDeadline) return { state: 'none', reason: 'listener mix still running at the longest wait' };
    }
    await sleep(o.pollMs);
  }
}
