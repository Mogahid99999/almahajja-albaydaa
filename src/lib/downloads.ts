/**
 * Offline download file operations (expo-file-system). Lecture audio is saved
 * under <documents>/lectures/<id>.mp3 so the player can prefer a local file
 * over streaming (PRD §10). A small <id>.json sidecar caches the lecture's
 * metadata next to the audio, so the player and the downloads page can render
 * (and play) a downloaded lecture with no connection — the signed audio URL is
 * short-lived and the lecture row/title would otherwise need a network fetch.
 * Web has no persistent FS here — these no-op safely.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { LectureCard } from '@/api/types';

const isWeb = Platform.OS === 'web';

/** Cached lecture metadata persisted alongside the audio (offline playback). */
export type DownloadMeta = {
  id: string;
  title: string;
  sheikhName: string | null;
  durationSec: number;
  sectionTitle: string | null;
  /**
   * Last known resume position (seconds), mirrored from the player on each save
   * so a downloaded lecture resumes where it left off even with NO connection —
   * the server progress row is unreachable offline. Absent on older sidecars.
   */
  positionSec?: number;
};

function lecturesDir(): Directory {
  const dir = new Directory(Paths.document, 'lectures');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function audioFileFor(lectureId: string): File {
  return new File(lecturesDir(), `${lectureId}.mp3`);
}

function metaFileFor(lectureId: string): File {
  return new File(lecturesDir(), `${lectureId}.json`);
}

/** Local URI if the lecture audio is already downloaded, else null. */
export function localUriFor(lectureId: string): string | null {
  if (isWeb) return null;
  try {
    const f = audioFileFor(lectureId);
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

/** Download a lecture's audio + cache its metadata sidecar; returns the local URI. */
export async function downloadLecture(
  lectureId: string,
  url: string,
  meta: DownloadMeta,
): Promise<string> {
  if (isWeb) throw new Error('التحميل غير مدعوم على الويب');
  const dest = audioFileFor(lectureId);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(url, dest);
  saveDownloadMeta(meta);
  return file.uri;
}

/** Persist the metadata sidecar (best-effort — playback still works without it). */
function saveDownloadMeta(meta: DownloadMeta): void {
  if (isWeb) return;
  try {
    const f = metaFileFor(meta.id);
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(meta));
  } catch {
    /* metadata is best-effort */
  }
}

/**
 * Update ONLY the resume position on an already-downloaded lecture's sidecar
 * (no-op if it isn't downloaded / has no sidecar). Called on every progress save
 * so offline resume tracks online resume. Best-effort — never throws into the
 * playback save path.
 */
export function updateDownloadPosition(lectureId: string, positionSec: number): void {
  if (isWeb) return;
  try {
    const meta = readDownloadMeta(lectureId);
    if (!meta) return;
    saveDownloadMeta({ ...meta, positionSec: Math.max(0, Math.round(positionSec)) });
  } catch {
    /* metadata is best-effort */
  }
}

/** Read the cached metadata for a downloaded lecture, or null. */
export function readDownloadMeta(lectureId: string): DownloadMeta | null {
  if (isWeb) return null;
  try {
    const f = metaFileFor(lectureId);
    if (!f.exists) return null;
    return JSON.parse(f.textSync()) as DownloadMeta;
  } catch {
    return null;
  }
}

/** Delete a downloaded lecture's audio file and its metadata sidecar. */
export function deleteLecture(lectureId: string): void {
  if (isWeb) return;
  for (const f of [audioFileFor(lectureId), metaFileFor(lectureId)]) {
    try {
      if (f.exists) f.delete();
    } catch {
      /* ignored */
    }
  }
}

/** Ids of every lecture with a downloaded audio file on disk (for hydration). */
export function listDownloadedIds(): string[] {
  if (isWeb) return [];
  try {
    const dir = new Directory(Paths.document, 'lectures');
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((e): e is File => e instanceof File && e.name.endsWith('.mp3'))
      .map((f) => f.name.replace(/\.mp3$/, ''));
  } catch {
    return [];
  }
}

/**
 * LectureCards for every downloaded lecture, built from cached sidecars so the
 * downloads page works with no connection. A file missing its sidecar (e.g.
 * downloaded before sidecars existed) still shows with a fallback title.
 */
export function getDownloadedCards(): LectureCard[] {
  return listDownloadedIds().map((id) => {
    const m = readDownloadMeta(id);
    return {
      id,
      title: m?.title ?? 'محاضرة محمّلة',
      sheikhName: m?.sheikhName ?? null,
      durationSec: m?.durationSec ?? 0,
      coverLetter: m?.sectionTitle?.[0] ?? '◆',
    };
  });
}
