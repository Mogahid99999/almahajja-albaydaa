import { useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { getLecturePlayback } from '@/api/lectures';
import type { LectureCard } from '@/api/types';
import {
  deleteLecture,
  downloadLecture,
  getDownloadedCards,
  listDownloadedIds,
  localUriFor,
  verifyDownloads,
} from '@/lib/downloads';
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
      const pb = await getLecturePlayback(lectureId);
      if (!pb.audioUrl) throw new Error('لا يوجد ملف صوتي للتحميل');
      const uri = await downloadLecture(lectureId, pb.audioUrl, {
        id: pb.id,
        title: pb.title,
        sheikhName: pb.sheikhName,
        durationSec: pb.durationSec,
        sectionTitle: pb.sectionTitle,
      });
      set(lectureId, { status: 'downloaded', progress: 1, localUri: uri });
    } catch (e) {
      set(lectureId, { status: 'error', error: (e as Error).message });
    }
  }, [lectureId, set]);

  const remove = useCallback(() => {
    void deleteLecture(lectureId);
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

/**
 * Ids of all downloaded lectures (for the downloads page). `useShallow` memoises
 * the derived array so an unrelated store notification (e.g. a download-progress
 * tick on another lecture) doesn't hand React a brand-new reference every render
 * — without it, `useSyncExternalStore` sees the snapshot "change" on every pass
 * and loops until "Maximum update depth exceeded" kills the app (GLITCH_LOG #20).
 */
export function useDownloadedIds(): string[] {
  return useDownloadsStore(
    useShallow((s) =>
      Object.entries(s.byLectureId)
        .filter(([, e]) => e.status === 'downloaded')
        .map(([id]) => id),
    ),
  );
}

/**
 * Seed the downloads store from disk once on app entry, so the downloads page is
 * correct immediately after a cold start (the store is in-memory; without this it
 * only learns about a file when that lecture's DownloadButton mounts). No-ops on web.
 */
export function useHydrateDownloads(): void {
  const set = useDownloadsStore((s) => s.set);
  useEffect(() => {
    void (async () => {
      // Public (Android) downloads are user-visible and can be moved/deleted
      // outside the app — prune stale manifest entries before trusting them.
      await verifyDownloads();
      for (const id of listDownloadedIds()) {
        const uri = localUriFor(id);
        if (uri) set(id, { status: 'downloaded', progress: 1, localUri: uri });
      }
    })();
  }, [set]);
}

/**
 * LectureCards for the downloads page, built from cached sidecars (offline-ok).
 * Reactive to the store: deleting a row drops its id → the card disappears.
 */
export function useDownloadedLectures(): LectureCard[] {
  const ids = useDownloadedIds();
  // Recompute only when the set of downloaded ids changes (sidecars read from disk).
  const key = ids.join(',');
  return useMemo(() => getDownloadedCards(), [key]);
}
