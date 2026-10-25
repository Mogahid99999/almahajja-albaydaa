/**
 * The Madinah print pack — the 604 per-page Madinah mushaf fonts + one glyph
 * index — downloaded ONCE on first use, then fully offline.
 *
 * On-device layout (Paths.document/mushaf-pack/):
 *   active.json                 { version } — written LAST, only after a pack verified
 *   <version>/                  the verified pack (p001.ttf … p604.ttf, glyphs.json, manifest.json)
 *   staging-<version>/          an in-progress download + progress.json { version, manifest, done[] }
 *
 * Guarantees:
 *   - resumable per file: progress.json lists every file already written AND
 *     verified, so a kill/crash/offline only re-fetches what is missing;
 *   - every file is gunzipped (CRC-checked) and its MD5 compared with the
 *     manifest before it counts as done; a bad file is fetched again;
 *   - print mode is only ever served from a directory named in active.json, and
 *     active.json is switched only after the whole new pack verified — an older
 *     good pack stays in use (and on disk) until then;
 *   - free space is checked before starting; the UI shows it only when short.
 * Downloads run while the app is alive (no background-transfer promise).
 */
import { onlineManager } from '@tanstack/react-query';
import { Directory, File, Paths } from 'expo-file-system';
import { gunzipSync } from 'fflate';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { supabase } from '@/lib/supabase';

export type PackFile = { name: string; path: string; size: number; raw: number; md5: string };
export type PackManifest = {
  version: string;
  totalSize: number;
  totalRaw: number;
  files: PackFile[];
};

export type PackState =
  | { state: 'unsupported' }
  | { state: 'checking' }
  /** Nothing on disk yet. `total` = download size once the manifest is known. */
  | { state: 'idle'; total: number | null }
  | { state: 'downloading'; done: number; total: number }
  /** Stopped with a partial download kept on disk. */
  | { state: 'paused'; done: number; total: number; reason: PauseReason; needBytes?: number }
  | { state: 'verifying'; total: number }
  | { state: 'ready'; version: string };
export type PauseReason = 'interrupted' | 'offline' | 'error' | 'nospace';

type Store = {
  status: PackState;
  /** Shown once on the prep screen right after the switch («تم تجهيز المصحف ✓»). */
  justCompleted: boolean;
  set: (s: PackState) => void;
};

export const usePackStore = create<Store>((set) => ({
  status: Platform.OS === 'web' ? { state: 'unsupported' } : { state: 'checking' },
  justCompleted: false,
  set: (status) => set({ status }),
}));

const setStatus = (s: PackState) => usePackStore.getState().set(s);

// ---------- paths ----------
const root = () => new Directory(Paths.document, 'mushaf-pack');
const activeFile = () => new File(root(), 'active.json');
const versionDir = (v: string) => new Directory(root(), safe(v));
const stagingDir = (v: string) => new Directory(root(), 'staging-' + safe(v));
const safe = (v: string) => v.replace(/[^a-zA-Z0-9._-]/g, '_');

let activeVersion: string | null = null;
/** file:// URI of the verified pack directory, or null when print mode is unavailable. */
export function activePackUri(): string | null {
  return activeVersion ? versionDir(activeVersion).uri : null;
}

