/**
 * Admin lectures management — /admin/lectures
 *
 * The screen that was missing: lists ALL lectures (any status) so DRAFTS and
 * unclassified uploads stop "disappearing" (PLAN_ADMIN_FIXES #4/#5/#6/#9).
 *   - Status filter: الكل / منشورة / مسودة / واردة.
 *   - Inline play (reuses the global audio controller — works on web).
 *   - Publish / unpublish.
 *   - Inline edit (title / section / sheikh / order / publish).
 *   - Delete (with confirmation; removes audio from storage too).
 */
import { Feather } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { AdminLectureRow } from '@/api/types';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { PublishToggle } from '@/components/admin/PublishToggle';
import { TreePicker } from '@/components/admin/TreePicker';
import { Card, Divider, Txt, cardRowStyle } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import type { AppLectureStatus } from '@/config';
import {
  useAdminLectures,
  useDeleteLecture,
  useSetLectureStatus,
  useSheikhs,
  useUpdateLecture,
} from '@/hooks/useAdmin';
import { playLecture } from '@/lib/audioController';
import { arDuration, arNum, toArabicDigits } from '@/lib/format';
import { usePlayerStore } from '@/stores/playerStore';

type StatusFilter = 'all' | AppLectureStatus;

const STATUS_META: Record<AppLectureStatus, { label: string; color: string; bg: string }> = {
  published: { label: 'منشورة', color: colors.stateSuccess, bg: 'rgba(31,138,91,0.1)' },
  draft: { label: 'مسودة', color: colors.accentBrassMuted, bg: 'rgba(176,137,79,0.12)' },
  unclassified: { label: 'واردة', color: colors.textSlate, bg: colors.surfaceInset },
};

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'published', label: 'منشورة' },
  { key: 'draft', label: 'مسودة' },
  { key: 'unclassified', label: 'واردة' },
];

// ─── Sheikh chip selector ─────────────────────────────────────────────────────

