import { useCallback, useEffect } from 'react';

import { getLecturePlayback } from '@/api/lectures';
import { deleteLecture, downloadLecture, localUriFor } from '@/lib/downloads';
import { useDownloadsStore, type DownloadEntry } from '@/stores/downloadsStore';

/**
 * Per-lecture download state + actions, backed by the downloads store + the
 * filesystem. Used by the section list, the player download chip, and the
 * downloads page so they all stay in sync.
 */
export function useDownload(lectureId: string) {
  const entry = useDownloadsStore(
    (s) => s.byLectureId[lectureId],
  ) as DownloadEntry | undefined;
  const set = useDownloadsStore((s) => s.set);
  const removeEntry = useDownloadsStore((s) => s.remove);

  // Reconcile store with what's actually on disk (e.g. after restart).
  useEffect(() => {
    if (!entry) {
      const uri = localUriFor(lectureId);
      if (uri) set(lectureId, { status: 'downloaded', progress: 1, localUri: uri });
    }
  }, [lectureId, entry, set]);

  const download = useCallback(async () => {
    set(lectureId, { status: 'downloading', progress: 0 });
    try {
      const { audioUrl } = await getLecturePlayback(lectureId);
      const uri = await downloadLecture(lectureId, audioUrl);
      set(lectureId, { status: 'downloaded', progress: 1, localUri: uri });
    } catch (e) {
      set(lectureId, { status: 'error', error: (e as Error).message });
    }
  }, [lectureId, set]);

  const remove = useCallback(() => {
    deleteLecture(lectureId);
    removeEntry(lectureId);
  }, [lectureId, removeEntry]);

  return {
    status: entry?.status ?? 'idle',
    progress: entry?.progress ?? 0,
    localUri: entry?.localUri,
    download,
    remove,
  };
}

/** Ids of all downloaded lectures (for the downloads page). */
export function useDownloadedIds(): string[] {
  return useDownloadsStore((s) =>
    Object.entries(s.byLectureId)
      .filter(([, e]) => e.status === 'downloaded')
      .map(([id]) => id),
  );
}
