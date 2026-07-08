/**
 * Offline download file organization (expo-file-system). Lecture audio is
 * saved under <Documents>/<APP_FOLDER>/<section>/<lesson>.mp3 — a
 * human-readable layout a user can browse in any file manager, organized the
 * same way the app organizes content (section, then lesson). A single
 * manifest file (<APP_FOLDER>/.manifest.json) maps lecture id → relative path
 * + cached metadata, so id-based lookups stay O(1) without walking the
 * nested folders on every call. Web has no persistent FS here — these
 * no-op safely.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { LectureCard } from '@/api/types';

const isWeb = Platform.OS === 'web';

/** Matches app.json's plain (no-diacritics) display name — safe across file managers. */
const APP_FOLDER = 'المحجة البيضاء';
const MANIFEST_NAME = '.manifest.json';
const FALLBACK_SECTION = 'دروس عامة';

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

type ManifestEntry = DownloadMeta & { relativePath: string };
type Manifest = Record<string, ManifestEntry>;

function appDir(): Directory {
  const dir = new Directory(Paths.document, APP_FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function manifestFile(): File {
  return new File(appDir(), MANIFEST_NAME);
}

function readManifest(): Manifest {
  try {
    const f = manifestFile();
    if (!f.exists) return {};
    return JSON.parse(f.textSync()) as Manifest;
  } catch {
    return {};
  }
}

function writeManifest(m: Manifest): void {
  try {
    const f = manifestFile();
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(m));
  } catch {
    /* best-effort */
  }
}

/** Filesystem-safe path segment: strips characters illegal on Android/iOS/Windows. */
function sanitizeSegment(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 80);
  return cleaned || fallback;
}

