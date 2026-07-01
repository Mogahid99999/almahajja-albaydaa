/**
 * Native audio transcoder stub (default platform file; web overrides via
 * `.web.ts`).
 *
 * Audio compression runs entirely in the browser (ffmpeg.wasm) and the admin
 * upload form is web-only, so this path is never reached on iOS/Android. It
 * exists only so the import resolves on native WITHOUT pulling ffmpeg.wasm or
 * the CDN loader into the native bundle. Calling `transcodeToMp3` here is a
 * programming error and throws.
 */

export type TranscodeResult = {
  uri: string;
  name: string;
  size: number;
  mimeType: 'audio/mpeg';
  blob: Blob;
};

export type TranscodeOptions = { onProgress?: (ratio: number) => void };

export class TranscodeError extends Error {}

/** Same validation as web — usable anywhere, no native modules touched. */
const AUDIO_EXTS = new Set([
  'mp3', 'm4a', 'mp4', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wave',
  'flac', 'webm', 'wma', 'amr', 'aif', 'aiff', 'caf', '3gp', 'mka',
]);

export function isAudioFile(mimeType: string | null | undefined, name: string): boolean {
  if (mimeType && mimeType.toLowerCase().startsWith('audio/')) return true;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTS.has(ext);
}

// Signature MUST match audioTranscode.web.ts — `tsc` type-checks against this
// (default) file while Metro swaps in `.web.ts` for the web bundle.
export function transcodeToMp3(
  _file: { uri: string; name: string },
  _opts?: TranscodeOptions,
): Promise<TranscodeResult> {
  return Promise.reject(
    new TranscodeError('ضغط الصوت متاح في لوحة الإدارة على الويب فقط.'),
  );
}
