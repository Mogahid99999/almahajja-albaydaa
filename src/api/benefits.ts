/**
 * فوائد الدارسين data access (V6 Feature C) — anonymous shared benefits.
 *
 * The shared list comes ONLY from the migration-0030 DEFINER RPC that never
 * selects the author (`is_mine` is the sole ownership signal, resolved
 * server-side). The author identity crosses the wire exclusively through the
 * is_admin() moderation RPCs. Posting requires a registered account
 * (server-gated); reading is open to guests.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import { BlockedWordError, isBlockedWordError } from '@/api/reports';

export type LectureBenefit = {
  id: string;
  body: string;
  isMine: boolean;
  createdAt: string;
};

export type BenefitStatus = 'visible' | 'hidden';

/** Admin moderation row — the only surface where the author is resolved. */
export type AdminBenefitRow = {
  id: string;
  lectureId: string;
  lectureTitle: string;
  body: string;
  status: BenefitStatus;
  authorId: string;
  authorName: string;
  authorEmail: string | null;
  createdAt: string;
};

export async function getLectureBenefits(lectureId: string): Promise<LectureBenefit[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_lecture_benefits', {
    p_lecture_id: lectureId,
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    body: r.body,
    isMine: !!r.is_mine,
    createdAt: r.created_at,
  }));
}

export async function addLectureBenefit(lectureId: string, body: string): Promise<string> {
  if (USE_MOCK) return '';
  const { data, error } = await supabase.rpc('add_lecture_benefit', {
    p_lecture_id: lectureId,
    p_body: body,
  });
  if (error) {
    if (isBlockedWordError(error)) throw new BlockedWordError();
    throw error;
  }
  return data as string;
}

export async function deleteOwnBenefit(benefitId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('delete_own_benefit', { p_id: benefitId });
  if (error) throw error;
}

// ─── Admin moderation ─────────────────────────────────────────────────────────

export async function adminListBenefits(lectureId?: string): Promise<AdminBenefitRow[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('admin_list_benefits', {
    ...(lectureId ? { p_lecture_id: lectureId } : {}),
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    lectureId: r.lecture_id,
    lectureTitle: r.lecture_title,
    body: r.body,
    status: r.status as BenefitStatus,
    authorId: r.author_id,
    authorName: r.author_name ?? 'طالب علم',
    authorEmail: r.author_email ?? null,
    createdAt: r.created_at,
  }));
}

export async function adminSetBenefitStatus(
  benefitId: string,
  status: BenefitStatus,
): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('admin_set_benefit_status', {
    p_id: benefitId,
    p_status: status,
  });
  if (error) throw error;
}

/** Admin hard-delete (RLS: delete own or admin). */
export async function adminDeleteBenefit(benefitId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.from('lecture_benefits').delete().eq('id', benefitId);
  if (error) throw error;
}
