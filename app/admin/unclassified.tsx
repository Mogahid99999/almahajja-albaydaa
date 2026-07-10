/**
 * Admin unclassified queue screen — /admin/unclassified
 *
 * Lists lectures from useUnclassifiedLectures(). Each card lets the admin pick
 * a section (TreePicker), enter an order number, then "تصنيف ونشر" which calls:
 *   useClassifyLecture().mutate({ id, sectionId, order })
 *   useSetLectureStatus().mutate({ id, status: 'published' })
 *
 * Empty state: calm message "لا توجد محاضرات واردة".
 */
import Feather from '@expo/vector-icons/Feather';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { TreePicker } from '@/components/admin/TreePicker';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useClassifyLecture, useSetLectureStatus, useUnclassifiedLectures } from '@/hooks/useAdmin';
import { arDuration, arNum, toArabicDigits } from '@/lib/format';
import type { UnclassifiedItem } from '@/api/types';

// ─── Per-item row state ───────────────────────────────────────────────────────

interface ItemState {
  sectionId: string | null;
  order: string;
}

// ─── Single unclassified lecture card ────────────────────────────────────────

interface UnclassifiedCardProps {
  item: UnclassifiedItem;
  onClassify: (sectionId: string, order: number) => void;
  isPending: boolean;
}

