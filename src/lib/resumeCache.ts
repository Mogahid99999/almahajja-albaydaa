/**
 * Local resume-position cache for EVERY lecture (downloaded or streamed-only),
 * independent of downloads.ts's downloaded-audio sidecar. A streamed-only
 * lecture has no local record of its own position — it depends entirely on
 * the TanStack Query `lecture` cache entry, which can be stale relative to
 * disk when the app is force-killed shortly after an in-memory
 * `invalidateQueries` call (see queryClient.ts's `RECONCILE_ON_LAUNCH_ROOTS`
 * comment and audioController.ts's `invalidateProgressViews`). This
 * file-per-lecture-id JSON sidecar under <Paths.document>/resume/<id>.json is
 * the local fallback that closes that gap. Web has no persistent FS here —
 * these no-op safely (mirrors downloads.ts).
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

export type ResumeEntry = { positionSec: number; updatedAt: number };

function resumeDir(): Directory {
  const dir = new Directory(Paths.document, 'resume');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function resumeFileFor(lectureId: string): File {
  return new File(resumeDir(), `${lectureId}.json`);
}

// Pointer to whichever lecture id was most recently active, so a cold-launch
// reconciliation step (app/_layout.tsx) knows which single `lecture`
// query-cache entry to force-invalidate, without listing/parsing every
// resume sidecar on disk.
function lastActiveFile(): File {
  return new File(resumeDir(), '_lastActive.json');
}

/**
 * Save (best-effort) the resume position for a lecture id, and mark it as the
 * most recently active lecture. Called from audioController.persist() on the
 * SAME 5s tick / pause / stop / finish cadence that already saves progress —
 * for EVERY lecture, not just downloaded ones. Never throws into the caller.
 */
export function saveResumePosition(lectureId: string, positionSec: number): void {
  if (isWeb) return;
  const updatedAt = Date.now();
  try {
    const f = resumeFileFor(lectureId);
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify({ positionSec: Math.max(0, Math.round(positionSec)), updatedAt }));
  } catch {
    /* best-effort — never throw into the playback save path */
  }
  try {
    const p = lastActiveFile();
    if (p.exists) p.delete();
    p.create();
    p.write(JSON.stringify({ lectureId, updatedAt }));
  } catch {
    /* best-effort */
  }
}

/** Read the cached resume position for a lecture id, or null if none saved. */
export function readResumePosition(lectureId: string): ResumeEntry | null {
  if (isWeb) return null;
  try {
    const f = resumeFileFor(lectureId);
    if (!f.exists) return null;
    return JSON.parse(f.textSync()) as ResumeEntry;
  } catch {
    return null;
  }
}

/**
 * Which lecture id was most recently active (any lecture, downloaded or
 * streamed) — used by the cold-launch reconciliation step in
 * app/_layout.tsx to target exactly the one `lecture` query-cache entry that
 * matters right after a force-kill.
 */
export function getMostRecentlyActiveLectureId(): string | null {
  if (isWeb) return null;
  try {
    const f = lastActiveFile();
    if (!f.exists) return null;
    const data = JSON.parse(f.textSync()) as { lectureId?: string };
    return data.lectureId ?? null;
  } catch {
    return null;
  }
}
