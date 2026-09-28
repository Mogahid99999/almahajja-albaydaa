/**
 * Server-side lecture compression (V23 §5.3 / §6.1) — the web admin uploads the
 * ORIGINAL file, the VPS media worker transcodes it to the speech MP3 and fills
 * the lecture's audio_path/duration_sec/audio_size_bytes.
 *
 *  1. `uploadRawLecture` — r2-upload-url kind `lecture_raw` (opaque
 *     `incoming/<uuid>.<ext>` key, ≤ 2 GB, size bound into the signature), then
 *     an XMLHttpRequest PUT of the File/Blob itself so the browser streams it
 *     and reports upload progress (no `arrayBuffer()` buffering of a 2 GB file).
 *  2. `createServerTranscodeLecture` — the existing createLecture path with no
 *     audio (a draft/«واردة» row, audio_path null), then
 *     `enqueue_lecture_transcode(lecture, key, publish_on_done)` → the job id.
 *     A «نشر» choice is carried by `p_publish_on_done`: the SERVER publishes the
 *     lecture when the worker completes the job (complete_lecture_transcode,
 *     the normal publish path, notify_on_publish respected) — the admin may
 *     close the tab.
 *  3. `getMediaJob` — polled by useMediaJob for status/progress.
 *
 * Gated by app_config `server_transcode` ('true' | 'false', default false);
 * while it is off the in-browser ffmpeg.wasm path (src/lib/audioTranscode*)
 * stays in use unchanged.
 */
import { USE_MOCK } from '@/config';
import type { AppLectureStatus } from '@/config';
import { supabase } from '@/lib/supabase';
import { createLecture, deleteLecture } from './admin';
import { deleteFromR2, invokeR2 } from './storage';

export type MediaJobStatus = 'queued' | 'running' | 'done' | 'failed';

export type MediaJob = {
  id: string;
  status: MediaJobStatus;
  /** 0..1, written by the worker. */
  progress: number;
  error: string | null;
  lectureId: string | null;
};

/** 2 GB — mirrors RAW_MAX_BYTES in supabase/functions/_shared/rawUpload.ts. */
export const RAW_MAX_BYTES = 2 * 1024 ** 3;

const SERVER_TRANSCODE_KEY = 'server_transcode';

/**
 * Is server-side compression switched on? Any read failure falls back to
 * `false` — the in-browser path still works, so a flaky read never blocks an
 * upload (same "never look broken" convention as the other app_config reads).
 */
export async function isServerTranscodeEnabled(): Promise<boolean> {
  if (USE_MOCK) return false;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', SERVER_TRANSCODE_KEY)
      .maybeSingle();
    if (error) return false;
    return (data?.value ?? '').trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/**
 * Extension → content type for an original. Every value must be in
 * RAW_CONTENT_TYPES (supabase/functions/_shared/rawUpload.ts) — pinned by
 * tests/functions/rawUpload.test.ts. The picker's own mimeType is unreliable
 * (often empty or application/octet-stream for opus/amr/wma on Windows), so the
 * extension wins; only a real `video/mp4` is kept as such.
 */
export const RAW_CONTENT_TYPE_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  wave: 'audio/wav',
  flac: 'audio/flac',
  webm: 'audio/webm',
  wma: 'audio/x-ms-wma',
  amr: 'audio/amr',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  '3gp': 'audio/3gpp',
  mka: 'audio/x-matroska',
};

export function rawContentType(name: string, mimeType?: string | null): string {
  if (mimeType === 'video/mp4') return 'video/mp4';
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return (
    RAW_CONTENT_TYPE_BY_EXT[ext] ??
    (mimeType && mimeType.startsWith('audio/') ? mimeType : 'application/octet-stream')
  );
}

/** An upload the caller cancelled (re-pick / remove) — not an error to show. */
export class RawUploadAbortedError extends Error {
  constructor() {
    super('upload aborted');
    this.name = 'RawUploadAbortedError';
  }
}

/** Arabic, admin-facing message for a failed original upload. */
export class RawUploadError extends Error {}

const TOO_LARGE = 'حجم الملف أكبر من ٢ غيغابايت. اختر ملفًا أصغر.';

function rawUploadErrorText(serverMessage: string): string {
  if (serverMessage === 'file too large') return TOO_LARGE;
  if (serverMessage === 'forbidden') return 'لا تملك صلاحية رفع المحاضرات.';
  if (serverMessage.startsWith('content type not allowed')) {
    return 'صيغة الملف غير مدعومة. اختر ملفًا صوتيًا أو فيديو MP4.';
  }
  return 'تعذّر تجهيز رفع الملف. تحقّق من الاتصال وأعد المحاولة.';
}

/**
 * PUT a Blob/File to a presigned URL with upload progress. XMLHttpRequest (not
 * fetch) because only XHR exposes `upload.onprogress`; the browser streams the
 * File from disk and sets Content-Length itself (which the signature binds).
 */
