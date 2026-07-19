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
import type { RestorableLecture } from '@/api/progress';
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
  /**
   * Section context captured at download time (audit F-502) so the player can
   * resolve next/prev — and auto-advance — through a downloaded series with NO
   * connection (see findDownloadedNeighbor). Absent on older sidecars, which
   * degrade to the old no-neighbours-offline behavior.
   */
  sectionId?: string | null;
  order?: number;
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

// In-memory manifest mirror (audit F-506). The manifest is written ONLY through
// writeManifest below, so caching the parsed object is safe — and it matters:
// readManifest is on hot per-row paths (localUriFor + verifyDownload +
// readDownloadMeta each parse it on every lecture-row mount, and
// updateDownloadPosition re-parses on every 5s playback tick), so a long
// section used to re-read + JSON.parse the same file thousands of times per
// scroll, all synchronously on the JS thread.
let manifestCache: Manifest | null = null;

function readManifest(): Manifest {
  if (manifestCache) return manifestCache;
  try {
    const f = manifestFile();
    if (!f.exists) return (manifestCache = {});
    return (manifestCache = JSON.parse(f.textSync()) as Manifest);
  } catch {
    // Transient read/parse failure — don't cache it; the next read retries disk.
    return {};
  }
}

function writeManifest(m: Manifest): void {
  manifestCache = m;
  try {
    const f = manifestFile();
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(m));
  } catch {
    /* best-effort — the in-memory mirror still drives this session */
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
    // Android SAF entries are content:// URIs — trust the manifest here (kept
    // accurate by verifyDownload/verifyDownloads, which prune an entry the moment
    // its file is confirmed gone) rather than doing a live existence check, since
    // that's async and this is a hot sync path (playback load, list rendering).
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

/**
 * Ensures the app folder «المحجة البيضاء» exists under the granted root and
 * returns its SAF URI. Three cases:
 *  1. The granted ROOT itself IS «المحجة البيضاء» (the user picked that folder in
 *     the picker) → use it directly. Creating a child «المحجة البيضاء» here would
 *     nest a second identically-named folder inside the real one and split
 *     downloads across two — the bug this guard prevents.
 *  2. Root already CONTAINS a «المحجة البيضاء» child → reuse that child.
 *  3. Neither → create «المحجة البيضاء» under the root.
 * The name check is Arabic-normalized so orthographic variants still match.
 */
async function ensurePublicAppFolder(rootUri: string): Promise<string> {
  const store = usePublicStorageStore.getState();
  if (store.appFolderUri) {
    try {
      await StorageAccessFramework.readDirectoryAsync(store.appFolderUri);
      return store.appFolderUri;
    } catch {
      /* deleted/moved externally — re-resolve below */
    }
  }

  const target = normalizeArabic(APP_FOLDER);

  // Case 1: the user picked «المحجة البيضاء» itself as the root.
  if (normalizeArabic(safDisplayName(rootUri)) === target) {
    usePublicStorageStore.setState({ appFolderUri: rootUri, sectionDirs: {} });
    return rootUri;
  }

  // Case 2: an existing «المحجة البيضاء» child under the root — reuse it rather
  // than making a duplicate (SAF makeDirectoryAsync would create «... (1)»).
  try {
    for (const childUri of await StorageAccessFramework.readDirectoryAsync(rootUri)) {
      if (normalizeArabic(safDisplayName(childUri)) === target) {
        usePublicStorageStore.setState({ appFolderUri: childUri, sectionDirs: {} });
        return childUri;
      }
    }
  } catch {
    /* unreadable root — fall through to create */
  }

  // Case 3: create it fresh.
  const uri = await StorageAccessFramework.makeDirectoryAsync(rootUri, APP_FOLDER);
  usePublicStorageStore.setState({ appFolderUri: uri, sectionDirs: {} });
  return uri;
}

/** Ensures <appFolder>/<section> exists, reusing an existing folder of that name; returns its SAF URI. */
async function ensurePublicSectionDir(appFolderUri: string, section: string): Promise<string> {
  const store = usePublicStorageStore.getState();
  const cached = store.sectionDirs[section];
  if (cached) {
    try {
      await StorageAccessFramework.readDirectoryAsync(cached);
      return cached;
    } catch {
      /* deleted/moved externally — re-resolve below */
    }
  }
  // Reuse an existing section folder (e.g. one a restore just relinked into)
  // rather than letting SAF create a duplicate «<section> (1)» — so a download
  // after a restore lands in the SAME folder the user already has.
  const target = normalizeArabic(section);
  try {
    for (const childUri of await StorageAccessFramework.readDirectoryAsync(appFolderUri)) {
      if (normalizeArabic(safDisplayName(childUri)) === target) {
        store.setSectionDir(section, childUri);
        return childUri;
      }
    }
  } catch {
    /* unreadable app folder — fall through to create */
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

  const rootUri = await ensurePublicRoot();
  const appFolderUri = await ensurePublicAppFolder(rootUri);
  const sectionDirUri = await ensurePublicSectionDir(appFolderUri, section);

  // SAF has no direct URL-download API — pull the audio into a private temp
  // file first (named as the final <lesson>.mp3, in its own scratch folder so
  // parallel downloads can't collide), then MOVE it into the SAF folder.
  // `File.move` streams the bytes natively and deletes the source (audit
  // F-504 — the previous `base64()` + `writeAsStringAsync` round-trip
  // materialized the ENTIRE audio file as a base64 JS string, an OOM crash
  // risk for long lectures on low-memory devices). After the move, the File's
  // own `uri` is the created SAF document's real content:// URI.
  const tempDir = new Directory(Paths.cache, `dl-${lectureId}-${Date.now()}`);
  if (!tempDir.exists) tempDir.create({ intermediates: true });
  const tempFile = new File(tempDir, baseWithExt);
  try {
    await File.downloadFileAsync(url, tempFile, { onProgress });
    await tempFile.move(new Directory(sectionDirUri), { overwrite: true });
    const safUri = tempFile.uri;
    manifest[lectureId] = { ...meta, relativePath, safUri };
    writeManifest(manifest);
    return safUri;
  } finally {
    try {
      tempDir.delete();
    } catch {
      /* best-effort cleanup (already gone after a successful move) */
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
 * Does the audio file for a manifest entry ACTUALLY exist in its chosen storage
 * location right now? (V17.1) The download state must reflect the real presence
 * of the file: if the user deleted/moved it in a file manager, the lecture must
 * stop showing as "downloaded" and become downloadable again.
 *
 * SAF (Android public storage) can only be checked with the async `getInfoAsync`
 * on the content:// URI; a bare local file (iOS) is a sync `.exists`. To avoid a
 * FALSE "missing" at a cold start — when the SAF content provider is briefly
 * unavailable and `getInfoAsync` throws — a thrown check is retried a couple of
 * times with a short backoff. Only after those retries still can't confirm the
 * file is it treated as gone.
 */
async function entryFileExists(entry: ManifestEntry): Promise<boolean> {
  if (entry.safUri) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const info = await getInfoAsync(entry.safUri);
        return info.exists === true; // reachable provider gave a definitive answer
      } catch {
        // Provider not ready yet — wait briefly and retry before concluding.
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400));
      }
    }
    return false; // couldn't confirm after retries → treat as missing
  }
  try {
    return fileFor(entry.relativePath).exists;
  } catch {
    return false;
  }
}

