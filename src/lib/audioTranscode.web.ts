/**
 * Web admin audio transcoder (platform file: `.web`).
 *
 * Every audio file an admin uploads is converted to a small, speech-optimised
 * MP3 *before* it leaves the browser, so the only object ever stored in the
 * `lectures` bucket is the compressed result (the original is never uploaded —
 * that satisfies the "delete original" requirement for free).
 *
 * ffmpeg command (aggressive VBR, mono, 22.05 kHz — crystal clear for speech,
 * tiny on disk; a ~55 MB lecture lands around 8-12 MB):
 *
 *     ffmpeg -i input -vn -codec:a libmp3lame -q:a 9 -ac 1 -ar 22050 output.mp3
 *
 * `-vn` drops any embedded cover-art/video stream so files with album art don't
 * derail the encode.
 *
 * ── How ffmpeg runs in the browser ──────────────────────────────────────────
 * We use ffmpeg.wasm (single-threaded core, so NO cross-origin-isolation /
 * SharedArrayBuffer headers are required).
 *
 * CRITICAL: the FFmpeg controller spawns a Web Worker from the directory it was
 * loaded from. A browser BLOCKS a Worker whose script is cross-origin, so
 * loading the controller from a CDN makes `ffmpeg.load()` throw ("failed to
 * construct Worker"). We therefore SELF-HOST the tiny controller + worker chunk
 * under `public/ffmpeg/` (served same-origin by Expo's static middleware in dev
 * and copied on `expo export`), and let its worker load same-origin. Only the
 * heavy core (~30 MB `ffmpeg-core.js` + `.wasm`) is fetched from the CDN and
 * turned into a same-origin `blob:` URL (which the worker can `importScripts`).
 *
 * The two self-hosted files (public/ffmpeg/ffmpeg.js + 814.ffmpeg.js) are
 * @ffmpeg/ffmpeg@0.12.10 umd; keep them in sync with CORE_VERSION below. To go
 * fully offline, download @ffmpeg/core@0.12.6 umd into public/ffmpeg/ too and
 * point CORE_BASE at '/ffmpeg'.
 *
 * Caveat: conversion is in-memory wasm; very long lectures can approach the
 * browser's wasm memory ceiling. For the admin's typical lecture sizes this is
 * fine; if it ever isn't, this is the seam to move to a server worker.
 */

// ─── Sources (see the note above) ────────────────────────────────────────────
/** Self-hosted, same-origin controller — its Worker must NOT be cross-origin. */
const CONTROLLER_URL = '/ffmpeg/ffmpeg.js';
const CORE_VERSION = '0.12.6';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

// ─── Minimal shape of the global the UMD controller exposes ──────────────────
type ProgressEvent = { progress: number; time: number };
interface FFmpegInstance {
  loaded: boolean;
  load(opts: { coreURL: string; wasmURL: string }): Promise<boolean>;
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<boolean>;
  exec(args: string[]): Promise<number>;
  on(event: 'progress', cb: (e: ProgressEvent) => void): void;
  off(event: 'progress', cb: (e: ProgressEvent) => void): void;
}
type FFmpegGlobal = { FFmpeg: new () => FFmpegInstance };

export type TranscodeResult = {
  /** Object URL of the compressed MP3 — fetch()-able by the upload path. */
  uri: string;
  /** Output filename, always `<base>.mp3`. */
  name: string;
  /** Compressed size in bytes. */
  size: number;
  mimeType: 'audio/mpeg';
  blob: Blob;
};

/** Thrown for any conversion failure; `message` is admin-facing Arabic. */
export class TranscodeError extends Error {}

// ─── Audio MIME / extension validation ───────────────────────────────────────
const AUDIO_EXTS = new Set([
  'mp3', 'm4a', 'mp4', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wave',
  'flac', 'webm', 'wma', 'amr', 'aif', 'aiff', 'caf', '3gp', 'mka',
]);

/** True when the file looks like audio (MIME `audio/*` or a known extension). */
export function isAudioFile(mimeType: string | null | undefined, name: string): boolean {
  if (mimeType && mimeType.toLowerCase().startsWith('audio/')) return true;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTS.has(ext);
}

// ─── Small fetch helpers (inlined so we don't need @ffmpeg/util) ─────────────
async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new TranscodeError(`فشل تحميل ملفات المحرّك (${res.status}).`);
  return res.arrayBuffer();
}