export function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RawUploadAbortedError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new RawUploadError(`تعذّر رفع الملف الأصلي (${xhr.status}). أعد المحاولة.`));
      }
    };
    xhr.onerror = () =>
      reject(new RawUploadError('انقطع الاتصال أثناء رفع الملف. تحقّق من الشبكة وأعد المحاولة.'));
    xhr.onabort = () => reject(new RawUploadAbortedError());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** Upload the admin's original file to `incoming/`; resolves with its R2 key. */
export async function uploadRawLecture(input: {
  /** The picked File (web picker `asset.file`); falls back to reading `uri`. */
  file?: Blob | null;
  uri: string;
  name: string;
  mimeType?: string | null;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}): Promise<{ key: string }> {
  // A blob: URL from the web picker resolves to the same file-backed Blob — no copy.
  let file: Blob;
  if (input.file) {
    file = input.file;
  } else {
    const res = await fetch(input.uri);
    file = (await res.blob()) as Blob;
  }
  const size = file.size;
  if (size > RAW_MAX_BYTES) throw new RawUploadError(TOO_LARGE);
  const contentType = rawContentType(input.name, input.mimeType || file.type);
  let signed: { uploadUrl: string; key: string };
  try {
    signed = await invokeR2<{ uploadUrl: string; key: string }>('r2-upload-url', {
      kind: 'lecture_raw',
      fileName: input.name,
      contentType,
      size,
    });
  } catch (e) {
    throw new RawUploadError(rawUploadErrorText(e instanceof Error ? e.message : ''));
  }
  if (input.signal?.aborted) throw new RawUploadAbortedError();
  await putWithProgress(signed.uploadUrl, file, contentType, input.onProgress, input.signal);
  return { key: signed.key };
}

/**
 * Best-effort removal of an original that was uploaded but never submitted
 * (the admin removed/re-picked the file). Never throws.
 */
export async function discardRawUpload(key: string): Promise<void> {
  if (!key.startsWith('incoming/')) return;
  await deleteFromR2(key);
}

/**
 * Queue the worker job for an uploaded original → the media_jobs id.
 * `publishOnDone`: publish the lecture on the server once its audio is ready.
 * Re-enqueueing the same key after a `failed` job is allowed (retry).
 */
export async function enqueueLectureTranscode(
  lectureId: string,
  inputKey: string,
  publishOnDone = false,
): Promise<string> {
  const { data, error } = await supabase.rpc('enqueue_lecture_transcode', {
    p_lecture: lectureId,
    p_input_key: inputKey,
    p_publish_on_done: publishOnDone,
  });
  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('enqueue_lecture_transcode returned no job id');
  return data;
}

export type ServerTranscodeLectureInput = {
  title: string;
  sectionId: string | null;
  sheikhId: string | null;
  order: number;
  durationSec?: number | null;
  notifyOnPublish?: boolean;
  /** The admin chose «نشر» — honoured only with a section (else «الواردة»). */
  publish?: boolean;
  /** The `incoming/…` key returned by uploadRawLecture. */
  inputKey: string;
};

/**
 * Create the lecture row WITHOUT audio (audio_path null — the worker fills it)
 * and queue its compression. The row is always a draft (or «واردة» without a
 * section): a lecture is never published before its audio exists (the 0132
 * publish guard enforces that too). A «نشر» choice becomes
 * `p_publish_on_done` → the server publishes it when the job completes.
 * If queueing fails the half-made draft is removed, so a retry of the whole
 * submit never leaves an orphan row with no audio and no job.
 */
export async function createServerTranscodeLecture(
  input: ServerTranscodeLectureInput,
): Promise<{ lectureId: string; jobId: string; publishOnDone: boolean }> {
  const status: AppLectureStatus = input.sectionId ? 'draft' : 'unclassified';
  const publishOnDone = !!input.sectionId && input.publish === true;
  const { id } = await createLecture({
    title: input.title,
    sectionId: input.sectionId,
    sheikhId: input.sheikhId,
    order: input.order,
    durationSec: input.durationSec ?? null,
    status,
    notifyOnPublish: input.notifyOnPublish ?? true,
    audioFile: null,
  });
  try {
    const jobId = await enqueueLectureTranscode(id, input.inputKey, publishOnDone);
    return { lectureId: id, jobId, publishOnDone };
  } catch (e) {
    await deleteLecture(id).catch(() => undefined);
    throw e;
  }
}

/** One media job (content managers can SELECT; RLS hides everyone else's). */
export async function getMediaJob(id: string): Promise<MediaJob | null> {
  const { data: row, error } = await supabase
    .from('media_jobs')
    .select('id, status, progress, error, lecture_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const progress = Number(row.progress ?? 0);
  return {
    id: row.id,
    status: row.status,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0,
    error: row.error ?? null,
    lectureId: row.lecture_id ?? null,
  };
}
