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
  reorderSections,
  setLectureStatus,
  updateLecture,
  updateSection,
} from '@/api/admin';
import type { FlatSectionNode } from '@/api/types';
import type { PickedAttachmentFile } from '@/api/attachments';
import {
  createSheikh,
  createSheikhAccount,
  deleteSheikh,
  getSheikhProfiles,
  getSheikhs,
  updateSheikh,
  updateSheikhBio,
  uploadSheikhPhoto,
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

/** Sheikh list incl. bio + photo (Item 8). `invalidateQueries({queryKey:
 * queryKeys.sheikhs})` below fuzzy-matches this prefixed key too — no extra
 * invalidation wiring needed. */
export function useSheikhProfiles() {
  return useQuery({ queryKey: ['sheikhs', 'profiles'], queryFn: getSheikhProfiles });
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

/**
 * Rebuild the depth-first flat list after new `order` values, mirroring the
 * server sort exactly (siblings by order then title — migration 0059) so the
 * optimistic frame and the refetched one are identical.
 */
function reflattenTree(nodes: FlatSectionNode[]): FlatSectionNode[] {
  const byParent = new Map<string | null, FlatSectionNode[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const out: FlatSectionNode[] = [];
  const walk = (parentId: string | null) => {
    const children = (byParent.get(parentId) ?? []).sort(
      (a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ar'),
    );
    for (const c of children) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(null);
  return out;
}

/**
 * Persist a drag-and-drop sibling reorder. Optimistic: the tree re-sorts in the
 * cache immediately; a server failure rolls it back and refetches.
 */
export function useReorderSections() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => reorderSections(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: queryKeys.sectionsFlat });
      const previous = qc.getQueryData<FlatSectionNode[]>(queryKeys.sectionsFlat);
      if (previous) {
        const pos = new Map(ids.map((id, i) => [id, i + 1]));
        const next = reflattenTree(
          previous.map((n) => (pos.has(n.id) ? { ...n, order: pos.get(n.id)! } : n)),
        );
        qc.setQueryData(queryKeys.sectionsFlat, next);
      }
      return { previous };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.sectionsFlat, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.sectionsFlat });
      void qc.invalidateQueries({ queryKey: queryKeys.sectionsEdit });
      // The student app orders by the same numbers (home grid + section pages).
      void qc.invalidateQueries({ queryKey: queryKeys.home });
      void qc.invalidateQueries({ queryKey: ['section'] });
    },
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

/** Item 8: save a sheikh's bio text. */
export function useUpdateSheikhBio() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (vars: { id: string; bio: string }) => updateSheikhBio(vars.id, vars.bio),
    onSuccess: invalidate,
  });
}

/** Item 8: upload/replace a sheikh's photo. */
export function useUploadSheikhPhoto() {
  const invalidate = useAdminInvalidate();
  return useMutation({
    mutationFn: (vars: { sheikhId: string; file: PickedAttachmentFile }) =>
      uploadSheikhPhoto(vars.sheikhId, vars.file),
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
