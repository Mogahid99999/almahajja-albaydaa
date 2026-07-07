/**
 * All Cloudflare R2 object access (upload / read / delete) — the single place
 * that talks to the r2-* Edge Functions, so admin.ts/attachments.ts/lectures.ts
 * stay thin. R2 credentials never reach the client; every call here trades the
 * caller's Supabase session for a short-lived, presigned R2 URL. Mirrors the
 * old supabase.storage.from(bucket) calls this replaces.
 */
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type StorageKind = 'lecture' | 'attachment';

/** A picked file (lecture audio or attachment) ready to upload. */
export type PickedFile = {
  uri: string;
  name: string;
  mimeType?: string | null;
};

async function invokeR2<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // FunctionsHttpError carries the non-2xx Response in `context`; surface the
    // function's `{ error }` message rather than the generic status text.
    let msg = error.message;
    try {
      const j = await (error as any).context?.json?.();
      if (j?.error) msg = j.error;
    } catch {
      // keep the generic message
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

/** Map a file extension → audio content-type (so ogg/wav land correctly). */
const AUDIO_CONTENT_TYPE: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  flac: 'audio/flac',
};

function resolveContentType(kind: StorageKind, file: PickedFile): string {
  if (kind === 'attachment') return file.mimeType ?? 'application/octet-stream';
  // Prefer a known type for the extension; the picker's mimeType is sometimes
  // generic (application/octet-stream) which would break in-browser playback.
  const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
  return (
    AUDIO_CONTENT_TYPE[ext] ??
    (file.mimeType && file.mimeType.startsWith('audio/') ? file.mimeType : 'audio/mpeg')
  );
}

/**
 * Upload a picked file (lecture audio or attachment) to R2 and return its
 * object key — what `lectures.audio_path` / `attachments.storage_path` store.
 * Mints a presigned PUT via r2-upload-url, then streams the bytes straight to
 * R2; the R2 secret key never reaches the client.
 */
export async function uploadToR2(kind: StorageKind, file: PickedFile): Promise<string> {
  const contentType = resolveContentType(kind, file);
  const { uploadUrl, key } = await invokeR2<{ uploadUrl: string; key: string }>(
    'r2-upload-url',
    { kind, fileName: file.name, contentType },
  );

  if (Platform.OS === 'web') {
    // Web is a blob: uri from the picker; buffering it is fine (already in memory).
    const bytes = await fetch(file.uri).then((r) => r.arrayBuffer());
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: bytes,
      headers: { 'Content-Type': contentType },
    });
    if (!res.ok) throw new Error(`تعذّر رفع الملف (${res.status}).`);
    return key;
  }

  // Native: STREAM the file straight to R2 from disk rather than
  // fetch(uri).arrayBuffer() (which buffers a whole long lecture in memory and
  // can OOM). No auth header needed — the signature is embedded in the URL.
  const { uploadAsync, FileSystemUploadType } = require('expo-file-system/legacy');
  const res = await uploadAsync(uploadUrl, file.uri, {
    httpMethod: 'PUT',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': contentType },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`تعذّر رفع الملف (${res.status}).`);
  }
  return key;
}

/**
 * Resolve an object key → a short-lived (60 min) signed GET URL, gated by
 * `can_read_storage_object` (draft/published rules, migration 0063). Returns
 * null if the key is missing or the read is denied — callers treat this the
 * same as a failed signed-URL mint did before.
 */
export async function getReadUrl(key: string): Promise<string | null> {
  try {
    const { url } = await invokeR2<{ url: string }>('r2-read-url', { key });
    return url ?? null;
  } catch {
    return null;
  }
}

/** Best-effort delete of an R2 object (mirrors the old storage.remove([path])). */
export async function deleteFromR2(key: string): Promise<void> {
  try {
    await invokeR2('r2-delete', { key });
  } catch {
    // best-effort — the owning DB row is already gone by the time this runs
  }
}