function UnclassifiedCard({ item, onClassify, isPending }: UnclassifiedCardProps) {
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [order, setOrder] = useState('');
  const [orderFocused, setOrderFocused] = useState(false);

  const canSubmit = !!sectionId && !isPending;

  return (
    <Card style={styles.itemCard}>
      {/* Header row */}
      <View style={styles.itemHeader}>
        <View style={{ flex: 1 }}>
          <Txt weight="semibold" size={14} color={colors.textInk} numberOfLines={2}>
            {item.title}
          </Txt>
          <View style={styles.itemMeta}>
            {item.sheikhName && (
              <>
                <Rhombus size={5} color={colors.accentBrassMuted} />
                <Txt size={12} color={colors.textMuted} style={{ marginRight: 4 }}>
                  {item.sheikhName}
                </Txt>
              </>
            )}
            {item.durationSec > 0 && (
              <Txt size={12} color={colors.textGhost} tabular>
                {arDuration(item.durationSec)}
              </Txt>
            )}
          </View>
        </View>
        <View style={styles.incomingBadge}>
          <Txt size={11} color={colors.accentBrassMuted} weight="semibold">
            واردة
          </Txt>
        </View>
      </View>

      <Divider />

      {/* Classification form */}
      <View style={styles.classifyForm}>
        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
          القسم الأب
        </Txt>
        <TreePicker value={sectionId} onChange={setSectionId} label="اختر القسم..." />

        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
          رقم الترتيب
        </Txt>
        <TextInput
          value={order}
          onChangeText={(t) => setOrder(t.replace(/[^0-9]/g, ''))}
          placeholder={toArabicDigits('1')}
          placeholderTextColor={colors.textGhost}
          keyboardType="numeric"
          textAlign="center"
          onFocus={() => setOrderFocused(true)}
          onBlur={() => setOrderFocused(false)}
          style={[styles.orderInput, orderFocused && styles.inputFocused]}
        />

        <Pressable
          onPress={() => {
            if (!sectionId) return;
            onClassify(sectionId, order ? Number(order) : 0);
          }}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.classifyBtn,
            { opacity: !canSubmit || pressed ? 0.55 : 1 },
          ]}
        >
          <Feather name="check" size={16} color={colors.onTealPrimary} style={{ marginLeft: 8 }} />
          <Txt weight="semibold" size={13} color={colors.onTealPrimary}>
            تصنيف ونشر
          </Txt>
        </Pressable>
      </View>
    </Card>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function UnclassifiedScreen() {
  const { data: items = [], isLoading } = useUnclassifiedLectures();
  const classifyLecture = useClassifyLecture();
  const setLectureStatus = useSetLectureStatus();

  // Track which IDs are being processed (to disable their button)
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  // Classifying here always publishes immediately (no draft option in this
  // queue) — confirm first since that fans out a push notification to every
  // opted-in student.
  const [pendingClassify, setPendingClassify] = useState<{
    id: string;
    title: string;
    sectionId: string;
    order: number;
  } | null>(null);

  function runClassify(id: string, sectionId: string, order: number) {
    setProcessing((prev) => new Set(prev).add(id));
    classifyLecture.mutate(
      { id, sectionId, order },
      {
        onSuccess: () => {
          setLectureStatus.mutate({ id, status: 'published' });
        },
        onSettled: () => {
          setProcessing((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        },
      },
    );
  }

  return (
    <AdminShell active="unclassified" breadcrumb="المحاضرات الواردة">
      {/* Page heading */}
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        المحاضرات الواردة
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        {isLoading
          ? 'جارٍ التحميل...'
          : items.length === 0
          ? 'القائمة فارغة'
          : `${arNum(items.length)} محاضرة تنتظر التصنيف والنشر`}
      </Txt>

      {/* Loading */}
      {isLoading && (
        <Card>
          <Txt size={13} color={colors.textGhost} align="center">
            جارٍ تحميل المحاضرات الواردة...
          </Txt>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && items.length === 0 && (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Feather name="inbox" size={32} color={colors.textGhost} />
          </View>
          <Txt weight="semibold" size={15} color={colors.textMuted} style={{ marginTop: 14 }}>
            لا توجد محاضرات واردة
          </Txt>
          <Txt size={13} color={colors.textGhost} align="center" style={{ marginTop: 6, maxWidth: 300 }}>
            ستظهر هنا المحاضرات التي ترفعها يدوياً أو التي يرسلها البوت تلقائياً.
          </Txt>
        </View>
      )}

      {/* List */}
      {!isLoading && items.length > 0 && (
        <View style={styles.list}>
          {items.map((item) => (
            <UnclassifiedCard
              key={item.id}
              item={item}
              isPending={processing.has(item.id)}
              onClassify={(sectionId, order) =>
                setPendingClassify({ id: item.id, title: item.title, sectionId, order })
              }
            />
          ))}
        </View>
      )}

      <ConfirmDialog
        visible={!!pendingClassify}
        destructive={false}
        title="نشر المحاضرة؟"
        message={`سيصل إشعار فوري إلى جميع الدارسين بأن «${pendingClassify?.title ?? ''}» متاحة الآن.`}
        confirmLabel="تصنيف ونشر"
        cancelLabel="تراجع"
        pending={pendingClassify ? processing.has(pendingClassify.id) : false}
        onConfirm={() => {
          if (!pendingClassify) return;
          runClassify(pendingClassify.id, pendingClassify.sectionId, pendingClassify.order);
          setPendingClassify(null);
        }}
        onCancel={() => setPendingClassify(null)}
      />
    </AdminShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pageTitle: {
    marginBottom: 4,
  } as ViewStyle,

  pageSubtitle: {
    marginBottom: 24,
  } as ViewStyle,

  list: {
    gap: 16,
  } as ViewStyle,

  itemCard: {
    gap: 0,
    maxWidth: 700,
  } as ViewStyle,

  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingBottom: 14,
  } as ViewStyle,

  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
  } as ViewStyle,

  incomingBadge: {
    backgroundColor: 'rgba(176,137,79,0.12)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 10,
  } as ViewStyle,

  classifyForm: {
    paddingTop: 14,
    gap: 0,
  } as ViewStyle,

  fieldLabel: {
    marginBottom: 8,
    marginTop: 12,
  } as ViewStyle,

  orderInput: {
    height: 44,
    width: 140,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textInk,
    textAlign: 'center',
  },

  inputFocused: {
    borderColor: colors.primaryTeal600,
    ...shadows.subtle,
  },

  classifyBtn: {
    marginTop: 18,
    backgroundColor: colors.primaryTeal,
    height: 44,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    ...shadows.button,
  } as ViewStyle,

  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  } as ViewStyle,

  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceInset,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
});
