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
  status: FeedbackStatus;
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
  const { error } = await supabase.rpc('admin_delete_feedback', {
    p_feedback_id: feedbackId,
  });
  if (error) throw error;
}
