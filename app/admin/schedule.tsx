/**
 * /admin/schedule — «الجدول الأسبوعي» (0158). Every moderator (admin ·
 * publisher · sheikh) edits it: add / edit / hide / delete a weekly lesson, and
 * change ONE date of a lesson alone — cancel it, postpone it, or move its time
 * that day — with an undo («تراجع») per change. RLS (can_edit_schedule) is the
 * gate; each save bumps app_config.schedule_version, so students' app_open
 * picks the new schedule up on their next open — nobody polls.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import type { Schedule, ScheduleItem } from '@/api/schedule';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DateChangeForm, ScheduleItemForm } from '@/components/admin/schedule/ScheduleForms';
import {
  ADMIN_SCHEDULE_COPY,
  AUDIENCE_LABEL,
  exceptionLine,
  sortForAdmin,
  upcomingExceptions,
} from '@/components/admin/schedule/scheduleAdminUi';
import { Card, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import {
  useDeleteScheduleException,
  useDeleteScheduleItem,
  useSchedule,
  useSetScheduleItemActive,
} from '@/hooks/useSchedule';
import { arNum } from '@/lib/format';
import { staffErrorText } from '@/lib/errorText';
import { arClockLine, arDaysLabel, meccaToday } from '@/lib/schedule';

function ActionBtn({
  icon,
  label,
  onPress,
  danger,
  disabled,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.actionBtn, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={14} color={danger ? colors.stateDanger : colors.primaryTeal} />
      <Txt size={12.5} weight="semibold" color={danger ? colors.stateDanger : colors.primaryTeal}>
        {label}
      </Txt>
    </Pressable>
  );
}

function ItemCard({
  item,
  schedule,
  today,
  onEdit,
  onDelete,
}: {
  item: ScheduleItem;
  schedule: Schedule;
  today: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const setActive = useSetScheduleItemActive();
  const undo = useDeleteScheduleException();
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  const changes = upcomingExceptions(schedule, item.id, today);
  const meta = [
    item.sheikhName,
    `${arDaysLabel(item.days)} · ${arClockLine(item.startTime)}`,
    item.audience !== 'all' ? AUDIENCE_LABEL[item.audience] : null,
    item.sectionTitle ? `القسم: ${item.sectionTitle}` : null,
  ].filter(Boolean);

  return (
    <Card style={{ ...styles.itemCard, opacity: item.isActive ? 1 : 0.75 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Txt size={15.5} weight="bold" color={colors.textInk} style={{ flexShrink: 1 }}>
          {item.title}
        </Txt>
        {!item.isActive ? (
          <View style={styles.hiddenPill}>
            <Txt size={11.5} weight="semibold" color={colors.textSlate}>
              {ADMIN_SCHEDULE_COPY.hidden}
            </Txt>
          </View>
        ) : null}
      </View>
      {item.subtitle ? (
        <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }}>
          {item.subtitle}
        </Txt>
      ) : null}
      <Txt size={13} color={colors.textSlate} style={{ marginTop: 6, lineHeight: 21 }}>
        {meta.join(' · ')}
      </Txt>
      {item.note ? (
        <Txt size={12} color={colors.textFaint} style={{ marginTop: 2 }}>
          {item.note}
        </Txt>
      ) : null}

      <View style={styles.actionsRow}>
        <ActionBtn icon="edit-2" label={ADMIN_SCHEDULE_COPY.edit} onPress={onEdit} />
        <ActionBtn icon="calendar" label={ADMIN_SCHEDULE_COPY.changeDay} onPress={() => setChanging((v) => !v)} />
        <ActionBtn
          icon={item.isActive ? 'eye-off' : 'eye'}
          label={item.isActive ? ADMIN_SCHEDULE_COPY.hide : ADMIN_SCHEDULE_COPY.show}
          disabled={setActive.isPending}
          onPress={() =>
            setActive.mutate(
              { id: item.id, isActive: !item.isActive },
              { onError: (e) => setError(staffErrorText(e, 'تعذّر الحفظ.')) },
            )
          }
        />
        <ActionBtn icon="trash-2" label={ADMIN_SCHEDULE_COPY.remove} danger onPress={onDelete} />
      </View>

      {changing ? (
        <DateChangeForm item={item} schedule={schedule} today={today} onDone={() => setChanging(false)} />
      ) : null}

      {changes.length > 0 ? (
        <View style={styles.changesBox}>
          <Txt size={12.5} weight="semibold" color={colors.textSlate}>
            {ADMIN_SCHEDULE_COPY.changes}
          </Txt>
          {changes.map((e) => (
            <View key={e.id} style={styles.changeRow}>
              <Feather
                name={e.kind === 'cancelled' ? 'x-circle' : 'clock'}
                size={14}
                color={e.kind === 'cancelled' ? colors.stateDanger : colors.accentBrassMuted}
              />
              <Txt size={12.5} color={colors.textInk} style={{ flex: 1 }}>
                {exceptionLine(e, item)}
              </Txt>
              <Pressable
                onPress={() => undo.mutate(e.id, { onError: (err) => setError(staffErrorText(err, 'تعذّر التراجع.')) })}
                disabled={undo.isPending}
                accessibilityRole="button"
                accessibilityLabel={`${ADMIN_SCHEDULE_COPY.undo} — ${exceptionLine(e, item)}`}
                style={({ pressed }) => [styles.undoBtn, (pressed || undo.isPending) && { opacity: 0.6 }]}
              >
                <Txt size={12} weight="semibold" color={colors.primaryTeal600}>
                  {ADMIN_SCHEDULE_COPY.undo}
                </Txt>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {error ? (
        <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
          {error}
        </Txt>
      ) : null}
    </Card>
  );
}

export default function AdminScheduleScreen() {
  const { data, isLoading, isFetching, refetch } = useSchedule();
  const remove = useDeleteScheduleItem();
  // null = no form; 'new' = the add form; an id = that lesson's edit form (in place).
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduleItem | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const today = meccaToday(Date.now()).date;
  const items = sortForAdmin(data?.items ?? []);

  return (
    <AdminShell
      active="schedule"
      breadcrumb={ADMIN_SCHEDULE_COPY.title}
      refreshing={isFetching && !isLoading}
      onRefresh={() => void refetch()}
    >
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        {ADMIN_SCHEDULE_COPY.title}
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        {`${arNum(items.length)} درس · الأوقات بتوقيت مكة المكرمة · يعدّله جميع المشرفين`}
      </Txt>

      {editing === 'new' ? (
        <ScheduleItemForm item={null} onDone={() => setEditing(null)} />
      ) : (
        <Pressable
          onPress={() => setEditing('new')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}
        >
          <Feather name="plus" size={16} color={colors.onTealPrimary} />
          <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
            {ADMIN_SCHEDULE_COPY.add}
          </Txt>
        </Pressable>
      )}

      {deleteError ? (
        <Txt size={12.5} color={colors.stateDanger} style={{ marginBottom: 12 }}>
          {deleteError}
        </Txt>
      ) : null}

      {isLoading && !data ? (
        <Card style={styles.listCard}>
          <Txt size={13} color={colors.textGhost} align="center">
            جارٍ التحميل...
          </Txt>
        </Card>
      ) : items.length === 0 ? (
        <Card style={styles.listCard}>
          <Txt size={13} color={colors.textMuted} align="center">
            {ADMIN_SCHEDULE_COPY.empty}
          </Txt>
        </Card>
      ) : (
        <View style={{ gap: 12, maxWidth: 760 }}>
          {items.map((item) =>
            editing === item.id ? (
              <ScheduleItemForm key={item.id} item={item} onDone={() => setEditing(null)} />
            ) : (
              <ItemCard
                key={item.id}
                item={item}
                schedule={data!}
                today={today}
                onEdit={() => setEditing(item.id)}
                onDelete={() => setPendingDelete(item)}
              />
            ),
          )}
        </View>
      )}

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف الدرس من الجدول"
        message={
          pendingDelete
            ? `سيُحذف «${pendingDelete.title}» من الجدول مع تغييرات أيامه. للإيقاف المؤقت استعمل «إخفاء» بدلاً من ذلك.`
            : ''
        }
        pending={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          setDeleteError('');
          remove.mutate(target.id, {
            onSuccess: () => setPendingDelete(null),
            onError: (e) => {
              setPendingDelete(null);
              setDeleteError(staffErrorText(e, 'تعذّر الحذف.'));
            },
          });
        }}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 20 } as TextStyle,
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    height: 44,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    marginBottom: 20,
  } as ViewStyle,
  listCard: { maxWidth: 760 } as ViewStyle,
  itemCard: { maxWidth: 760 } as ViewStyle,
  hiddenPill: {
    backgroundColor: colors.surfaceInset,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
  } as ViewStyle,
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 } as ViewStyle,
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,
  changesBox: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: colors.borderSand,
    gap: 8,
  } as ViewStyle,
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 } as ViewStyle,
  undoBtn: { paddingHorizontal: 10, paddingVertical: 4 } as ViewStyle,
});
