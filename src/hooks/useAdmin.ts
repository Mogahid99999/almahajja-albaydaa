import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  classifyLecture,
  createLecture,
  createSection,
  deleteLecture,
  deleteSection,
  getAdminLectures,
  getNextLectureOrder,
  getSectionsEditData,
  getUnclassifiedLectures,
  setLectureStatus,
  updateLecture,
  updateSection,
} from '@/api/admin';
import {
  createSheikh,
  createSheikhAccount,
  deleteSheikh,
  getSheikhs,
  updateSheikh,
} from '@/api/sheikhs';
import type { AppLectureStatus } from '@/config';
import { queryKeys } from '@/constants/queryKeys';

export function useAdminLectures() {
  return useQuery({ queryKey: queryKeys.adminLectures, queryFn: getAdminLectures });
}

export function useUnclassifiedLectures() {
  return useQuery({ queryKey: queryKeys.unclassified, queryFn: getUnclassifiedLectures });
}

export function useSectionsEditData() {
  return useQuery({ queryKey: queryKeys.sectionsEdit, queryFn: getSectionsEditData });
}

export function useSheikhs() {
  return useQuery({ queryKey: queryKeys.sheikhs, queryFn: getSheikhs });
}

/**
 * The next order number for a new lecture in `sectionId` (max existing + 1), so
 * the upload form auto-fills الترتيب. Disabled (no fetch) until a section is
 * chosen; unclassified uploads don't use an order.
 */
export function useNextLectureOrder(sectionId: string | null) {
  return useQuery({
    queryKey: ['nextLectureOrder', sectionId],
    queryFn: () => getNextLectureOrder(sectionId as string),
    enabled: !!sectionId,
  });
}

function useAdminInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.adminLectures });
    qc.invalidateQueries({ queryKey: queryKeys.unclassified });
    qc.invalidateQueries({ queryKey: queryKeys.sectionsFlat });
    qc.invalidateQueries({ queryKey: queryKeys.sectionsEdit });
    qc.invalidateQueries({ queryKey: queryKeys.sheikhs });
    qc.invalidateQueries({ queryKey: queryKeys.home });
    // Any section page may now show different lectures/headers.
    qc.invalidateQueries({ queryKey: ['section'] });
    // A newly-created lecture shifts the next auto-order for its section.
    qc.invalidateQueries({ queryKey: ['nextLectureOrder'] });
  };
}

export function useCreateLecture() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: createLecture,
    onSuccess: invalidate,
  });
}

export function useSetLectureStatus() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (vars: { id: string; status: AppLectureStatus }) =>
      setLectureStatus(vars.id, vars.status),
    onSuccess: invalidate,
  });
}

export function useClassifyLecture() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (vars: { id: string; sectionId: string; order: number }) =>
      classifyLecture(vars.id, vars.sectionId, vars.order),
    onSuccess: invalidate,
  });
}

export function useCreateSection() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: createSection,
    onSuccess: invalidate,
  });
}

export function useUpdateSection() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      input: Parameters<typeof updateSection>[1];
    }) => updateSection(vars.id, vars.input),
    onSuccess: invalidate,
  });
}

export function useDeleteSection() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteSection(id),
    onSuccess: invalidate,
  });
}

export function useUpdateLecture() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      input: Parameters<typeof updateLecture>[1];
    }) => updateLecture(vars.id, vars.input),
    onSuccess: invalidate,
  });
}

export function useDeleteLecture() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteLecture(id),
    onSuccess: invalidate,
  });
}

export function useCreateSheikh() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (name: string) => createSheikh(name),
    onSuccess: invalidate,
  });
}

/** V6: provision a sheikh LOGIN (role sheikh) + linked metadata row. */
export function useCreateSheikhAccount() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) =>
      createSheikhAccount(input),
    onSuccess: invalidate,
  });
}

export function useUpdateSheikh() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (vars: { id: string; name: string }) => updateSheikh(vars.id, vars.name),
    onSuccess: invalidate,
  });
}

export function useDeleteSheikh() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteSheikh(id),
    onSuccess: invalidate,
  });
}
