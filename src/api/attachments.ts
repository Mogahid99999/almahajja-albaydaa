/**
 * Attachment data access (PRD §13 · Phase 2 feature A).
 *
 * Attachments hang off a section node OR a lecture. While `USE_MOCK` is true
 * everything is served from `src/mock/*`; the live Supabase path (table +
 * `attachments` storage bucket in supabase/migrations/0002) is wired when the
 * flag flips. Components never import supabase directly (CLAUDE.md conventions);
 * signed-URL resolution happens here in the api layer, never in components.
 */
import { USE_MOCK } from '@/config';
import * as mock from '@/mock/api';
import type { Attachment, CreateAttachmentInput } from './types';

export type {
  Attachment,
  AttachmentType,
  AttachmentOwnerRef,
  CreateAttachmentInput,
} from './types';

const NOT_LIVE = (fn: string) =>
  new Error(`[live mode] ${fn} not wired yet — set USE_MOCK=false work pending`);

/** Attachments owned by a section node (student + admin read). */
export async function listSectionAttachments(sectionId: string): Promise<Attachment[]> {
  if (USE_MOCK) return mock.listSectionAttachments(sectionId);
  throw NOT_LIVE('listSectionAttachments');
}

/** Attachments owned by a lecture. */
export async function listLectureAttachments(lectureId: string): Promise<Attachment[]> {
  if (USE_MOCK) return mock.listLectureAttachments(lectureId);
  throw NOT_LIVE('listLectureAttachments');
}

/** A single attachment incl. transcript `body` (for the in-app reader). */
export async function getAttachment(id: string): Promise<Attachment> {
  if (USE_MOCK) return mock.getAttachment(id);
  throw NOT_LIVE('getAttachment');
}

/** Admin: add an attachment to a section or lecture. */
export async function createAttachment(input: CreateAttachmentInput): Promise<Attachment> {
  if (USE_MOCK) return mock.createAttachment(input);
  throw NOT_LIVE('createAttachment');
}

/** Admin: remove an attachment. */
export async function deleteAttachment(id: string): Promise<void> {
  if (USE_MOCK) return mock.deleteAttachment(id);
  throw NOT_LIVE('deleteAttachment');
}
