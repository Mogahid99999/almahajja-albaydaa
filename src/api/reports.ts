/**
 * إبلاغ الإدارة — shared "report to admin" mechanism for أسئلة وأجوبة and
 * فوائد الدارسين (items 4/6). Reporting itself never requires an account —
 * guests may report too (migration 0051 report_content). The one
 * client-visible special case is the blocked-word rejection on the optional
 * reason text (item 5), surfaced as a calm Arabic message instead of the raw
 * Postgres error.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type ReportContentType = 'question' | 'benefit';
export type ReportStatus = 'open' | 'reviewed' | 'dismissed';

export const BLOCKED_WORD_MESSAGE =
  'الرجاء إعادة صياغة النص، فهو يحتوي على كلمات غير لائقة';

/** Thrown in place of the raw Postgres error when text is rejected by the blocked-word filter (SQLSTATE 'BLOCK', see migration 0053). */
export class BlockedWordError extends Error {
  constructor() {
    super(BLOCKED_WORD_MESSAGE);
    this.name = 'BlockedWordError';
  }
}

/** True when `error` is the blocked-word rejection (SQLSTATE 'BLOCK') from any moderated RPC. */
export function isBlockedWordError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'BLOCK';
}

/** Admin moderation row — the only surface where the reporter identity is resolved. */
export type AdminReportRow = {
  id: string;
  contentType: ReportContentType;
  contentId: string;
  contentBody: string | null;
  reason: string | null;
  status: ReportStatus;
  reporterId: string | null;
  reporterName: string | null;
  /** Author of the REPORTED content (question asker / benefit writer) — admin-only (migration 0059). */
  authorId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: string;
};

export async function reportContent(
  contentType: ReportContentType,
  contentId: string,
  reason?: string,
): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('report_content', {
    p_content_type: contentType,
    p_content_id: contentId,
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) {
    if (isBlockedWordError(error)) throw new BlockedWordError();
    throw error;
  }
}

// ─── Admin moderation ─────────────────────────────────────────────────────────

export async function adminListReports(status?: ReportStatus): Promise<AdminReportRow[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('admin_list_reports', {
    ...(status ? { p_status: status } : {}),
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    contentType: r.content_type as ReportContentType,
    contentId: r.content_id,
    contentBody: r.content_body ?? null,
    reason: r.reason ?? null,
    status: r.status as ReportStatus,
    reporterId: r.reporter_id ?? null,
    reporterName: r.reporter_name ?? null,
    authorId: r.author_id ?? null,
    authorName: r.author_id ? (r.author_name ?? 'طالب علم') : null,
    authorEmail: r.author_email ?? null,
    createdAt: r.created_at,
  }));
}

export async function adminSetReportStatus(
  reportId: string,
  status: ReportStatus,
): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('admin_set_report_status', {
    p_report_id: reportId,
    p_status: status,
  });
  if (error) throw error;
}