/** Fetch a (possibly cross-origin) asset and expose it as a same-origin blob URL. */
async function toBlobURL(url: string, mime: string): Promise<string> {
  return URL.createObjectURL(new Blob([await fetchBuffer(url)], { type: mime }));
}

async function fetchFile(url: string): Promise<Uint8Array> {
  return new Uint8Array(await fetchBuffer(url));
}

// ─── Lazy, memoised loader (same-origin script injection + ffmpeg.load) ──────
let loadPromise: Promise<FFmpegInstance> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new TranscodeError('تعذّر تحميل محرّك التحويل.')));
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.addEventListener('load', () => {
      el.dataset.loaded = 'true';
      resolve();
    });
    el.addEventListener('error', () => reject(new TranscodeError('تعذّر تحميل محرّك التحويل.')));
    document.head.appendChild(el);
  });
}

async function loadFFmpeg(): Promise<FFmpegInstance> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await injectScript(CONTROLLER_URL);
    const g = (globalThis as { FFmpegWASM?: FFmpegGlobal }).FFmpegWASM;
    if (!g?.FFmpeg) throw new TranscodeError('تعذّر تحميل محرّك التحويل.');

    const ffmpeg = new g.FFmpeg();
    // No classWorkerURL: the controller spawns its worker from CONTROLLER_URL's
    // own (same-origin) directory, which the browser permits.
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    return ffmpeg;
  })().catch((err) => {
    // Let a failed load be retried on the next call rather than caching the failure.
    loadPromise = null;
    throw err instanceof TranscodeError
      ? err
      : new TranscodeError('تعذّر تجهيز محرّك ضغط الصوت. تحقّق من الاتصال بالإنترنت وحاول مجددًا.');
  });
  return loadPromise;
}

// One ffmpeg instance ⇒ one in-memory filesystem; serialise jobs so a re-pick
// mid-conversion can't clobber the previous run's files.
let queue: Promise<unknown> = Promise.resolve();

export type TranscodeOptions = { onProgress?: (ratio: number) => void };

/**
 * Convert a picked audio file to a compressed speech MP3. Resolves with an
 * object-URL'd Blob ready for the existing upload path; rejects with a
 * `TranscodeError` (Arabic message) on any failure — caller must NOT fall back
 * to uploading the original.
 */
export function transcodeToMp3(
  file: { uri: string; name: string },
  opts: TranscodeOptions = {},
): Promise<TranscodeResult> {
  const run = queue.then(() => runTranscode(file, opts));
  // Keep the chain alive regardless of this job's outcome.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runTranscode(
  file: { uri: string; name: string },
  { onProgress }: TranscodeOptions,
): Promise<TranscodeResult> {
  const ffmpeg = await loadFFmpeg();

  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'dat';
  const inName = `input.${ext}`;
  const outName = 'output.mp3';

  const onProg = (e: ProgressEvent) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, e.progress)));
  };
  ffmpeg.on('progress', onProg);

  try {
    await ffmpeg.writeFile(inName, await fetchFile(file.uri));
    const code = await ffmpeg.exec([
      '-i', inName,
      '-vn', // drop embedded cover art / video streams
      '-codec:a', 'libmp3lame',
      '-q:a', '9', // VBR, max compression
      '-ac', '1', // mono
      '-ar', '22050', // speech-sufficient sample rate
      outName,
    ]);
    if (code !== 0) throw new TranscodeError('فشل تحويل الملف الصوتي. تأكّد من أنه ملف صوت صالح.');

    const out = await ffmpeg.readFile(outName);
    const bytes = typeof out === 'string' ? new TextEncoder().encode(out) : out;
    if (!bytes.length) throw new TranscodeError('نتج عن التحويل ملف فارغ. حاول بملف آخر.');

    const blob = new Blob([bytes as BlobPart], { type: 'audio/mpeg' });
    const base = file.name.replace(/\.[^.]*$/, '') || 'audio';
    return {
      uri: URL.createObjectURL(blob),
      name: `${base}.mp3`,
      size: blob.size,
      mimeType: 'audio/mpeg',
      blob,
    };
  } catch (err) {
    if (err instanceof TranscodeError) throw err;
    throw new TranscodeError('حدث خطأ أثناء ضغط الملف الصوتي. حاول مرة أخرى.');
  } finally {
    ffmpeg.off('progress', onProg);
    // Best-effort FS cleanup so the next job starts clean.
    await ffmpeg.deleteFile(inName).catch(() => undefined);
    await ffmpeg.deleteFile(outName).catch(() => undefined);
  }
}
