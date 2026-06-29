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
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import type { Attachment, AttachmentOwnerRef, CreateAttachmentInput } from './types';

export type {
  Attachment,
  AttachmentType,
  AttachmentOwnerRef,
  CreateAttachmentInput,
} from './types';

type RawAttRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  storage_path: string | null;
  external_url: string | null;
  body: string | null;
  order: number;
};

/** Resolve storage_path → signed URL (60 min TTL). Used by all read paths. */
async function signedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('attachments')
    .createSignedUrl(path, 3600);
  return error || !data ? null : data.signedUrl;
}

/** Shared row → Attachment mapper used by sections.ts and lectures.ts. */
export async function resolveAttachmentRows(rows: RawAttRow[]): Promise<Attachment[]> {
  return Promise.all(
    rows.map(async (r) => {
      let url: string | null = r.external_url ?? null;
      if (r.storage_path && !url) {
        url = await signedUrl(r.storage_path);
      }
      return {
        id: r.id,
        type: r.type as Attachment['type'],
        title: r.title,
        description: r.description,
        url,
        body: r.body ?? null,
        order: r.order,
      };
    }),
  );
}

/** Attachments owned by a section node (student + admin read). */
export async function listSectionAttachments(sectionId: string): Promise<Attachment[]> {
  if (USE_MOCK) return mock.listSectionAttachments(sectionId);
  const { data = [], error } = await supabase
    .from('attachments')
    .select('id, type, title, description, storage_path, external_url, body, order')
    .eq('section_id', sectionId)
    .order('order');
  if (error) throw error;
  return resolveAttachmentRows(data as RawAttRow[]);
}

/** Attachments owned by a lecture. */
export async function listLectureAttachments(lectureId: string): Promise<Attachment[]> {
  if (USE_MOCK) return mock.listLectureAttachments(lectureId);
  const { data = [], error } = await supabase
    .from('attachments')
    .select('id, type, title, description, storage_path, external_url, body, order')
    .eq('lecture_id', lectureId)
    .order('order');
  if (error) throw error;
  return resolveAttachmentRows(data as RawAttRow[]);
}

/** A single attachment incl. transcript `body` (for the in-app reader). */
export async function getAttachment(id: string): Promise<Attachment> {
  if (USE_MOCK) return mock.getAttachment(id);
  const { data, error } = await supabase
    .from('attachments')
    .select('id, type, title, description, storage_path, external_url, body, order')
    .eq('id', id)
    .single();
  if (error || !data) throw error ?? new Error('attachment not found');
  const [resolved] = await resolveAttachmentRows([data as RawAttRow]);
  return resolved;
}

/** Admin: add an attachment to a section or lecture. */
export async function createAttachment(input: CreateAttachmentInput): Promise<Attachment> {
  if (USE_MOCK) return mock.createAttachment(input);

  // Determine next order index
  const ownerFilter =
    input.owner.kind === 'section'
      ? { section_id: input.owner.id, lecture_id: null as null }
      : { section_id: null as null, lecture_id: input.owner.id };

  const { count } = await supabase
    .from('attachments')
    .select('id', { count: 'exact', head: true })
    .match(
      input.owner.kind === 'section'
        ? { section_id: input.owner.id }
        : { lecture_id: input.owner.id },
    );

  const { data, error } = await supabase
    .from('attachments')
    .insert({
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      external_url: input.type !== 'transcript' ? (input.url ?? null) : null,
      body: input.type === 'transcript' ? (input.body ?? null) : null,
      storage_path: null,
      order: count ?? 0,
      ...ownerFilter,
    })
    .select('id, type, title, description, storage_path, external_url, body, order')
    .single();
  if (error || !data) throw error ?? new Error('create attachment failed');
  const [resolved] = await resolveAttachmentRows([data as RawAttRow]);
  return resolved;
}

/** Admin: remove an attachment. */
export async function deleteAttachment(id: string): Promise<void> {
  if (USE_MOCK) return mock.deleteAttachment(id);
  // Fetch storage_path first so we can clean up the bucket if needed
  const { data: att } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('id', id)
    .single();
  const { error } = await supabase.from('attachments').delete().eq('id', id);
  if (error) throw error;
  if (att?.storage_path) {
    await supabase.storage.from('attachments').remove([att.storage_path]);
  }
}

/** Admin: persist a new order for one owner's attachments. */
export async function reorderAttachments(
  owner: AttachmentOwnerRef,
  orderedIds: string[],
): Promise<void> {
  if (USE_MOCK) return mock.reorderAttachments(owner, orderedIds);
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('attachments').update({ order: index }).eq('id', id),
    ),
  );
}
