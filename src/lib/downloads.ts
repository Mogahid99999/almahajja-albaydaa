/**
 * Offline download file organization (expo-file-system).
 *
 * Android: audio is saved into a folder the user picks once (via the native
 * Storage Access Framework directory picker), under
 * <picked>/<APP_FOLDER>/<section>/<lesson>.mp3 — visible in My Files /
 * Downloads, not deleted on uninstall, and manageable by the user outside the
 * app. Android's scoped storage forbids writing to public storage without
 * this per-tree grant, so there's no way to make it visible without a picker.
 *
 * iOS/web: no SAF equivalent, so downloads stay in the app's private
 * <Documents>/<APP_FOLDER>/<section>/<lesson>.mp3 (web has no persistent FS
 * here — these no-op safely).
 *
 * A single manifest file, always in the app's PRIVATE Documents dir
 * (<APP_FOLDER>/.manifest.json — never the public SAF tree, since it's
 * app bookkeeping, not something the user needs to see), maps lecture id →
 * relative path + cached metadata (+ the SAF content:// URI on Android), so
 * id-based lookups stay O(1) without walking folders or re-parsing SAF URIs.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { getInfoAsync, StorageAccessFramework } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import type { LectureCard } from '@/api/types';
import { usePublicStorageStore } from '@/stores/publicStorageStore';

const isWeb = Platform.OS === 'web';
const isAndroid = Platform.OS === 'android';

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

type ManifestEntry = DownloadMeta & {
  relativePath: string;
  /** Android only: the SAF content:// URI of the audio file in public storage. */
  safUri?: string;
};
type Manifest = Record<string, ManifestEntry>;

/** Fired as the transfer streams in — `totalBytes` is -1 when the server omitted Content-Length. */
export type DownloadProgressCallback = (data: { bytesWritten: number; totalBytes: number }) => void;

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
    // Android SAF entries are content:// URIs — trust the manifest here (it's
    // kept accurate by verifyDownloads() at hydration) rather than doing a
    // live existence check, since that's async and this is a hot sync path
    // (playback load, list rendering).
    if (entry.safUri) return entry.safUri;
    const f = fileFor(entry.relativePath);
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

/**
 * Ensures the user has granted access to a public folder, requesting it via
 * the native SAF directory picker if needed. Re-prompts if a previously
 * granted tree was revoked (e.g. the user removed access in Android
 * settings). Resets cached app/section folder URIs on any new grant, since
 * they belonged to the old tree.
 */
async function ensurePublicRoot(): Promise<string> {
  const store = usePublicStorageStore.getState();
  if (store.rootUri) {
    try {
      await StorageAccessFramework.readDirectoryAsync(store.rootUri);
      return store.rootUri;
    } catch {
      /* revoked or moved — fall through to re-request */
    }
  }
  const initial = StorageAccessFramework.getUriForDirectoryInRoot('Download');
  const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync(initial);
  if (!perm.granted) throw new Error('لم يتم منح إذن الوصول إلى مجلد التخزين');
  store.reset();
  store.setRootUri(perm.directoryUri);
  return perm.directoryUri;
}

/** Ensures <root>/<APP_FOLDER> exists, creating it if needed; returns its SAF URI. */
async function ensurePublicAppFolder(rootUri: string): Promise<string> {
  const store = usePublicStorageStore.getState();
  if (store.appFolderUri) {
    try {
      await StorageAccessFramework.readDirectoryAsync(store.appFolderUri);
      return store.appFolderUri;
    } catch {
      /* deleted/moved externally — recreate below */
    }
  }
  const uri = await StorageAccessFramework.makeDirectoryAsync(rootUri, APP_FOLDER);
  usePublicStorageStore.setState({ appFolderUri: uri, sectionDirs: {} });
  return uri;
}

/** Ensures <appFolder>/<section> exists, creating it if needed; returns its SAF URI. */
async function ensurePublicSectionDir(appFolderUri: string, section: string): Promise<string> {
  const store = usePublicStorageStore.getState();
  const cached = store.sectionDirs[section];
  if (cached) {
    try {
      await StorageAccessFramework.readDirectoryAsync(cached);
      return cached;
    } catch {
      /* deleted/moved externally — recreate below */
    }
  }
  const uri = await StorageAccessFramework.makeDirectoryAsync(appFolderUri, section);
  store.setSectionDir(section, uri);
  return uri;
}

