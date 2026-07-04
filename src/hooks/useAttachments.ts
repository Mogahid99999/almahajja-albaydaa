import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createAttachment,
  deleteAttachment,
  getAttachment,
  listLectureAttachments,
  listSectionAttachments,
  reorderAttachments,
} from '@/api/attachments';
import type { AttachmentOwnerRef, CreateAttachmentInput } from '@/api/types';
import { queryKeys } from '@/constants/queryKeys';

// Signed file URLs are valid 3600s — cache near that long (45min stale /
// 50min gc) so revisiting the same section/lecture/attachment never re-mints.
const SIGNED_URL_STALE_TIME = 45 * 60_000;
const SIGNED_URL_GC_TIME = 50 * 60_000;

/** Attachments owned by a section node. */
export function useSectionAttachments(sectionId: string) {
  return useQuery({
    queryKey: queryKeys.sectionAttachments(sectionId),
    queryFn: () => listSectionAttachments(sectionId),
    enabled: !!sectionId,
    staleTime: SIGNED_URL_STALE_TIME,
    gcTime: SIGNED_URL_GC_TIME,
  });
}

/** Attachments owned by a lecture. */
export function useLectureAttachments(lectureId: string) {
  return useQuery({
    queryKey: queryKeys.lectureAttachments(lectureId),
    queryFn: () => listLectureAttachments(lectureId),
    enabled: !!lectureId,
    staleTime: SIGNED_URL_STALE_TIME,
    gcTime: SIGNED_URL_GC_TIME,
  });
}

/** A single attachment incl. transcript body (in-app reader). */
export function useAttachment(id: string) {
  return useQuery({
    queryKey: queryKeys.attachment(id),
    queryFn: () => getAttachment(id),
    enabled: !!id,
    staleTime: SIGNED_URL_STALE_TIME,
    gcTime: SIGNED_URL_GC_TIME,
  });
}

/**
 * Admin view of an owner's attachments. Keyed separately from the student-facing
 * section/lecture lists so the manager has its own cache entry (and, live, can
 * surface draft-only rows the student lists hide).
 */
export function useAdminAttachments(owner: AttachmentOwnerRef) {
  return useQuery({
    queryKey: queryKeys.adminAttachments(owner),
    queryFn: () =>
      owner.kind === 'section'
        ? listSectionAttachments(owner.id)
        : listLectureAttachments(owner.id),
    enabled: !!owner.id,
  });
}

/** Invalidate every view that embeds an owner's attachments. */
function useInvalidateOwner() {
  const qc = useQueryClient();
  return (owner: AttachmentOwnerRef) => {
    qc.invalidateQueries({ queryKey: queryKeys.adminAttachments(owner) });
    if (owner.kind === 'section') {
      qc.invalidateQueries({ queryKey: queryKeys.sectionAttachments(owner.id) });
      qc.invalidateQueries({ queryKey: queryKeys.section(owner.id) });
    } else {
      qc.invalidateQueries({ queryKey: queryKeys.lectureAttachments(owner.id) });
      qc.invalidateQueries({ queryKey: queryKeys.lecture(owner.id) });
    }
  };
}

/** Admin: add an attachment, then refresh the owning section/lecture views. */
export function useCreateAttachment() {
  const invalidateOwner = useInvalidateOwner();
  return useMutation({
    mutationFn: (input: CreateAttachmentInput) => createAttachment(input),
    onSuccess: (_data, input) => invalidateOwner(input.owner),
  });
}

/** Admin: remove an attachment (owner passed so we can target invalidation). */
export function useDeleteAttachment() {
  const invalidateOwner = useInvalidateOwner();
  return useMutation({
    mutationFn: (vars: { id: string; owner: AttachmentOwnerRef }) =>
      deleteAttachment(vars.id),
    onSuccess: (_data, vars) => invalidateOwner(vars.owner),
  });
}

/** Admin: persist a reordered list for one owner, then refresh its views. */
export function useReorderAttachments() {
  const invalidateOwner = useInvalidateOwner();
  return useMutation({
    mutationFn: (vars: { owner: AttachmentOwnerRef; orderedIds: string[] }) =>
      reorderAttachments(vars.owner, vars.orderedIds),
    onSuccess: (_data, vars) => invalidateOwner(vars.owner),
  });
}
