/**
 * تقييمات التطبيق — admin inbox for the star-rating prompt (migration 0065/0066).
 * Same visual/structural pattern as app/admin/feedback.tsx, simplified (no
 * triage status — just a list + delete).
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import type { AdminRatingRow } from '@/api/ratings';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useAdminDeleteRating, useAdminRatings } from '@/hooks/useRatings';
import { useAdminRatingsSummary } from '@/hooks/useAdminStats';
import { arNum, arSince, toArabicDigits } from '@/lib/format';

function Stars({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Feather
          key={i}
          name="star"
          size={14}
          color={i <= count ? colors.accentBrass : colors.borderSand2}
        />
      ))}
    </View>
  );
}

export default function AdminRatingsScreen() {
  const { data: rows, isLoading } = useAdminRatings();
  const { data: summary } = useAdminRatingsSummary();
  const deleteRating = useAdminDeleteRating();
  const [pendingDelete, setPendingDelete] = useState<AdminRatingRow | null>(null);

  const avgLabel =
    summary && summary.totalRatings > 0
      ? toArabicDigits(summary.avgStars.toFixed(1).replace('.', '٫'))
      : '—';

  return (
    <AdminShell active="ratings" breadcrumb="تقييمات التطبيق">
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        تقييمات التطبيق
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        تقييمات الطلاب للتطبيق نفسه (ليست تقييمات الدروس)
      </Txt>

      <Card style={styles.summaryCard}>
        <Stars count={Math.round(summary?.avgStars ?? 0)} />
        <Txt weight="display" size={20} color={colors.primaryTeal}>
          {avgLabel}
        </Txt>
        <Txt size={12.5} color={colors.textMuted}>
          {summary ? `${arNum(summary.totalRatings)} تقييمًا` : '—'}
        </Txt>
      </Card>

      <View style={{ maxWidth: 860 }}>
        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primaryTeal} />
          </View>
        ) : (rows ?? []).length === 0 ? (
          <Card>
            <Txt size={13} color={colors.textMuted} align="center">
              لا تقييمات بعد.
            </Txt>
          </Card>
        ) : (
          (rows ?? []).map((r) => (
            <Card key={r.id} style={styles.itemCard}>
              <View style={styles.metaRow}>
                <Stars count={r.stars} />
                <View style={{ flex: 1 }} />
                <Feather name={r.userName ? 'user' : 'user-x'} size={13} color={colors.textGhost} />
                <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1}>
                  {r.userName ?? 'زائر'}
                </Txt>
                <Txt size={11.5} color={colors.textGhost}>
                  {arSince(r.createdAt)}
                </Txt>
              </View>

              {r.message ? (
                <Txt size={14} color={colors.textInk} style={{ marginTop: 8, lineHeight: 23 }}>
                  {r.message}
                </Txt>
              ) : null}

              <View style={styles.actionsRow}>
                <Pressable
                  onPress={() => setPendingDelete(r)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                >
                  <Feather name="trash-2" size={13} color={colors.stateDanger} />
                  <Txt size={12} weight="medium" color={colors.stateDanger}>
                    حذف
                  </Txt>
                </Pressable>
              </View>
            </Card>
          ))
        )}
      </View>

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف التقييم"
        message="سيُحذف هذا التقييم نهائياً ولا يمكن التراجع."
        confirmLabel="حذف"
        pending={deleteRating.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteRating.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 22 } as TextStyle,
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'flex-start',
    marginBottom: 22,
  } as ViewStyle,
  itemCard: { marginBottom: 12 } as ViewStyle,
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 } as ViewStyle,
  actionsRow: { flexDirection: 'row', gap: 14, marginTop: 12 } as ViewStyle,
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 } as ViewStyle,
  loadingBox: { paddingVertical: 40, alignItems: 'center' } as ViewStyle,
});
