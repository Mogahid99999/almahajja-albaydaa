// `lecture_raw` upload rules (V23 §5.3) — the ORIGINAL file an admin uploads
// for server-side compression. Shared by the `r2-upload-url` edge function and
// the jest tests (tests/functions/). Pure TypeScript, no Deno/npm imports.
//
// The original never reaches students: it lands under `incoming/`, the media
// worker transcodes it to the normal lecture key and then deletes it (on
// failure it is kept for a retry). So the allow-list here is wider than the
// playable `lecture` list — anything ffmpeg can pull an audio track out of —
// but the size is bounded and bound into the signature.

/** 2 GB — the largest original the admin may upload. */
export const RAW_MAX_BYTES = 2 * 1024 ** 3;

/** Presigned PUT lifetime: long enough for 2 GB on a slow link (~2.3 Mbit/s). */
export const RAW_URL_TTL_SECONDS = 2 * 60 * 60;

export const RAW_PREFIX = "incoming/";

/**
 * Content types accepted for an original. The playable lecture list, plus
 * `video/mp4` (the worker extracts the audio track) and the non-canonical
 * spellings some browsers/OSes report (`audio/x-m4a`, `audio/x-wav`, …), plus
 * the rarer formats the picker already accepts by extension (wma/amr/aiff/caf/
 * 3gp/mka — the old in-browser ffmpeg path converted those too).
 */
export const RAW_CONTENT_TYPES: readonly string[] = [
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav",
  "audio/webm", "audio/flac",
  "video/mp4",
  "audio/x-m4a", "audio/x-wav", "audio/mp3", "audio/x-flac",
  "audio/x-ms-wma", "audio/amr", "audio/aiff", "audio/x-aiff",
  "audio/x-caf", "audio/3gpp", "audio/x-matroska",
];

export type RawUploadInput = {
  fileName?: unknown;
  contentType?: unknown;
  size?: unknown;
};

export type RawUploadCheck =
  | { ok: true; ext: string; contentType: string; size: number }
  | { ok: false; error: string };

/** Lower-case extension, letters/digits only (≤ 8 chars); `bin` when unusable. */
export function rawExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "bin";
  const ext = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

/** Validate a `lecture_raw` request body (after the caller's role check). */
export function checkRawUpload(input: RawUploadInput): RawUploadCheck {
  const { fileName, contentType, size } = input;
  if (typeof fileName !== "string" || !fileName.trim() || typeof contentType !== "string" || !contentType) {
    return { ok: false, error: "fileName and contentType required" };
  }
  if (!RAW_CONTENT_TYPES.includes(contentType)) {
    return { ok: false, error: "content type not allowed for lecture_raw" };
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    return { ok: false, error: "size required" };
  }
  if (size > RAW_MAX_BYTES) return { ok: false, error: "file too large" };
  return { ok: true, ext: rawExtension(fileName), contentType, size };
}

/** `incoming/<uuid>.<ext>` — opaque, never derived from the admin's file name. */
export function rawIncomingKey(uuid: string, ext: string): string {
  return `${RAW_PREFIX}${uuid}.${ext}`;
}
