/**
 * ملاحظات الطلاب — admin inbox for in-app feedback (bug/improvement/other),
 * migration 0061. Same visual/structural pattern as app/admin/reports.tsx,
 * minus the content-specific actions (no hide/ban here — just triage status).
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import type { AdminFeedbackRow, FeedbackCategory, FeedbackStatus } from '@/api/feedback';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useAdminDeleteFeedback, useAdminFeedback, useAdminSetFeedbackStatus } from '@/hooks/useFeedback';
import { arSince } from '@/lib/format';

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: 'مشكلة',
  improvement: 'اقتراح تحسين',
  other: 'أخرى',
};
const CATEGORY_ICON: Record<FeedbackCategory, keyof typeof Feather.glyphMap> = {
  bug: 'alert-triangle',
  improvement: 'trending-up',
  other: 'message-circle',
};
const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'جديدة',
  in_review: 'قيد المراجعة',
  resolved: 'محلولة',
  dismissed: 'متجاهلة',
};

function StatusChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.tabChip, active && styles.tabChipActive, pressed && !active && { opacity: 0.7 }]}
    >
      <Txt size={13} weight={active ? 'semibold' : 'medium'} color={active ? colors.onTealPrimary : colors.textSlate}>
        {label}
      </Txt>
    </Pressable>
  );
}

function ActionBtn({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}>
      <Feather name={icon} size={13} color={color} />
      <Txt size={12} weight="medium" color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

export default function FeedbackScreen() {
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('new');
  const { data: rows, isLoading } = useAdminFeedback(status === 'all' ? undefined : status);
  const setFeedbackStatus = useAdminSetFeedbackStatus();
  const deleteFeedback = useAdminDeleteFeedback();
  const [pendingDismiss, setPendingDismiss] = useState<AdminFeedbackRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminFeedbackRow | null>(null);

  return (
    <AdminShell active="feedback" breadcrumb="ملاحظات الطلاب">
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        ملاحظات الطلاب
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        بلاغات مشكلات، اقتراحات تحسين، وملاحظات عامة — مع معلومات الجهاز لمساعدة الفريق التقني
      </Txt>

      <View style={styles.tabsRow}>
        <StatusChip label="جديدة" active={status === 'new'} onPress={() => setStatus('new')} />
        <StatusChip label="قيد المراجعة" active={status === 'in_review'} onPress={() => setStatus('in_review')} />
        <StatusChip label="محلولة" active={status === 'resolved'} onPress={() => setStatus('resolved')} />
        <StatusChip label="متجاهلة" active={status === 'dismissed'} onPress={() => setStatus('dismissed')} />
        <StatusChip label="الكل" active={status === 'all'} onPress={() => setStatus('all')} />
      </View>

      <View style={{ maxWidth: 860 }}>
        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primaryTeal} />
          </View>
        ) : (rows ?? []).length === 0 ? (
          <Card>
            <Txt size={13} color={colors.textMuted} align="center">
              لا ملاحظات هنا.
            </Txt>
          </Card>
        ) : (
          (rows ?? []).map((r) => (
            <Card key={r.id} style={styles.itemCard}>
              <View style={styles.metaRow}>
                <View style={styles.typeChip}>
                  <Feather name={CATEGORY_ICON[r.category]} size={12} color={colors.primaryTeal600} />
                  <Txt size={11.5} weight="medium" color={colors.primaryTeal600}>
                    {CATEGORY_LABEL[r.category]}
                  </Txt>
                </View>
                <Feather name={r.userName ? 'user' : 'user-x'} size={13} color={colors.textGhost} />
                <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1}>
                  {r.userName ?? 'زائر'}
                </Txt>
                <View style={{ flex: 1 }} />
                <Txt size={11.5} color={colors.textGhost}>
                  {arSince(r.createdAt)}
                </Txt>
              </View>

              <Txt size={14} color={colors.textInk} style={{ marginTop: 8, lineHeight: 23 }}>
                {r.message}
              </Txt>

              {r.deviceInfo ? (
                <View style={styles.deviceBox}>
                  <Feather name="smartphone" size={12} color={colors.textGhost} />
                  <Txt size={11.5} color={colors.textGhost} numberOfLines={1} style={{ flex: 1 }}>
                    {r.deviceInfo.platform} · {r.deviceInfo.deviceModel ?? 'جهاز غير معروف'} ·{' '}
                    {r.deviceInfo.osVersion ?? '—'} · إصدار التطبيق {r.deviceInfo.appVersion}
                  </Txt>
                </View>
              ) : null}

              {status !== 'new' ? (
                <View style={styles.statusBadge}>
                  <Txt size={10.5} weight="semibold" color={colors.textMuted}>
                    {STATUS_LABEL[r.status]}
                  </Txt>
                </View>
              ) : null}

              <View style={styles.actionsRow}>
                {r.status === 'new' ? (
                  <ActionBtn
                    icon="eye"
                    label="بدء المراجعة"
                    color={colors.primaryTeal}
                    onPress={() => setFeedbackStatus.mutate({ feedbackId: r.id, status: 'in_review' })}
                  />
                ) : null}
                {r.status === 'new' || r.status === 'in_review' ? (
                  <>
                    <ActionBtn
                      icon="check-circle"
                      label="حل"
                      color={colors.stateSuccess}
                      onPress={() => setFeedbackStatus.mutate({ feedbackId: r.id, status: 'resolved' })}
                    />
                    <ActionBtn icon="x-circle" label="تجاهل" color={colors.textMuted} onPress={() => setPendingDismiss(r)} />
                  </>
                ) : null}
                <ActionBtn icon="trash-2" label="حذف" color={colors.stateDanger} onPress={() => setPendingDelete(r)} />
              </View>
            </Card>
          ))
        )}
      </View>

      <ConfirmDialog
        visible={!!pendingDismiss}
        title="تجاهل الملاحظة"
        message="ستُعلَّم هذه الملاحظة متجاهلة."
        confirmLabel="تجاهل"
        destructive={false}
        pending={setFeedbackStatus.isPending}
        onConfirm={() => {
          if (!pendingDismiss) return;
          setFeedbackStatus.mutate(
            { feedbackId: pendingDismiss.id, status: 'dismissed' },
            { onSettled: () => setPendingDismiss(null) },
          );
        }}
        onCancel={() => setPendingDismiss(null)}
      />
      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف الملاحظة"
        message="سيُحذف هذا العنصر نهائياً ولا يمكن التراجع."
        confirmLabel="حذف"
        pending={deleteFeedback.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteFeedback.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 22 } as TextStyle,
  tabsRow: { flexDirection: 'row', gap: 8, marginBottom: 18, flexWrap: 'wrap' } as ViewStyle,
  tabChip: { paddingVertical: 9, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.surfaceInset } as ViewStyle,
  tabChipActive: { backgroundColor: colors.primaryTeal, ...shadows.button } as ViewStyle,
  itemCard: { marginBottom: 12 } as ViewStyle,
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 } as ViewStyle,
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 9,
    borderRadius: radius.pill, backgroundColor: 'rgba(44,97,87,0.08)',
  } as ViewStyle,
  deviceBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, padding: 8, borderRadius: radius.sm,
    backgroundColor: colors.bgSandRaised, borderWidth: 1, borderColor: colors.borderSand,
  } as ViewStyle,
  statusBadge: {
    alignSelf: 'flex-start', marginTop: 10, paddingVertical: 3, paddingHorizontal: 9,
    borderRadius: radius.pill, backgroundColor: colors.surfaceInset,
  } as ViewStyle,
  actionsRow: { flexDirection: 'row', gap: 14, marginTop: 12 } as ViewStyle,
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 } as ViewStyle,
  loadingBox: { paddingVertical: 40, alignItems: 'center' } as ViewStyle,
});
