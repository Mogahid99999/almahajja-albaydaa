import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addFeaturedLecture,
  listAdminFeatured,
  removeFeaturedLecture,
  reorderFeaturedLectures,
} from '@/api/featured';
import { queryKeys } from '@/constants/queryKeys';

/** Admin/publisher list of every curated pick, in order. */
export function useAdminFeatured() {
  return useQuery({
    queryKey: queryKeys.adminFeatured,
    queryFn: listAdminFeatured,
  });
}

// Any curated-list change must refresh the admin screen AND the student-facing
// Home rail + full-list screen so it's visible without an app restart.
function useInvalidateFeatured() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.adminFeatured });
    void qc.invalidateQueries({ queryKey: queryKeys.home });
    void qc.invalidateQueries({ queryKey: queryKeys.featuredLectures });
  };
}

export function useAddFeatured() {
  const invalidate = useInvalidateFeatured();
  return useMutation({
    mutationFn: (lectureId: string) => addFeaturedLecture(lectureId),
    onSuccess: invalidate,
  });
}

export function useRemoveFeatured() {
  const invalidate = useInvalidateFeatured();
  return useMutation({
    mutationFn: (lectureId: string) => removeFeaturedLecture(lectureId),
    onSuccess: invalidate,
  });
}

export function useReorderFeatured() {
  const invalidate = useInvalidateFeatured();
  return useMutation({
    mutationFn: (lectureIds: string[]) => reorderFeaturedLectures(lectureIds),
    onSuccess: invalidate,
  });
}