/** Download a lecture's audio into the public <section>/<lesson>.mp3 (Android) via SAF. */
async function downloadLecturePublic(
  lectureId: string,
  url: string,
  meta: DownloadMeta,
  onProgress?: DownloadProgressCallback,
): Promise<string> {
  const manifest = readManifest();
  const prior = manifest[lectureId];
  if (prior?.safUri) {
    try {
      await StorageAccessFramework.deleteAsync(prior.safUri);
    } catch {
      /* ignore — old file may already be gone */
    }
    delete manifest[lectureId];
  }

  const relativePath = relativePathFor(meta, manifest);
  const [section, baseWithExt] = [
    relativePath.slice(0, relativePath.lastIndexOf('/')),
    relativePath.slice(relativePath.lastIndexOf('/') + 1),
  ];
  const base = baseWithExt.replace(/\.mp3$/, '');

  const rootUri = await ensurePublicRoot();
  const appFolderUri = await ensurePublicAppFolder(rootUri);
  const sectionDirUri = await ensurePublicSectionDir(appFolderUri, section);

  // SAF has no direct URL-download API — pull the audio into a private temp
  // file first, then copy its bytes into the SAF-created public file.
  const tempFile = new File(Paths.cache, `${lectureId}-${Date.now()}.tmp`);
  if (tempFile.exists) tempFile.delete();
  await File.downloadFileAsync(url, tempFile, { onProgress });
  try {
    const safUri = await StorageAccessFramework.createFileAsync(sectionDirUri, base, 'audio/mpeg');
    const base64 = await tempFile.base64();
    await StorageAccessFramework.writeAsStringAsync(safUri, base64, { encoding: 'base64' });
    manifest[lectureId] = { ...meta, relativePath, safUri };
    writeManifest(manifest);
    return safUri;
  } finally {
    try {
      tempFile.delete();
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** Download a lecture's audio into <section>/<lesson>.mp3 + update the manifest; returns the local URI. */
export async function downloadLecture(
  lectureId: string,
  url: string,
  meta: DownloadMeta,
  onProgress?: DownloadProgressCallback,
): Promise<string> {
  if (isWeb) throw new Error('التحميل غير مدعوم على الويب');
  if (isAndroid) return downloadLecturePublic(lectureId, url, meta, onProgress);

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
  const file = await File.downloadFileAsync(url, dest, { onProgress });
  manifest[lectureId] = { ...meta, relativePath };
  writeManifest(manifest);
  return file.uri;
}

/**
 * Re-syncs the manifest with what's actually on disk/in public storage.
 * Public (Android) files are user-visible and can be renamed, moved, or
 * deleted outside the app — call this once at app startup (before trusting
 * localUriFor's manifest-only fast path) so stale entries don't linger as
 * "downloaded" when the file is gone. No-op on iOS/web.
 */
export async function verifyDownloads(): Promise<void> {
  if (!isAndroid) return;
  try {
    const manifest = readManifest();
    let changed = false;
    for (const [id, entry] of Object.entries(manifest)) {
      if (!entry.safUri) continue;
      try {
        const info = await getInfoAsync(entry.safUri);
        if (!info.exists) {
          delete manifest[id];
          changed = true;
        }
      } catch {
        delete manifest[id];
        changed = true;
      }
    }
    if (changed) writeManifest(manifest);
  } catch {
    /* best-effort */
  }
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
  const { relativePath: _relativePath, safUri: _safUri, ...meta } = entry;
  return meta;
}

/** Delete a downloaded lecture's audio file and its manifest entry. */
export async function deleteLecture(lectureId: string): Promise<void> {
  if (isWeb) return;
  try {
    const manifest = readManifest();
    const entry = manifest[lectureId];
    if (!entry) return;
    if (entry.safUri) {
      try {
        await StorageAccessFramework.deleteAsync(entry.safUri);
      } catch {
        /* file may already be gone (deleted externally) */
      }
    } else {
      const f = fileFor(entry.relativePath);
      if (f.exists) f.delete();
    }
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
    sectionTitle: m.sectionTitle ?? null,
  }));
}

if (!isWeb) migrateLegacyDownloads();
