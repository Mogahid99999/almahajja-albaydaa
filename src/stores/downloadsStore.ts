import { create } from 'zustand';

/**
 * Offline-download state per lecture. The actual file transfer (expo-file-system)
 * is wired in during the offline-download phase; this store tracks status and the
 * resolved local URI so the player can prefer a downloaded file over streaming.
 */
export type DownloadStatus =
  | 'idle'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type DownloadEntry = {
  status: DownloadStatus;
  /** 0..1 */
  progress: number;
  localUri?: string;
  error?: string;
  /** Live transfer stats while status === 'downloading' (undefined once settled). */
  bytesWritten?: number;
  /** -1/undefined when the server didn't send Content-Length (indeterminate progress). */
  totalBytes?: number;
  /** Bytes/sec, smoothed over the last throttled tick. */
  speedBps?: number;
};

type DownloadsState = {
  byLectureId: Record<string, DownloadEntry>;
};

type DownloadsActions = {
  set: (lectureId: string, entry: Partial<DownloadEntry>) => void;
  remove: (lectureId: string) => void;
};

export const useDownloadsStore = create<DownloadsState & DownloadsActions>(
  (set) => ({
    byLectureId: {},
    set: (lectureId, entry) =>
      set((s) => {
        const prev: DownloadEntry = s.byLectureId[lectureId] ?? {
          status: 'idle',
          progress: 0,
        };
        return {
          byLectureId: {
            ...s.byLectureId,
            [lectureId]: { ...prev, ...entry },
          },
        };
      }),
    remove: (lectureId) =>
      set((s) => {
        const next = { ...s.byLectureId };
        delete next[lectureId];
        return { byLectureId: next };
      }),
  }),
);