function SheikhChips({
  sheikhs,
  value,
  onChange,
}: {
  sheikhs: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <View style={styles.chipRow}>
      <Pressable
        onPress={() => onChange(null)}
        style={[styles.chip, value === null && styles.chipActive]}
      >
        <Txt size={12} weight="medium" color={value === null ? colors.onTealPrimary : colors.textMuted}>
          بدون شيخ
        </Txt>
      </Pressable>
      {sheikhs.map((s) => {
        const active = s.id === value;
        return (
          <Pressable
            key={s.id}
            onPress={() => onChange(s.id)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Txt size={12} weight="medium" color={active ? colors.onTealPrimary : colors.textMuted}>
              {s.name}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Inline editor ────────────────────────────────────────────────────────────

function LectureEditor({
  row,
  sheikhs,
  pending,
  onSave,
  onCancel,
}: {
  row: AdminLectureRow;
  sheikhs: { id: string; name: string }[];
  pending: boolean;
  onSave: (input: {
    title: string;
    sectionId: string | null;
    sheikhId: string | null;
    order: number;
    status: AppLectureStatus;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(row.title);
  const [sectionId, setSectionId] = useState<string | null>(row.sectionId);
  const [sheikhId, setSheikhId] = useState<string | null>(row.sheikhId);
  const [order, setOrder] = useState(String(row.order ?? 0));
  const [pubStatus, setPubStatus] = useState<'draft' | 'published'>(
    row.status === 'published' ? 'published' : 'draft',
  );

  function save() {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      sectionId,
      sheikhId,
      order: order ? Number(order) : 0,
      // No section ⇒ the lecture stays in the "واردة" review queue.
      status: sectionId ? pubStatus : 'unclassified',
    });
  }

  return (
    <View style={styles.editor}>
      <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
        عنوان المحاضرة
      </Txt>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="عنوان المحاضرة..."
        placeholderTextColor={colors.textGhost}
        textAlign="right"
        style={styles.input}
      />

      <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
        القسم
      </Txt>
      <TreePicker value={sectionId} onChange={setSectionId} allowNull label="— بدون قسم (واردة) —" />

      <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
        الشيخ
      </Txt>
      <SheikhChips sheikhs={sheikhs} value={sheikhId} onChange={setSheikhId} />

      <View style={styles.editorTwoCol}>
        <View style={{ width: 130 }}>
          <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
            رقم الترتيب
          </Txt>
          <TextInput
            value={order}
            onChangeText={(t) => setOrder(t.replace(/[^0-9]/g, ''))}
            placeholder={toArabicDigits('1')}
            placeholderTextColor={colors.textGhost}
            keyboardType="numeric"
            textAlign="center"
            style={[styles.input, styles.orderInput]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
            حالة النشر
          </Txt>
          {sectionId ? (
            <PublishToggle value={pubStatus} onChange={setPubStatus} />
          ) : (
            <View style={styles.unclassifiedNote}>
              <Feather name="inbox" size={14} color={colors.textMuted} style={{ marginLeft: 8 }} />
              <Txt size={12} color={colors.textMuted} style={{ flex: 1 }}>
                اختر قسماً لتتمكن من نشر المحاضرة. بدون قسم تبقى في قائمة الواردة.
              </Txt>
            </View>
          )}
        </View>
      </View>

      <View style={styles.editorActions}>
        <Pressable
          onPress={save}
          disabled={pending || !title.trim()}
          style={({ pressed }) => [
            styles.saveBtn,
            { opacity: pressed || pending || !title.trim() ? 0.6 : 1 },
          ]}
        >
          <Feather name="check" size={15} color={colors.onTealPrimary} style={{ marginLeft: 6 }} />
          <Txt weight="semibold" size={13} color={colors.onTealPrimary}>
            حفظ التعديلات
          </Txt>
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
        >
          <Txt weight="semibold" size={13} color={colors.textMuted}>
            إلغاء
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Lecture row ──────────────────────────────────────────────────────────────

function LectureRow({
  row,
  isCurrent,
  isPlaying,
  isEditing,
  onPlay,
  onTogglePublish,
  onEdit,
  onDelete,
}: {
  row: AdminLectureRow;
  isCurrent: boolean;
  isPlaying: boolean;
  isEditing: boolean;
  onPlay: () => void;
  onTogglePublish: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const meta = STATUS_META[row.status];
  const canTogglePublish = row.status !== 'unclassified';

  return (
    <View style={styles.row}>
      {/* Play */}
      <Pressable
        onPress={onPlay}
        accessibilityLabel={isCurrent && isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
        style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.7 }]}
      >
        <Feather
          name={isCurrent && isPlaying ? 'pause' : 'play'}
          size={15}
          color={colors.onTealPrimary}
        />
      </Pressable>

      {/* Title + meta */}
      <View style={{ flex: 1 }}>
        <Txt size={13} weight="semibold" color={colors.textInk} numberOfLines={1}>
          {row.title}
        </Txt>
        <View style={styles.rowMeta}>
          {row.sectionTitle ? (
            <Txt size={12} color={colors.textMuted} numberOfLines={1}>
              {row.sectionTitle}
            </Txt>
          ) : (
            <Txt size={12} color={colors.textGhost}>غير مصنّفة</Txt>
          )}
          {row.sheikhName ? (
            <>
              <Txt size={12} color={colors.textGhost}> · </Txt>
              <Txt size={12} color={colors.textMuted} numberOfLines={1}>
                {row.sheikhName}
              </Txt>
            </>
          ) : null}
        </View>
      </View>

      {/* Duration */}
      <Txt size={12} color={colors.textGhost} tabular style={styles.duration}>
        {row.durationSec > 0 ? arDuration(row.durationSec) : '—'}
      </Txt>

      {/* Status badge */}
      <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
        <Txt size={11} weight="semibold" color={meta.color}>
          {meta.label}
        </Txt>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {canTogglePublish ? (
          <Pressable
            onPress={onTogglePublish}
            accessibilityLabel={row.status === 'published' ? 'إلغاء النشر' : 'نشر'}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
          >
            <Feather
              name={row.status === 'published' ? 'eye-off' : 'upload-cloud'}
              size={16}
              color={row.status === 'published' ? colors.accentBrassMuted : colors.stateSuccess}
            />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onEdit}
          accessibilityLabel="تعديل"
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <Feather name={isEditing ? 'x' : 'edit-2'} size={15} color={colors.primaryTeal} />
        </Pressable>
        <Pressable
          onPress={onDelete}
          accessibilityLabel="حذف"
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <Feather name="trash-2" size={15} color={colors.stateDanger} />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LecturesScreen() {
  const { data: lectures = [], isLoading } = useAdminLectures();
  const { data: sheikhs = [] } = useSheikhs();
  const setStatus = useSetLectureStatus();
  const updateLecture = useUpdateLecture();
  const deleteLecture = useDeleteLecture();

  const currentLectureId = usePlayerStore((s) => s.currentLectureId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [filter, setFilter] = useState<StatusFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminLectureRow | null>(null);
  // A confirm step before any action that would newly PUBLISH a lecture — that
  // fans out a real push notification to every opted-in student immediately.
  // Re-saving an already-published lecture (status staying 'published') never
  // re-notifies (the DB trigger only fires on a draft/unclassified → published
  // transition), so this only guards the actual transition.
  const [pendingPublish, setPendingPublish] = useState<
    | { kind: 'toggle'; row: AdminLectureRow }
    | {
        kind: 'edit';
        row: AdminLectureRow;
        input: { title: string; sectionId: string | null; sheikhId: string | null; order: number; status: AppLectureStatus };
      }
    | null
  >(null);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: lectures.length,
      published: 0,
      draft: 0,
      unclassified: 0,
    };
    for (const l of lectures) c[l.status] += 1;
    return c;
  }, [lectures]);

  const filtered = useMemo(
    () => (filter === 'all' ? lectures : lectures.filter((l) => l.status === filter)),
    [lectures, filter],
  );

  function handleTogglePublish(row: AdminLectureRow) {
    if (row.status !== 'published') {
      setPendingPublish({ kind: 'toggle', row });
      return;
    }
    setStatus.mutate({ id: row.id, status: 'draft' });
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    deleteLecture.mutate(id, {
      onSettled: () => setPendingDelete(null),
    });
    if (editingId === id) setEditingId(null);
  }

  const renderItem = useCallback(
    ({ item: row, index }: { item: AdminLectureRow; index: number }) => (
      <View style={[cardRowStyle(index === 0, index === filtered.length - 1), { maxWidth: 860 }]}>
        <LectureRow
          row={row}
          isCurrent={currentLectureId === row.id}
          isPlaying={isPlaying}
          isEditing={editingId === row.id}
          onPlay={() => void playLecture(row.id)}
          onTogglePublish={() => handleTogglePublish(row)}
          onEdit={() => setEditingId((cur) => (cur === row.id ? null : row.id))}
          onDelete={() => setPendingDelete(row)}
        />
        {editingId === row.id ? (
          <LectureEditor
            row={row}
            sheikhs={sheikhs}
            pending={updateLecture.isPending}
            onSave={(input) => {
              if (input.status === 'published' && row.status !== 'published') {
                setPendingPublish({ kind: 'edit', row, input });
                return;
              }
              updateLecture.mutate({ id: row.id, input }, { onSuccess: () => setEditingId(null) });
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : null}
      </View>
    ),
    [filtered.length, currentLectureId, isPlaying, editingId, sheikhs, updateLecture],
  );

  const separator = useCallback(
    () => (
      <View style={{ maxWidth: 860 }}>
        <Divider />
      </View>
    ),
    [],
  );

  const header = (
    <>
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        المحاضرات
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        كل المحاضرات — المنشورة والمسودات والواردة. شغّل، انشر، عدّل أو احذف.
      </Txt>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Txt size={13} weight="semibold" color={active ? colors.onTealPrimary : colors.textMuted}>
                {f.label}
              </Txt>
              <View style={[styles.filterCount, active && styles.filterCountActive]}>
                <Txt size={11} weight="semibold" color={active ? colors.onTealPrimary : colors.textGhost} tabular>
                  {arNum(counts[f.key])}
                </Txt>
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );

  return (
    <AdminShell active="lectures" breadcrumb="المحاضرات" scroll={false}>
      <FlatList
        style={{ flex: 1 }}
        data={filtered}
        keyExtractor={(row) => row.id}
        renderItem={renderItem}
        ItemSeparatorComponent={separator}
        initialNumToRender={10}
        ListHeaderComponent={header}
        ListEmptyComponent={
          isLoading ? (
            <Card>
              <Txt size={13} color={colors.textGhost} align="center">جارٍ التحميل...</Txt>
            </Card>
          ) : (
            <Card>
              <Txt size={13} color={colors.textMuted} align="center">لا توجد محاضرات في هذا التصنيف.</Txt>
            </Card>
          )
        }
      />

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف المحاضرة"
        message={`سيتم حذف «${pendingDelete?.title ?? ''}» نهائياً مع ملفها الصوتي وأي تقدّم أو مرفقات مرتبطة بها. لا يمكن التراجع.`}
        confirmLabel="حذف المحاضرة"
        pending={deleteLecture.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        visible={!!pendingPublish}
        destructive={false}
        title="نشر المحاضرة؟"
        message={`سيصل إشعار فوري إلى جميع الدارسين بأن «${pendingPublish?.row.title ?? ''}» متاحة الآن.`}
        confirmLabel="نشر"
        cancelLabel="تراجع"
        pending={setStatus.isPending || updateLecture.isPending}
        onConfirm={() => {
          if (!pendingPublish) return;
          if (pendingPublish.kind === 'toggle') {
            setStatus.mutate(
              { id: pendingPublish.row.id, status: 'published' },
              { onSettled: () => setPendingPublish(null) },
            );
          } else {
            updateLecture.mutate(
              { id: pendingPublish.row.id, input: pendingPublish.input },
              {
                onSuccess: () => setEditingId(null),
                onSettled: () => setPendingPublish(null),
              },
            );
          }
        }}
        onCancel={() => setPendingPublish(null)}
      />
    </AdminShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 22 } as TextStyle,

  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
    flexWrap: 'wrap',
  } as ViewStyle,

  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,

  filterChipActive: {
    backgroundColor: colors.primaryTeal,
    borderColor: colors.primaryTeal,
  } as ViewStyle,

  filterCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.surfaceInset,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  filterCountActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  } as ViewStyle,

  listCard: {
    overflow: 'hidden',
    maxWidth: 860,
  } as ViewStyle,

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  } as ViewStyle,

  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  } as ViewStyle,

  duration: {
    width: 52,
    textAlign: 'left',
  } as TextStyle,

  statusBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 56,
    alignItems: 'center',
  } as ViewStyle,

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  } as ViewStyle,

  iconBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  } as ViewStyle,

  // ── Editor ──
  editor: {
    backgroundColor: colors.bgSandRaised,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.borderHair,
  } as ViewStyle,

  label: {
    marginBottom: 8,
    marginTop: 14,
  } as TextStyle,

  input: {
    height: 44,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
  },

  orderInput: {
    width: 130,
    textAlign: 'center',
    fontSize: 16,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  } as ViewStyle,

  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,

  chipActive: {
    backgroundColor: colors.primaryTeal,
    borderColor: colors.primaryTeal,
  } as ViewStyle,

  editorTwoCol: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
    marginTop: 4,
  } as ViewStyle,

  unclassifiedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceInset,
    borderRadius: radius.sm,
    padding: 10,
    minHeight: 44,
  } as ViewStyle,

  editorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  } as ViewStyle,

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,

  cancelBtn: {
    height: 42,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
});
