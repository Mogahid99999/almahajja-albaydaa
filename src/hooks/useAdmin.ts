import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  classifyLecture,
  createLecture,
  createSection,
  getAdminLectures,
  getUnclassifiedLectures,
  setLectureStatus,
} from '@/api/admin';
import { getSheikhs } from '@/api/sheikhs';
import type { AppLectureStatus } from '@/config';
import { queryKeys } from '@/constants/queryKeys';

export function useAdminLectures() {
  return useQuery({ queryKey: queryKeys.adminLectures, queryFn: getAdminLectures });
}

export function useUnclassifiedLectures() {
  return useQuery({ queryKey: queryKeys.unclassified, queryFn: getUnclassifiedLectures });
}

export function useSheikhs() {
  return useQuery({ queryKey: queryKeys.sheikhs, queryFn: getSheikhs });
}

function useAdminInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.adminLectures });
    qc.invalidateQueries({ queryKey: queryKeys.unclassified });
    qc.invalidateQueries({ queryKey: queryKeys.sectionsFlat });
    qc.invalidateQueries({ queryKey: queryKeys.home });
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
