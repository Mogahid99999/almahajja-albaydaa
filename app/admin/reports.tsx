/**
 * البلاغات — admin moderation for reported أسئلة وأجوبة + فوائد الدارسين
 * (items 4/6, shared mechanism). Same visual/structural pattern as
 * app/admin/contributions.tsx.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { AdminReportRow, ReportStatus } from '@/api/reports';
import { adminSetReportStatus } from '@/api/reports';
import { adminSetBenefitStatus } from '@/api/benefits';
import { banUser } from '@/api/adminUsers';
import { setQuestionHidden } from '@/api/questions';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { queryKeys } from '@/constants/queryKeys';
import { useAdminReports, useAdminSetReportStatus } from '@/hooks/useReports';
import { arNum, arSince } from '@/lib/format';
import { notify } from '@/lib/notify';

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

/** Hides the underlying content (question/benefit as appropriate) THEN marks
 * the report reviewed, so an actioned report drops out of the open queue. */
function useHideReportedContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: AdminReportRow) => {
      if (row.contentType === 'question') {
        await setQuestionHidden(row.contentId, true);
      } else {
        await adminSetBenefitStatus(row.contentId, 'hidden');
      }
      await adminSetReportStatus(row.id, 'reviewed');
    },
    // Optimistic: the report leaves «مفتوحة» the instant إخفاء is confirmed.
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: ['admin', 'reports'] });
      const snapshots = qc.getQueriesData<AdminReportRow[]>({ queryKey: ['admin', 'reports'] });
      qc.setQueriesData<AdminReportRow[]>({ queryKey: ['admin', 'reports'] }, (rows) =>
        rows?.map((r) => (r.id === row.id ? { ...r, status: 'reviewed' as ReportStatus } : r)),
      );
      return { snapshots };
    },
    onError: (e, _row, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
      notify('تعذّر إخفاء المحتوى', (e as Error).message);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.reports() });
      void qc.invalidateQueries({ queryKey: ['questions'] });
      void qc.invalidateQueries({ queryKey: ['benefits'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'benefits'] });
    },
  });
}

/** Direct ban of the reported content's author, from the report card itself. */
function useBanReportedAuthor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => banUser(userId),
    onSuccess: () => {
      notify('تم الحظر', 'حُظر الحساب وسُجّل خروجه من جميع الأجهزة.');
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (e) => notify('تعذّر الحظر', (e as Error).message),
  });
}