/** A unique `<section>/<lesson>.mp3` path for this lecture, avoiding collisions with other downloaded lectures. */
function relativePathFor(meta: DownloadMeta, manifest: Manifest): string {
  const section = sanitizeSegment(meta.sectionTitle ?? FALLBACK_SECTION, FALLBACK_SECTION);
  const base = sanitizeSegment(meta.title, meta.id);
  const taken = new Set(Object.values(manifest).map((e) => e.relativePath));
  let candidate = `${section}/${base}.mp3`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${section}/${base} (${n}).mp3`;
    n++;
  }
  return candidate;
}

/** Resolve a manifest-relative path (`<section>/<lesson>.mp3`) to a File, creating intermediate folders as needed. */
function fileFor(relativePath: string): File {
  const parts = relativePath.split('/');
  const name = parts.pop()!;
  let dir = appDir();
  for (const p of parts) {
    dir = new Directory(dir, p);
    if (!dir.exists) dir.create({ intermediates: true });
  }
  return new File(dir, name);
}

/**
 * One-time migration from the old flat layout (<Documents>/lectures/<id>.mp3
 * + <id>.json sidecar) into the new section/lesson-named layout. Best-effort:
 * a lecture that fails to move is simply left for a future attempt rather
 * than blocking the rest. Runs once per process (see the call at the bottom
 * of this file).
 */
function migrateLegacyDownloads(): void {
  try {
    const legacyDir = new Directory(Paths.document, 'lectures');
    if (!legacyDir.exists) return;
    const manifest = readManifest();
    let changed = false;

    for (const entry of legacyDir.list()) {
      if (!(entry instanceof File) || !entry.name.endsWith('.mp3')) continue;
      const id = entry.name.replace(/\.mp3$/, '');
      if (manifest[id]) continue; // already downloaded under the new scheme

      const sidecar = new File(legacyDir, `${id}.json`);
      let meta: DownloadMeta = {
        id,
        title: 'محاضرة محمّلة',
        sheikhName: null,
        durationSec: 0,
        sectionTitle: null,
      };
      if (sidecar.exists) {
        try {
          meta = { ...meta, ...(JSON.parse(sidecar.textSync()) as Partial<DownloadMeta>), id };
        } catch {
          /* keep the fallback */
        }
      }

      const relativePath = relativePathFor(meta, manifest);
      try {
        entry.moveSync(fileFor(relativePath));
        manifest[id] = { ...meta, relativePath };
        changed = true;
      } catch {
        continue; // leave it for next launch
      }
      if (sidecar.exists) {
        try {
          sidecar.delete();
        } catch {
          /* ignore */
        }
      }
    }

    if (changed) writeManifest(manifest);
    try {
      if (legacyDir.list().length === 0) legacyDir.delete();
    } catch {
      /* ignore */
    }
  } catch {
    /* best-effort migration — never block the app */
  }
}

/** Local URI if the lecture audio is already downloaded, else null. */
export function localUriFor(lectureId: string): string | null {
  if (isWeb) return null;
  try {
    const entry = readManifest()[lectureId];
    if (!entry) return null;
    const f = fileFor(entry.relativePath);
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

/** Download a lecture's audio into <section>/<lesson>.mp3 + update the manifest; returns the local URI. */
export async function downloadLecture(
  lectureId: string,
  url: string,
  meta: DownloadMeta,
): Promise<string> {
  if (isWeb) throw new Error('التحميل غير مدعوم على الويب');
  const manifest = readManifest();
  const prior = manifest[lectureId];
  if (prior) {
    // Re-downloading, or the lesson/section name changed since the first
    // download — drop the old file so it doesn't linger under a stale name.
    try {
      const oldFile = fileFor(prior.relativePath);
      if (oldFile.exists) oldFile.delete();
    } catch {
      /* ignore */
    }
    delete manifest[lectureId];
  }

  const relativePath = relativePathFor(meta, manifest);
  const dest = fileFor(relativePath);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(url, dest);
  manifest[lectureId] = { ...meta, relativePath };
  writeManifest(manifest);
  return file.uri;
}

/**
 * Update ONLY the resume position on an already-downloaded lecture's manifest
 * entry (no-op if it isn't downloaded). Called on every progress save so
 * offline resume tracks online resume. Best-effort — never throws into the
 * playback save path.
 */
export function updateDownloadPosition(lectureId: string, positionSec: number): void {
  if (isWeb) return;
  try {
    const manifest = readManifest();
    const entry = manifest[lectureId];
    if (!entry) return;
    entry.positionSec = Math.max(0, Math.round(positionSec));
    writeManifest(manifest);
  } catch {
    /* metadata is best-effort */
  }
}

/** Read the cached metadata for a downloaded lecture, or null. */
export function readDownloadMeta(lectureId: string): DownloadMeta | null {
  if (isWeb) return null;
  const entry = readManifest()[lectureId];
  if (!entry) return null;
  const { relativePath: _relativePath, ...meta } = entry;
  return meta;
}

/** Delete a downloaded lecture's audio file and its manifest entry. */
export function deleteLecture(lectureId: string): void {
  if (isWeb) return;
  try {
    const manifest = readManifest();
    const entry = manifest[lectureId];
    if (!entry) return;
    const f = fileFor(entry.relativePath);
    if (f.exists) f.delete();
    delete manifest[lectureId];
    writeManifest(manifest);
  } catch {
    /* ignored */
  }
}

/** Ids of every lecture with a downloaded audio file on disk (for hydration). */
export function listDownloadedIds(): string[] {
  if (isWeb) return [];
  return Object.keys(readManifest());
}

/**
 * LectureCards for every downloaded lecture, built from the manifest so the
 * downloads page works with no connection.
 */
export function getDownloadedCards(): LectureCard[] {
  if (isWeb) return [];
  const manifest = readManifest();
  return Object.entries(manifest).map(([id, m]) => ({
    id,
    title: m.title,
    sheikhName: m.sheikhName,
    durationSec: m.durationSec,
    coverLetter: m.sectionTitle?.[0] ?? '◆',
  }));
}

if (!isWeb) migrateLegacyDownloads();
