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
  | { state: 'pending' }
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

/** Polls until the mix is ready, will never come, or `timeoutMs` passes (→ none). */
export async function waitListenerMix(
  dir: Pick<ListenerDir, 'state'>,
  room: string,
  o: { timeoutMs: number; pollMs: number; signal?: AbortSignal; sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<ListenerState> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + o.timeoutMs;
  for (;;) {
    const s = await dir.state(room);
    if (s.state !== 'pending') return s;
    if (o.signal?.aborted) return { state: 'none', reason: 'aborted' };
    if (now() >= deadline) return { state: 'none', reason: 'listener mix not ready in time' };
    await sleep(o.pollMs);
  }
}