export default function ReportsScreen() {
  const [status, setStatus] = useState<ReportStatus | 'all'>('open');
  const { data: reports, isLoading } = useAdminReports(status === 'all' ? undefined : status);
  const setReportStatus = useAdminSetReportStatus();
  const hideContent = useHideReportedContent();
  const banAuthor = useBanReportedAuthor();
  const [pendingHide, setPendingHide] = useState<AdminReportRow | null>(null);
  const [pendingDismiss, setPendingDismiss] = useState<AdminReportRow | null>(null);
  const [pendingBan, setPendingBan] = useState<AdminReportRow | null>(null);

  return (
    <AdminShell active="reports" breadcrumb="البلاغات">
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        البلاغات
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        بلاغات الدارسين على الأسئلة والفوائد — راجعها بهدوء، ولا عقوبة تلقائية
      </Txt>

      <View style={styles.tabsRow}>
        <StatusChip label="مفتوحة" active={status === 'open'} onPress={() => setStatus('open')} />
        <StatusChip label="تمت المراجعة" active={status === 'reviewed'} onPress={() => setStatus('reviewed')} />
        <StatusChip label="متجاهلة" active={status === 'dismissed'} onPress={() => setStatus('dismissed')} />
        <StatusChip label="الكل" active={status === 'all'} onPress={() => setStatus('all')} />
      </View>

      <View style={{ maxWidth: 860 }}>
        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primaryTeal} />
          </View>
        ) : (reports ?? []).length === 0 ? (
          <Card>
            <Txt size={13} color={colors.textMuted} align="center">
              لا بلاغات هنا.
            </Txt>
          </Card>
        ) : (
          <>
            <Txt size={12} color={colors.textGhost} style={{ marginBottom: 10 }}>
              {arNum((reports ?? []).length)} بلاغ
            </Txt>
            {(reports ?? []).map((r) => (
              <Card key={r.id} style={styles.itemCard}>
                <View style={styles.metaRow}>
                  <View style={styles.typeChip}>
                    <Feather name={r.contentType === 'question' ? 'help-circle' : 'award'} size={12} color={colors.primaryTeal600} />
                    <Txt size={11.5} weight="medium" color={colors.primaryTeal600}>
                      {r.contentType === 'question' ? 'سؤال' : 'فائدة'}
                    </Txt>
                  </View>
                  <Feather name={r.reporterName ? 'user' : 'user-x'} size={13} color={colors.textGhost} />
                  <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1}>
                    {r.reporterName ?? 'مُبلّغ مجهول'}
                  </Txt>
                  <View style={{ flex: 1 }} />
                  <Txt size={11.5} color={colors.textGhost}>
                    {arSince(r.createdAt)}
                  </Txt>
                </View>
                {/* Author of the reported content — admin-only surface */}
                <View style={styles.authorRow}>
                  <Feather name="edit-3" size={12} color={colors.textGhost} />
                  <Txt size={12} weight="medium" color={colors.textSlate} numberOfLines={1}>
                    الكاتب: {r.authorName ?? 'غير معروف (ربما حُذف المحتوى)'}
                  </Txt>
                  {r.authorEmail ? (
                    <Txt size={11.5} color={colors.textGhost} numberOfLines={1} style={{ flexShrink: 1 }}>
                      {r.authorEmail}
                    </Txt>
                  ) : null}
                </View>
                <Txt size={14} color={colors.textInk} style={{ marginTop: 8, lineHeight: 23 }} numberOfLines={4}>
                  {r.contentBody ?? '(تم حذف المحتوى الأصلي)'}
                </Txt>
                {r.reason ? (
                  <View style={styles.reasonBox}>
                    <Txt size={11.5} weight="semibold" color={colors.accentBrassMuted}>
                      سبب البلاغ
                    </Txt>
                    <Txt size={13} color={colors.textSlate} style={{ marginTop: 4, lineHeight: 21 }}>
                      {r.reason}
                    </Txt>
                  </View>
                ) : null}
                {status !== 'open' ? (
                  <View style={styles.statusBadge}>
                    <Txt size={10.5} weight="semibold" color={colors.textMuted}>
                      {r.status === 'reviewed' ? 'تمت المراجعة' : r.status === 'dismissed' ? 'متجاهلة' : 'مفتوحة'}
                    </Txt>
                  </View>
                ) : null}
                {r.status === 'open' ? (
                  <View style={styles.actionsRow}>
                    <ActionBtn icon="eye-off" label="إخفاء المحتوى" color={colors.stateDanger} onPress={() => setPendingHide(r)} />
                    {r.authorId ? (
                      <ActionBtn icon="slash" label="حظر الكاتب" color={colors.stateDanger} onPress={() => setPendingBan(r)} />
                    ) : null}
                    <ActionBtn icon="x-circle" label="تجاهل البلاغ" color={colors.textMuted} onPress={() => setPendingDismiss(r)} />
                  </View>
                ) : null}
              </Card>
            ))}
          </>
        )}
      </View>

      <ConfirmDialog
        visible={!!pendingHide}
        title="إخفاء المحتوى"
        message={
          pendingHide?.contentType === 'question'
            ? 'سيُخفى السؤال عن العامة (يمكن إظهاره لاحقاً من مساحة الأسئلة).'
            : 'ستُخفى الفائدة عن الجميع (يمكن إظهارها لاحقاً من مشاركات الدارسين).'
        }
        confirmLabel="إخفاء"
        pending={hideContent.isPending}
        onConfirm={() => {
          if (!pendingHide) return;
          hideContent.mutate(pendingHide, { onSettled: () => setPendingHide(null) });
        }}
        onCancel={() => setPendingHide(null)}
      />
      <ConfirmDialog
        visible={!!pendingBan}
        title="حظر الكاتب"
        message={`سيُحظر «${pendingBan?.authorName ?? ''}» من الدخول نهائياً ويُسجَّل خروجه فوراً (يمكن رفع الحظر من إدارة المستخدمين).`}
        confirmLabel="حظر"
        pending={banAuthor.isPending}
        onConfirm={() => {
          if (!pendingBan?.authorId) return;
          banAuthor.mutate(pendingBan.authorId, { onSettled: () => setPendingBan(null) });
        }}
        onCancel={() => setPendingBan(null)}
      />
      <ConfirmDialog
        visible={!!pendingDismiss}
        title="تجاهل البلاغ"
        message="سيُعلَّم هذا البلاغ متجاهلاً دون أي تأثير على المحتوى."
        confirmLabel="تجاهل"
        destructive={false}
        pending={setReportStatus.isPending}
        onConfirm={() => {
          if (!pendingDismiss) return;
          setReportStatus.mutate(
            { reportId: pendingDismiss.id, status: 'dismissed' },
            { onSettled: () => setPendingDismiss(null) },
          );
        }}
        onCancel={() => setPendingDismiss(null)}
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
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 } as ViewStyle,
  reasonBox: {
    marginTop: 10, padding: 10, borderRadius: radius.sm, backgroundColor: colors.bgSandRaised,
    borderWidth: 1, borderColor: colors.borderSand,
  } as ViewStyle,
  statusBadge: {
    alignSelf: 'flex-start', marginTop: 10, paddingVertical: 3, paddingHorizontal: 9,
    borderRadius: radius.pill, backgroundColor: colors.surfaceInset,
  } as ViewStyle,
  actionsRow: { flexDirection: 'row', gap: 14, marginTop: 12 } as ViewStyle,
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 } as ViewStyle,
  loadingBox: { paddingVertical: 40, alignItems: 'center' } as ViewStyle,
});
