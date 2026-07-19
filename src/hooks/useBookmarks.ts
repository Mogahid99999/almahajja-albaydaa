import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addBookmark,
  deleteBookmark,
  getBookmarks,
  setBookmarkReviewed,
  updateBookmarkNote,
} from '@/api/bookmarks';
import { queryKeys } from '@/constants/queryKeys';

/** All of my «للمراجعة لاحقًا» marks (V20 · §4). Off for guests. */
export function useBookmarks(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.bookmarks,
    queryFn: getBookmarks,
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

/** Count of unreviewed marks — for the profile entry badge («المراجعة لاحقًا — N»). */
export function useUnreviewedBookmarkCount(options?: { enabled?: boolean }) {
  const { data } = useBookmarks(options);
  return (data ?? []).filter((b) => b.status === 'pending').length;
}

/** Add a mark (offline-safe; the api layer queues when disconnected). */
export function useAddBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addBookmark,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bookmarks }),
  });
}

/** Mark reviewed / return to review. */
export function useSetBookmarkReviewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reviewed }: { id: string; reviewed: boolean }) =>
      setBookmarkReviewed(id, reviewed),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bookmarks }),
  });
}

/** Edit a mark's note. */
export function useUpdateBookmarkNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => updateBookmarkNote(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bookmarks }),
  });
}

/** Delete a mark. */
export function useDeleteBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteBookmark,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bookmarks }),
  });
}
