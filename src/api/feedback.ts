/**
 * إرسال ملاحظات — students report bugs/improvements/other issues, always
 * reaching admins only (RLS + submit_feedback DEFINER RPC, migration 0061).
 * Never requires an account — guest sessions may submit too, same as
 * report_content (see src/api/reports.ts).
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Device from 'expo-device';

import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import { BlockedWordError, isBlockedWordError } from '@/api/reports';
import { deleteFromR2 } from '@/api/storage';
import { APP_VERSION } from '@/lib/version';

export type FeedbackCategory = 'bug' | 'improvement' | 'other';
export type FeedbackStatus = 'new' | 'in_review' | 'resolved' | 'dismissed';

export type DeviceInfo = {
  platform: string;
  osVersion: string | null;
  deviceModel: string | null;
  appVersion: string;
};

/** Best-effort device snapshot attached to every submission for triage. */
export function collectDeviceInfo(): DeviceInfo {
  return {
    platform: Platform.OS,
    osVersion: Device.osVersion ?? null,
    deviceModel: Device.modelName ?? null,
    appVersion: `${APP_VERSION} (${Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? '—'})`,
  };
}

export async function submitFeedback(
  category: FeedbackCategory,
  message: string,
): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('submit_feedback', {
    p_category: category,
    p_message: message,
    p_device_info: collectDeviceInfo(),
  });
  if (error) {
    if (isBlockedWordError(error)) throw new BlockedWordError();
    throw error;
  }
}

/** Admin triage row. */
export type AdminFeedbackRow = {
  id: string;
  category: FeedbackCategory;
  message: string;
  deviceInfo: DeviceInfo | null;
  /** Widened to the full ticket lifecycle (item 10) — old rows still fit. */
  status: FeedbackStatus | 'awaiting_student' | 'closed';
  adminNote: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export async function adminListFeedback(status?: FeedbackStatus): Promise<AdminFeedbackRow[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('admin_list_feedback', {
    ...(status ? { p_status: status } : {}),
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    category: r.category as FeedbackCategory,
    message: r.message,
    deviceInfo: (r.device_info as DeviceInfo | null) ?? null,
    status: r.status as FeedbackStatus,
    adminNote: r.admin_note ?? null,
    userId: r.user_id ?? null,
    userName: r.user_name ?? null,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? null,
  }));
}

export async function adminSetFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus,
  adminNote?: string,
): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('admin_set_feedback_status', {
    p_feedback_id: feedbackId,
    p_status: status,
    ...(adminNote ? { p_admin_note: adminNote } : {}),
  });
  if (error) throw error;
}

export async function adminDeleteFeedback(feedbackId: string): Promise<void> {
  if (USE_MOCK) return;
  // Collect the ticket's attached image keys BEFORE the delete (the DB rows
  // cascade away with the feedback row, but the R2 objects would otherwise be
  // orphaned). Mirrors deleteBroadcast/deleteLecture's R2 cleanup.
  const { data: imgs } = await supabase
    .from('feedback_messages')
    .select('image_path')
    .eq('feedback_id', feedbackId)
    .not('image_path', 'is', null);
  const { error } = await supabase.rpc('admin_delete_feedback', {
    p_feedback_id: feedbackId,
  });
  if (error) throw error;
  // Best-effort R2 cleanup — a storage hiccup must not fail the delete.
  for (const row of imgs ?? []) {
    if (row.image_path) await deleteFromR2(row.image_path);
  }
}

// ─── Support tickets (item 10 — the feedback thread) ───────────────────────────
// The RPC names below aren't in database.generated.ts until types are
// regenerated post-0097; each supabase.rpc call is cast `as never` (same stopgap
// as the questions/broadcasts additions). Runtime is unaffected.

/** One of the six ticket lifecycle states. */
export type TicketStatus = FeedbackStatus | 'awaiting_student' | 'closed';

/** A ticket row in the student's «تذاكري» list. */
export type MyTicket = {
  id: string;
  category: FeedbackCategory;
  message: string;
  status: TicketStatus;
  createdAt: string;
  lastActivity: string;
  adminReplied: boolean;
};

/** One message in a ticket thread. Admin turns may carry an image + CTA. */
export type TicketMessage = {
  id: string;
  isAdmin: boolean;
  body: string;
  imagePath: string | null;
  ctaLabel: string | null;
  ctaRoute: string | null;
  createdAt: string;
};

/** The signed-in student's tickets, newest-activity first. */
export async function getMyTickets(): Promise<MyTicket[]> {
  if (USE_MOCK) return [];
  const { data, error } = await (supabase.rpc as never as
    (fn: string) => Promise<{ data: unknown; error: unknown }>)('get_my_tickets');
  if (error) throw error as Error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    category: r.category as FeedbackCategory,
    message: r.message as string,
    status: r.status as TicketStatus,
    createdAt: r.created_at as string,
    lastActivity: r.last_activity as string,
    adminReplied: !!r.admin_replied,
  }));
}

/** The ordered message thread for one ticket (owner or admin). */
export async function getTicketThread(feedbackId: string): Promise<TicketMessage[]> {
  if (USE_MOCK) return [];
  const { data, error } = await (supabase.rpc as never as
    (fn: string, args: object) => Promise<{ data: unknown; error: unknown }>)(
    'get_ticket_thread', { p_feedback_id: feedbackId });
  if (error) throw error as Error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    isAdmin: !!r.is_admin,
    body: r.body as string,
    imagePath: (r.image_path as string | null) ?? null,
    ctaLabel: (r.cta_label as string | null) ?? null,
    ctaRoute: (r.cta_route as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

/** Student appends a reply to their own ticket. */
export async function studentReplyTicket(feedbackId: string, body: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await (supabase.rpc as never as
    (fn: string, args: object) => Promise<{ error: unknown }>)(
    'student_reply_ticket', { p_feedback_id: feedbackId, p_body: body });
  if (error) {
    if (isBlockedWordError(error)) throw new BlockedWordError();
    throw error as Error;
  }
}

/** Admin reply with optional image (R2 key) + CTA button. */
export async function adminReplyTicket(
  feedbackId: string,
  body: string,
  opts?: { imagePath?: string | null; ctaLabel?: string | null; ctaRoute?: string | null },
): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await (supabase.rpc as never as
    (fn: string, args: object) => Promise<{ error: unknown }>)('admin_reply_ticket', {
    p_feedback_id: feedbackId,
    p_body: body,
    p_image_path: opts?.imagePath ?? undefined,
    p_cta_label: opts?.ctaLabel ?? undefined,
    p_cta_route: opts?.ctaRoute ?? undefined,
  });
  if (error) throw error as Error;
}

/** Admin closes a ticket. */
export async function adminCloseTicket(feedbackId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await (supabase.rpc as never as
    (fn: string, args: object) => Promise<{ error: unknown }>)(
    'admin_close_ticket', { p_feedback_id: feedbackId });
  if (error) throw error as Error;
}