async function readJson<T>(f: File): Promise<T | null> {
  try {
    if (!f.exists) return null;
    return JSON.parse(await f.text()) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(dir: Directory, name: string, value: unknown) {
  const tmp = new File(dir, name + '.tmp');
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(JSON.stringify(value));
  const dest = new File(dir, name);
  if (dest.exists) dest.delete();
  tmp.rename(name);
}

type Progress = { version: string; manifest: PackManifest; done: string[] };

const doneBytes = (m: PackManifest, done: Set<string>) =>
  m.files.reduce((a, f) => a + (done.has(f.name) ? f.size : 0), 0);

/** Size-only check of every file (cheap); returns the names that are missing or wrong. */
function badFiles(dir: Directory, m: PackManifest): string[] {
  return m.files
    .filter((f) => {
      const file = new File(dir, f.name);
      return !file.exists || file.size !== f.raw;
    })
    .map((f) => f.name);
}

// ---------- init: what is on disk? ----------
let initPromise: Promise<void> | null = null;

/**
 * Reads the on-disk state (once per app session). A verified pack whose files
 * went missing/corrupt is NOT served: it is turned back into a partial download
 * holding only its good files, so «متابعة التحميل» repairs just the bad ones.
 */
export function initPack(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  if (!initPromise) initPromise = doInit().catch(() => setStatus({ state: 'idle', total: null }));
  return initPromise;
}

async function doInit() {
  const r = root();
  if (!r.exists) r.create({ intermediates: true, idempotent: true });
  const active = await readJson<{ version: string }>(activeFile());
  if (active?.version) {
    const dir = versionDir(active.version);
    const manifest = dir.exists ? await readJson<PackManifest>(new File(dir, 'manifest.json')) : null;
    const bad = manifest ? badFiles(dir, manifest) : null;
    if (manifest && bad && bad.length === 0) {
      activeVersion = active.version;
      setStatus({ state: 'ready', version: active.version });
      return;
    }
    // Damaged: demote to a partial download (keep the good files) and stop serving it.
    activeFile().delete();
    if (manifest && bad) {
      for (const n of bad) {
        const f = new File(dir, n);
        if (f.exists) f.delete();
      }
      const st = stagingDir(manifest.version);
      if (st.exists) st.delete();
      dir.rename('staging-' + safe(manifest.version));
      const done = manifest.files.map((f) => f.name).filter((n) => !bad.includes(n));
      writeJsonAtomic(st, 'progress.json', { version: manifest.version, manifest, done } satisfies Progress);
    }
  }
  // A crash between the pack switch and the active.json write leaves a complete,
  // verified directory with no pointer: adopt it rather than downloading again.
  for (const entry of r.list()) {
    if (!(entry instanceof Directory) || entry.name.startsWith('staging-')) continue;
    const m = await readJson<PackManifest>(new File(entry, 'manifest.json'));
    if (m && safe(m.version) === entry.name && badFiles(entry, m).length === 0) {
      writeJsonAtomic(r, 'active.json', { version: m.version });
      activeVersion = m.version;
      setStatus({ state: 'ready', version: m.version });
      return;
    }
  }
  const partial = await findPartial();
  if (partial) {
    setStatus({
      state: 'paused',
      reason: 'interrupted',
      done: doneBytes(partial.manifest, new Set(partial.done)),
      total: partial.manifest.totalSize,
    });
    return;
  }
  setStatus({ state: 'idle', total: null });
}

async function findPartial(): Promise<Progress | null> {
  for (const entry of root().list()) {
    if (entry instanceof Directory && entry.name.startsWith('staging-')) {
      const p = await readJson<Progress>(new File(entry, 'progress.json'));
      if (p?.manifest) return p;
    }
  }
  return null;
}

// ---------- server ----------
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('mushaf-pack', { body });
  if (error) throw error;
  return data as T;
}

const fetchManifest = () => invoke<{ manifest: PackManifest }>({ action: 'manifest' }).then((r) => r.manifest);

/** The download size, for the prep screen before anything is downloaded. */
export async function fetchDownloadSize(): Promise<number | null> {
  try {
    const m = await fetchManifest();
    const s = usePackStore.getState().status;
    if (s.state === 'idle') setStatus({ state: 'idle', total: m.totalSize });
    return m.totalSize;
  } catch {
    return null;
  }
}

// ---------- download ----------
const CONCURRENCY = 4;
const SIGN_BATCH = 40;
const SPACE_MARGIN = 20 * 1024 * 1024;
let running: Promise<void> | null = null;
let stopRequested = false;

class StopError extends Error {}

/** Start or resume. Safe to call repeatedly; resolves when it stops or finishes. */
export function startPackDownload(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  if (!running) {
    stopRequested = false;
    running = runDownload().finally(() => {
      running = null;
    });
  }
  return running;
}

/** Stop after the files in flight; everything verified so far is kept. */
export function stopPackDownload() {
  stopRequested = true;
}

async function runDownload() {
  await initPack();
  const prev = await findPartial();
  const pausedWith = (reason: PauseReason, m: PackManifest | null, done: Set<string>, needBytes?: number) =>
    setStatus({
      state: 'paused',
      reason,
      done: m ? doneBytes(m, done) : 0,
      total: m?.totalSize ?? 0,
      needBytes,
    });

  if (!onlineManager.isOnline()) {
    if (prev) pausedWith('offline', prev.manifest, new Set(prev.done));
    else pausedWith('offline', null, new Set());
    return;
  }

  let manifest: PackManifest;
  try {
    manifest = await fetchManifest();
  } catch {
    pausedWith(onlineManager.isOnline() ? 'error' : 'offline', prev?.manifest ?? null, new Set(prev?.done ?? []));
    return;
  }
  if (activeVersion === manifest.version) {
    setStatus({ state: 'ready', version: manifest.version });
    return;
  }

  // A partial download of an OLDER version is not a usable pack — start this version fresh.
  for (const entry of root().list()) {
    if (entry instanceof Directory && entry.name.startsWith('staging-') && entry.name !== 'staging-' + safe(manifest.version)) {
      entry.delete();
    }
  }
  const st = stagingDir(manifest.version);
  if (!st.exists) st.create({ intermediates: true, idempotent: true });
  const done = new Set(prev && prev.version === manifest.version ? prev.done : []);
  const save = () => writeJsonAtomic(st, 'progress.json', { version: manifest.version, manifest, done: [...done] } satisfies Progress);
  save();

  const todo = manifest.files.filter((f) => !done.has(f.name));
  const need = todo.reduce((a, f) => a + f.raw + 0, 0) + SPACE_MARGIN;
  if (Paths.availableDiskSpace < need) {
    pausedWith('nospace', manifest, done, need);
    return;
  }

  const progress = () =>
    setStatus({ state: 'downloading', done: doneBytes(manifest, done), total: manifest.totalSize });
  progress();

  let failure: PauseReason | null = null;
  try {
    for (let i = 0; i < todo.length; i += SIGN_BATCH) {
      if (stopRequested) throw new StopError();
      const batch = todo.slice(i, i + SIGN_BATCH);
      const { urls } = await invoke<{ urls: Record<string, string> }>({
        action: 'sign',
        version: manifest.version,
        paths: batch.map((f) => f.path),
      });
      let next = 0;
      // One failure stops the others from taking new files; every worker is
      // awaited (allSettled) so none reports progress after we report the stop.
      let aborted = false;
      const worker = async () => {
        while (next < batch.length && !aborted) {
          if (stopRequested) throw new StopError();
          const f = batch[next++];
          await fetchOne(st, f, urls[f.path]);
          done.add(f.name);
          save();
          if (!aborted) progress();
        }
      };
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, () =>
          worker().catch((e) => {
            aborted = true;
            throw e;
          }),
        ),
      );
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    }
  } catch (e) {
    failure = e instanceof StopError ? 'interrupted' : onlineManager.isOnline() ? 'error' : 'offline';
  }
  if (failure) {
    save();
    pausedWith(failure, manifest, done);
    return;
  }

  // ---- verify + atomic switch ----
  setStatus({ state: 'verifying', total: manifest.totalSize });
  const bad = badFiles(st, manifest);
  if (bad.length) {
    for (const n of bad) done.delete(n);
    save();
    pausedWith('error', manifest, done);
    return;
  }
  writeJsonAtomic(st, 'manifest.json', manifest);
  new File(st, 'progress.json').delete();
  const finalDir = versionDir(manifest.version);
  if (finalDir.exists) finalDir.delete(); // never the active one: activeVersion !== manifest.version
  st.rename(safe(manifest.version));
  const oldVersion = activeVersion;
  writeJsonAtomic(root(), 'active.json', { version: manifest.version });
  activeVersion = manifest.version;
  if (oldVersion && oldVersion !== manifest.version) {
    const old = versionDir(oldVersion);
    if (old.exists) old.delete();
  }
  usePackStore.setState({ justCompleted: true });
  setStatus({ state: 'ready', version: manifest.version });
}

