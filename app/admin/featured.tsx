/**
 * Admin/publisher المختارات — /admin/featured (V8 Feature B).
 *
 * Curate the Home «مختارات» rail: add existing PUBLISHED lectures via the
 * searchable LecturePicker, reorder them with ▲/▼, and remove them. "التعديل"
 * here means REORDERING ONLY — a curated entry just points at an existing
 * lecture; editing that lecture's own content happens in its normal editor.
 * All writes are is_content_manager-gated DEFINER RPCs.
 */
import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import type { AdminFeaturedRow } from '@/api/featured';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { LecturePicker } from '@/components/admin/LecturePicker';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { arDuration, arNum } from '@/lib/format';
import {
  useAddFeatured,
  useAdminFeatured,
  useRemoveFeatured,
  useReorderFeatured,
} from '@/hooks/useFeatured';

function StatusBadge({ status }: { status: AdminFeaturedRow['status'] }) {
  if (status === 'published') return null;
  const label = status === 'unclassified' ? 'غير مصنّفة' : 'غير منشورة';
  return (
    <View style={styles.badge}>
      <Txt size={10} weight="semibold" color={colors.accentBrass}>
        {label} — لا تظهر في الرئيسية
      </Txt>
    </View>
  );
}

function FeaturedRow({
  item,
  index,
  count,
  onUp,
  onDown,
  onRemove,
}: {
  item: AdminFeaturedRow;
  index: number;
  count: number;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const isFirst = index === 0;
  const isLast = index === count - 1;
  return (
    <View style={styles.row}>
      {/* Reorder controls */}
      <View style={styles.reorder}>
        <Pressable
          onPress={onUp}
          disabled={isFirst}
          accessibilityLabel="تحريك لأعلى"
          style={({ pressed }) => [styles.reorderBtn, (pressed || isFirst) && { opacity: isFirst ? 0.25 : 0.6 }]}
        >
          <Feather name="chevron-up" size={18} color={colors.primaryTeal} />
        </Pressable>
        <Pressable
          onPress={onDown}
          disabled={isLast}
          accessibilityLabel="تحريك لأسفل"
          style={({ pressed }) => [styles.reorderBtn, (pressed || isLast) && { opacity: isLast ? 0.25 : 0.6 }]}
        >
          <Feather name="chevron-down" size={18} color={colors.primaryTeal} />
        </Pressable>
      </View>

      <View style={styles.bullet}>
        <Rhombus size={8} color={colors.accentBrass} filled />
      </View>

      <View style={{ flex: 1 }}>
        <Txt size={14} weight="semibold" color={colors.textInk} numberOfLines={1}>
          {item.title}
        </Txt>
        <Txt size={12} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
          {[item.sectionTitle, item.sheikhName].filter(Boolean).join(' · ') || 'غير مصنّف'}
        </Txt>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <Txt size={11} color={colors.textGhost} tabular>
            {arDuration(item.durationSec)}
          </Txt>
          <StatusBadge status={item.status} />
        </View>
      </View>

      <Pressable
        onPress={onRemove}
        accessibilityLabel="إزالة"
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
      >
        <Feather name="trash-2" size={15} color={colors.stateDanger} />
      </Pressable>
    </View>
  );
}

export default function FeaturedScreen() {
  const { data, isLoading } = useAdminFeatured();
  const add = useAddFeatured();
  const remove = useRemoveFeatured();
  const reorder = useReorderFeatured();

  // Client-held ordered copy so ▲/▼ update instantly; re-synced on refetch.
  const [items, setItems] = useState<AdminFeaturedRow[]>([]);
  useEffect(() => {
    if (data) setItems(data);
  }, [data]);

  const [pendingRemove, setPendingRemove] = useState<AdminFeaturedRow | null>(null);

  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j]!, next[index]!];
    setItems(next);
    reorder.mutate(next.map((it) => it.lectureId));
  }

  function onAdd(lectureId: string) {
    add.mutate(lectureId, {
      onError: (e) => Alert.alert('تعذّرت الإضافة', (e as Error).message),
    });
  }

  return (
    <AdminShell active="featured" breadcrumb="المختارات">
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        المختارات
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        {arNum(items.length)} محاضرة · تظهر في شريط «مختارات» على الصفحة الرئيسية بالترتيب أدناه.
        التعديل هنا هو إعادة الترتيب فقط — لتعديل محتوى المحاضرة استخدم محرّرها المعتاد.
      </Txt>

      <View style={{ marginBottom: 22 }}>
        <LecturePicker
          excludeIds={items.map((it) => it.lectureId)}
          onSelect={onAdd}
          disabled={add.isPending}
        />
      </View>

      {isLoading ? (
        <Card>
          <Txt size={13} color={colors.textGhost} align="center">
            جارٍ التحميل...
          </Txt>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <Txt size={13} color={colors.textMuted} align="center">
            لا مختارات بعد. أضِف أول محاضرة من الزر أعلاه.
          </Txt>
        </Card>
      ) : (
        <Card padded={false} style={styles.listCard}>
          {items.map((item, idx) => (
            <React.Fragment key={item.lectureId}>
              {idx > 0 ? <Divider /> : null}
              <FeaturedRow
                item={item}
                index={idx}
                count={items.length}
                onUp={() => move(idx, -1)}
                onDown={() => move(idx, 1)}
                onRemove={() => setPendingRemove(item)}
              />
            </React.Fragment>
          ))}
        </Card>
      )}

      <ConfirmDialog
        visible={!!pendingRemove}
        title="إزالة من المختارات"
        message={`ستُزال «${pendingRemove?.title ?? ''}» من شريط المختارات. لن تُحذف المحاضرة نفسها.`}
        confirmLabel="إزالة"
        pending={remove.isPending}
        onConfirm={() => {
          if (!pendingRemove) return;
          remove.mutate(pendingRemove.lectureId, {
            onSettled: () => setPendingRemove(null),
          });
        }}
        onCancel={() => setPendingRemove(null)}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 20, maxWidth: 700, lineHeight: 21 } as TextStyle,

  listCard: { overflow: 'hidden', maxWidth: 700 } as ViewStyle,

  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 60,
  } as ViewStyle,

  reorder: {
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  reorderBtn: {
    width: 30,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  } as ViewStyle,

  bullet: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(201,164,99,0.14)',
  } as ViewStyle,

  iconBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  } as ViewStyle,
});