/**
 * Re-syncs the manifest with what's actually on disk/in public storage, and
 * returns the ids whose file is gone (so the store can drop them). Public
 * (Android) files are user-visible and can be renamed, moved, or deleted outside
 * the app — call this at app startup and whenever a download control mounts, so
 * an entry whose file no longer exists stops showing as "downloaded" and becomes
 * downloadable again (V17.1). No-op on iOS/web returns [] (there the sidecar file
 * check happens inline in localUriFor).
 */
export async function verifyDownloads(): Promise<string[]> {
  if (isWeb) return [];
  const removed: string[] = [];
  try {
    const manifest = readManifest();
    for (const [id, entry] of Object.entries(manifest)) {
      const exists = await entryFileExists(entry);
      if (!exists) {
        delete manifest[id];
        removed.push(id);
      }
    }
    if (removed.length) writeManifest(manifest);
  } catch {
    /* best-effort */
  }
  return removed;
}

/**
 * Verify a SINGLE lecture's audio file actually exists in its chosen storage
 * location (V17.1). Returns true if present; if it's gone, prunes the manifest
 * entry and returns false — so its download control reopens. Used by each
 * download control on mount so a file the user deleted externally is caught even
 * without a full app restart. Returns false for a lecture not in the manifest.
 */
export async function verifyDownload(lectureId: string): Promise<boolean> {
  if (isWeb) return false;
  try {
    const manifest = readManifest();
    const entry = manifest[lectureId];
    if (!entry) return false;
    if (await entryFileExists(entry)) return true;
    delete manifest[lectureId];
    writeManifest(manifest);
    return false;
  } catch {
    return false;
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

/**
 * The downloaded neighbour of a lecture within its section (audit F-502):
 * the manifest entry in the SAME section with the closest higher (`next`) or
 * lower (`prev`) order. Offline, downloaded lectures are the only playable
 * ones, so this IS the correct next/prev resolution there — the player uses it
 * when the network resolution is unreachable or fails. Entries from older
 * sidecars without section context are skipped.
 */
export function findDownloadedNeighbor(
  sectionId: string,
  order: number,
  direction: 'next' | 'prev',
): { id: string } | null {
  if (isWeb) return null;
  try {
    let best: ManifestEntry | null = null;
    for (const entry of Object.values(readManifest())) {
      if (entry.sectionId !== sectionId || typeof entry.order !== 'number') continue;
      const o = entry.order;
      const isCandidate = direction === 'next' ? o > order : o < order;
      if (!isCandidate) continue;
      if (!best || (direction === 'next' ? o < best.order! : o > best.order!)) best = entry;
    }
    return best ? { id: best.id } : null;
  } catch {
    return null;
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

// ── Restore downloads after a reinstall (V19) ────────────────────────────────
//
// A reinstall wipes the app's PRIVATE storage — the id→file `.manifest.json`
// AND the SAF grant in AsyncStorage — but the audio files themselves live in the
// user's PUBLIC folder (Download/المحجة البيضاء/<section>/<lesson>.mp3) and
// survive. Without the manifest the app can't tell those files belong to any
// lecture, so everything shows as "not downloaded" again.
//
// Restore rebuilds the manifest: re-grant the public folder, walk it for .mp3
// files, and match each file's `<section>/<lesson>` name against the user's
// server lecture list (sanitized the SAME way the downloader named it) to
// recover the real lecture id. The .mp3 filename alone is lossy (sanitized
// title, no id), so the server list is the only reliable bridge back.

/** The display name a SAF child content:// URI ends with (URL-encoded tail after the last '/' or '%2F'). */
function safDisplayName(uri: string): string {
  // SAF document URIs encode the document id as the last path segment, e.g.
  // …/document/primary%3ADownload%2F...%2Flesson.mp3 — the human name is the
  // final component after the last (encoded or literal) slash.
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    decoded = uri;
  }
  const afterSlash = decoded.slice(decoded.lastIndexOf('/') + 1);
  return afterSlash;
}

/** True if a SAF child URI points at a folder we can descend (vs. a file). */
async function safIsDir(uri: string): Promise<boolean> {
  try {
    await StorageAccessFramework.readDirectoryAsync(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * A single `.mp3` found under the public app folder during a restore scan:
 * its SAF content:// URI plus the (case/space-normalized) `<section>/<lesson>`
 * key we match lectures against. `section` is the immediate parent folder name.
 */
export type ScannedAudio = { safUri: string; section: string; base: string };

/**
 * Fold cosmetic Arabic orthographic variants so a match isn't lost to them:
 * alef forms (أ إ آ ٱ → ا), alef-maqsura → yaa, taa-marbuta → haa, and the
 * tatweel/diacritics are stripped. The file on disk was named from an OLDER
 * copy of the title (e.g. «المجلس الاول») while the server may now return a
 * lightly-corrected form («المجلس الأول») — without this fold the reinstall
 * restore would silently miss those files. Whitespace is collapsed and case
 * folded too. Applied ONLY to matching, never to how files are named.
 */
function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, '') // harakat + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Normalise for matching: the collision suffix « (2)» and the .mp3 extension are dropped, then Arabic-folded. */
function matchKey(section: string, base: string): string {
  const stripped = base.replace(/\.mp3$/i, '').replace(/ \(\d+\)$/, '');
  return `${normalizeArabic(section)}///${normalizeArabic(stripped)}`;
}

/**
 * Recursively collect every `.mp3` under a granted SAF tree (bounded depth),
 * tagging each with its IMMEDIATE parent folder name as the `section` — which is
 * exactly how the downloader laid files out (<appFolder>/<section>/<lesson>.mp3).
 *
 * Recursing (rather than assuming a fixed <appFolder>/<section> shape) makes
 * restore robust to WHICH folder the user picks in the SAF re-grant: the app
 * root «المحجة البيضاء», its parent «المحجة», or even «Download» all resolve the
 * same lessons, since the lesson's parent folder is always its section. Depth is
 * capped so a user who picks a huge tree (e.g. all of Download) doesn't trigger
 * an unbounded walk. Best-effort — an unreadable subfolder is skipped.
 */
async function scanPublicAudio(rootUri: string, depth = 3): Promise<ScannedAudio[]> {
  const found: ScannedAudio[] = [];
  let childUris: string[] = [];
  try {
    childUris = await StorageAccessFramework.readDirectoryAsync(rootUri);
  } catch {
    return found;
  }
  const parent = safDisplayName(rootUri);
  for (const childUri of childUris) {
    const name = safDisplayName(childUri);
    if (name.toLowerCase().endsWith('.mp3')) {
      found.push({ safUri: childUri, section: parent, base: name });
      continue;
    }
    // A subfolder — descend while we still have depth budget.
    if (depth > 0 && (await safIsDir(childUri))) {
      found.push(...(await scanPublicAudio(childUri, depth - 1)));
    }
  }
  return found;
}

/** Outcome of a restore attempt, for a calm user-facing summary. */
export type RestoreResult = {
  /** Number of lectures newly relinked from public files. */
  restored: number;
  /** Matched files that were ALREADY downloaded (present + in the manifest) — nothing to do. */
  alreadyPresent: number;
  /** Audio files found in the folder that didn't match any of the user's lectures. */
  unmatched: number;
};

/** The files a restore scan found, plus the distinct section-folder names among them. */
export type PublicFolderScan = {
  files: ScannedAudio[];
  /** Distinct immediate-parent folder names (the sections) — used to fetch matching lectures. */
  sectionNames: string[];
};

/**
 * Re-grant the public folder and scan it for downloaded .mp3 files. Resolves the
 * app folder «المحجة البيضاء» WITHOUT creating a duplicate: if the user picked
 * that folder itself it's reused directly (no nested «.../المحجة البيضاء/المحجة
 * البيضاء»); if they picked its parent «المحجة» or «Download», the existing child
 * is reused. Future downloads then save back into this SAME folder. Scans the
 * granted ROOT recursively so lessons are found regardless of the pick level.
 * Android only. The returned `sectionNames` let the caller fetch EVERY lecture in
 * those sections (incl. ones never played, which have no progress row) so
 * matching isn't limited to the user's history.
 */
export async function scanPublicFolderForRestore(): Promise<PublicFolderScan> {
  if (!isAndroid) return { files: [], sectionNames: [] };
  const rootUri = await ensurePublicRoot();
  await ensurePublicAppFolder(rootUri);
  const files = await scanPublicAudio(rootUri);
  const sectionNames = [...new Set(files.map((f) => f.section))];
  return { files, sectionNames };
}

/**
 * Relink scanned .mp3 files to lecture ids, matching each file's sanitized
 * `<section>/<lesson>` name against `lectures` (progress rows UNION lectures in
 * the scanned sections). Adds a manifest entry (with the file's live SAF URI) for
 * every match not already downloaded; never overwrites an entry that's already
 * good. Pure/offline — the grant + scan already happened in
 * {@link scanPublicFolderForRestore}.
 */
export function relinkScannedFiles(
  files: ScannedAudio[],
  lectures: RestorableLecture[],
): RestoreResult {
  if (!isAndroid || files.length === 0) return { restored: 0, alreadyPresent: 0, unmatched: 0 };

  // Index lectures by the same <section>/<lesson> key the files use. Collisions
  // (two lectures sanitizing to the same name) keep the first — no id in the
  // filename to disambiguate anyway.
  const byKey = new Map<string, RestorableLecture>();
  for (const lec of lectures) {
    const section = sanitizeSegment(lec.sectionTitle ?? FALLBACK_SECTION, FALLBACK_SECTION);
    const base = sanitizeSegment(lec.title, lec.id);
    const key = matchKey(section, base);
    if (!byKey.has(key)) byKey.set(key, lec);
  }

  const manifest = readManifest();
  let restored = 0;
  let alreadyPresent = 0;
  let unmatched = 0;
  for (const file of files) {
    const lec = byKey.get(matchKey(file.section, file.base));
    if (!lec) {
      unmatched++;
      continue;
    }
    if (manifest[lec.id]?.safUri) {
      alreadyPresent++; // matched, but already downloaded — nothing to do
      continue;
    }
    manifest[lec.id] = {
      id: lec.id,
      title: lec.title,
      sheikhName: lec.sheikhName,
      durationSec: lec.durationSec,
      sectionTitle: lec.sectionTitle,
      positionSec: lec.positionSec || undefined,
      sectionId: lec.sectionId,
      order: lec.order,
      relativePath: `${file.section}/${file.base}`,
      safUri: file.safUri,
    };
    restored++;
  }
  if (restored > 0) writeManifest(manifest);
  return { restored, alreadyPresent, unmatched };
}

/**
 * Convenience wrapper: scan the public folder, then relink against `lectures`.
 * Kept for callers/tests that already have the full lecture list; the app's own
 * flow uses {@link scanPublicFolderForRestore} + {@link relinkScannedFiles} so it
 * can widen `lectures` with the scanned sections between the two steps.
 */
export async function restoreDownloadsFromPublicFolder(
  lectures: RestorableLecture[],
): Promise<RestoreResult> {
  if (!isAndroid) return { restored: 0, alreadyPresent: 0, unmatched: 0 };
  const { files } = await scanPublicFolderForRestore();
  return relinkScannedFiles(files, lectures);
}

if (!isWeb) migrateLegacyDownloads();