/** Download one gzipped file, unpack, verify size + MD5; retried once. */
async function fetchOne(dir: Directory, f: PackFile, url: string | undefined) {
  if (!url) throw new Error('unsigned ' + f.path);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const tmp = new File(dir, f.name + '.gz.part');
    const out = new File(dir, f.name);
    try {
      if (tmp.exists) tmp.delete();
      await File.downloadFileAsync(url, tmp, { idempotent: true });
      const gz = await tmp.bytes();
      if (gz.length !== f.size) throw new Error('size');
      const raw = gunzipSync(gz); // throws on a CRC/length mismatch
      if (raw.length !== f.raw) throw new Error('raw size');
      if (out.exists) out.delete();
      out.create();
      out.write(raw);
      tmp.delete();
      if (out.info({ md5: true }).md5 !== f.md5) throw new Error('md5');
      return;
    } catch (e) {
      lastErr = e;
      if (out.exists) out.delete();
      if (tmp.exists) tmp.delete();
      if (!onlineManager.isOnline()) break;
    }
  }
  throw lastErr;
}

// ---------- glyph index (print mode) ----------
export type GlyphIndex = {
  v: number;
  fx: { width: number; font: number; gap: number };
  shrink: Record<string, number>;
  /** 604 pages × 15 lines; each line = the page font's word glyphs, space-separated. */
  pages: string[][];
};
let glyphs: Promise<GlyphIndex> | null = null;
export function loadGlyphIndex(): Promise<GlyphIndex> {
  if (!activeVersion) return Promise.reject(new Error('no pack'));
  if (!glyphs) {
    const f = new File(versionDir(activeVersion), 'glyphs.json');
    glyphs = f.text().then((t) => JSON.parse(t) as GlyphIndex);
    glyphs.catch(() => {
      glyphs = null;
    });
  }
  return glyphs;
}

/** MB for the UI (binary MB, rounded up so «٥٢ م.ب» never undercounts). */
export const toMB = (bytes: number) => Math.max(1, Math.ceil(bytes / (1024 * 1024)));
