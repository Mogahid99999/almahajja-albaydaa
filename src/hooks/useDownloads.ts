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
  verifyDownload,
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

  // Reconcile with the ACTUAL file on mount (V17.1). Download state must reflect
  // whether the audio file really exists in its chosen storage location: if the
  // user deleted/moved it in a file manager, this drops the entry so the control
  // reopens the download; if it's present, it shows as downloaded. Skipped while
  // a download is in flight (don't fight the live transfer). `verifyDownload`
  // prunes the manifest itself when the file is gone.
  useEffect(() => {
    if (entry?.status === 'downloading') return;
    let cancelled = false;
    void verifyDownload(lectureId).then((exists) => {
      if (cancelled) return;
      if (exists) {
        const uri = localUriFor(lectureId);
        if (uri) set(lectureId, { status: 'downloaded', progress: 1, localUri: uri });
      } else if (entry?.status === 'downloaded') {
        // Was shown as downloaded but the file is gone — reopen the download.
        removeEntry(lectureId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lectureId, entry?.status, set, removeEntry]);

  const download = useCallback(async () => {
    set(lectureId, {
      status: 'downloading',
      progress: 0,
      bytesWritten: 0,
      totalBytes: undefined,
      speedBps: undefined,
    });
    try {
      const pb = await getLecturePlayback(lectureId);
      if (!pb.audioUrl) throw new Error('لا يوجد ملف صوتي للتحميل');

      // Throttle store writes to ~4/sec — the native side can fire onProgress
      // once per chunk (hundreds of times for a large file), and writing every
      // tick would re-render the row on every chunk (see GLITCH_LOG #20 note
      // in useDownloadedIds above for why unthrottled zustand ticks are unsafe
      // here).
      let lastTickAt = Date.now();
      let lastBytes = 0;
      const onProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
        const now = Date.now();
        const dt = (now - lastTickAt) / 1000;
        if (dt < 0.25) return;
        const speedBps = dt > 0 ? (bytesWritten - lastBytes) / dt : 0;
        lastTickAt = now;
        lastBytes = bytesWritten;
        set(lectureId, {
          progress: totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : 0,
          bytesWritten,
          totalBytes: totalBytes > 0 ? totalBytes : undefined,
          speedBps: Math.max(0, speedBps),
        });
      };

      const uri = await downloadLecture(
        lectureId,
        pb.audioUrl,
        {
          id: pb.id,
          title: pb.title,
          sheikhName: pb.sheikhName,
          durationSec: pb.durationSec,
          sectionTitle: pb.sectionTitle,
          // Section context so the player can resolve next/prev + auto-advance
          // through a downloaded series while OFFLINE (audit F-502).
          sectionId: pb.sectionId,
          order: pb.order,
        },
        onProgress,
      );
      set(lectureId, {
        status: 'downloaded',
        progress: 1,
        localUri: uri,
        bytesWritten: undefined,
        totalBytes: undefined,
        speedBps: undefined,
      });
    } catch (e) {
      set(lectureId, {
        status: 'error',
        error: (e as Error).message,
        bytesWritten: undefined,
        totalBytes: undefined,
        speedBps: undefined,
      });
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
    bytesWritten: entry?.bytesWritten,
    totalBytes: entry?.totalBytes,
    speedBps: entry?.speedBps,
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
  const removeEntry = useDownloadsStore((s) => s.remove);
  useEffect(() => {
    // Seed the store from the on-device manifest FIRST, synchronously — this is
    // the source of truth for "is this downloaded?" and must never wait on (or be
    // gated behind) a network call. Seeding here means the UI reflects local truth
    // from the first frame, offline, across Force Stop.
    for (const id of listDownloadedIds()) {
      const uri = localUriFor(id);
      if (uri) set(id, { status: 'downloaded', progress: 1, localUri: uri });
    }
    // THEN reconcile against the ACTUAL files (V17.1). An entry whose audio file
    // is gone from the chosen storage location (deleted/moved in a file manager)
    // is pruned from the manifest AND dropped from the store, so it stops showing
    // as "downloaded" and its download control reopens. Files still present are
    // (re)confirmed. No-op on web.
    void verifyDownloads().then((removed) => {
      for (const id of removed) removeEntry(id);
      for (const id of listDownloadedIds()) {
        const uri = localUriFor(id);
        if (uri) set(id, { status: 'downloaded', progress: 1, localUri: uri });
      }
    });
  }, [set, removeEntry]);
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
