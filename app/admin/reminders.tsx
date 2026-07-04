/**
 * Admin/publisher التذكيرات النافعة — /admin/reminders (V7 feature).
 *
 * Create + list + edit + delete broadcast reminders (virtuous seasons/sunan).
 * Creating one immediately pushes a `beneficial_reminder` to every student
 * (server fan-out in create_broadcast); «إظهار كبطاقة في الرئيسية» also pins it
 * on Home for one day. Editing updates the detail page (already-sent inbox rows
 * keep their wording); deleting soft-deletes and clears the inbox rows.
 */
import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { Broadcast } from '@/api/broadcasts';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import {
  useAdminBroadcasts,
  useCreateBroadcast,
  useDeleteBroadcast,
  useUpdateBroadcast,
} from '@/hooks/useBroadcasts';
import { arNum } from '@/lib/format';

/** "٤ تموز ٢٠٢٦" style short Arabic date for the list rows. */
function shortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long', year: 'numeric' }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
}

function BroadcastRow({
  broadcast,
  onEdit,
  onDelete,
}: {
  broadcast: Broadcast;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.bullet}>
        <Rhombus size={8} color={colors.accentBrass} filled={broadcast.showOnHome} />
      </View>

      <View style={{ flex: 1 }}>
        <Txt size={14} weight="semibold" color={colors.textInk} numberOfLines={1}>
          {broadcast.title}
        </Txt>
        <Txt size={12} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
          {broadcast.body}
        </Txt>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <Txt size={11} color={colors.textGhost}>
            {shortDate(broadcast.publishedAt)}
          </Txt>
          {broadcast.showOnHome ? (
            <View style={styles.homeChip}>
              <Txt size={10} weight="semibold" color={colors.accentBrass}>
                بطاقة في الرئيسية
              </Txt>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onEdit}
          accessibilityLabel="تعديل"
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <Feather name="edit-2" size={15} color={colors.primaryTeal} />
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

export default function RemindersScreen() {
  const { data: broadcasts = [], isLoading } = useAdminBroadcasts();
  const create = useCreateBroadcast();
  const update = useUpdateBroadcast();
  const remove = useDeleteBroadcast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [showOnHome, setShowOnHome] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Broadcast | null>(null);

  const pending = create.isPending || update.isPending;

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setBody('');
    setShowOnHome(true);
    setError('');
  }

  function startEdit(b: Broadcast) {
    setEditingId(b.id);
    setTitle(b.title);
    setBody(b.body);
    setShowOnHome(b.showOnHome);
    setError('');
    setNotice('');
  }

  function submit() {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      setError('أكمل العنوان ونص التذكير.');
      return;
    }
    setError('');
    setNotice('');
    const input = { title: t, body: b, showOnHome };
    if (editingId) {
      update.mutate(
        { id: editingId, input },
        {
          onSuccess: () => {
            setNotice('حُفظ التعديل.');
            resetForm();
          },
          onError: (err) => setError(err instanceof Error ? err.message : 'تعذّر الحفظ.'),
        },
      );
    } else {
      create.mutate(input, {
        onSuccess: () => {
          setNotice('أُرسل التذكير إلى جميع الدارسين.');
          resetForm();
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'تعذّر الإرسال.'),
      });
    }
  }

  return (
    <AdminShell active="reminders" breadcrumb="التذكيرات النافعة">
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        التذكيرات النافعة
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        {arNum(broadcasts.length)} تذكير · يصل إشعاراً لكل الدارسين، وتظهر بطاقته في الرئيسية يوماً
        واحداً إن فُعّلت
      </Txt>

      {/* Create / edit form */}
      <Card style={styles.formCard}>
        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
          {editingId ? 'تعديل التذكير' : 'تذكير جديد'}
        </Txt>
        <View style={{ gap: 10 }}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="العنوان — مثال: صيام يوم عرفة"
            placeholderTextColor={colors.textGhost}
            textAlign="right"
            style={styles.input}
          />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="نص التذكير…"
            placeholderTextColor={colors.textGhost}
            textAlign="right"
            multiline
            style={[styles.input, styles.bodyInput]}
          />
        </View>

        <View style={styles.switchRow}>
          <Switch
            value={showOnHome}
            onValueChange={setShowOnHome}
            trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
            thumbColor={colors.surfaceWhite}
            ios_backgroundColor={colors.surfaceInset}
          />
          <View style={{ flex: 1 }}>
            <Txt size={13.5} weight="medium" color={colors.textInk}>
              إظهار كبطاقة في الرئيسية
            </Txt>
            <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 2 }}>
              تظهر البطاقة يوماً واحداً ثم تختفي تلقائياً
            </Txt>
          </View>
        </View>

        {error ? (
          <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
            {error}
          </Txt>
        ) : null}
        {notice ? (
          <Txt size={12} color={colors.stateSuccess} style={{ marginTop: 8 }}>
            {notice}
          </Txt>
        ) : null}

        <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: 14 }}>
          <Pressable
            onPress={submit}
            disabled={pending}
            style={({ pressed }) => [styles.submitBtn, (pressed || pending) && { opacity: 0.6 }]}
          >
            <Feather
              name={editingId ? 'check' : 'send'}
              size={16}
              color={colors.onTealPrimary}
              style={{ marginLeft: 6 }}
            />
            <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
              {pending
                ? 'جارٍ الحفظ...'
                : editingId
                  ? 'حفظ التعديلات'
                  : 'إرسال التذكير'}
            </Txt>
          </Pressable>
          {editingId ? (
            <Pressable
              onPress={resetForm}
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.6 }]}
            >
              <Txt weight="semibold" size={14} color={colors.textSlate}>
                إلغاء
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </Card>

      {/* List */}
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.listHeading}>
        التذكيرات المرسلة
      </Txt>
      {isLoading ? (
        <Card>
          <Txt size={13} color={colors.textGhost} align="center">
            جارٍ التحميل...
          </Txt>
        </Card>
      ) : broadcasts.length === 0 ? (
        <Card>
          <Txt size={13} color={colors.textMuted} align="center">
            لا تذكيرات بعد. أرسل الأول أعلاه.
          </Txt>
        </Card>
      ) : (
        <Card padded={false} style={styles.listCard}>
          {broadcasts.map((b, idx) => (
            <React.Fragment key={b.id}>
              {idx > 0 ? <Divider /> : null}
              <BroadcastRow
                broadcast={b}
                onEdit={() => startEdit(b)}
                onDelete={() => setPendingDelete(b)}
              />
            </React.Fragment>
          ))}
        </Card>
      )}

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف التذكير"
        message={`سيُحذف «${pendingDelete?.title ?? ''}» وتُزال إشعاراته من صناديق الدارسين.`}
        confirmLabel="حذف"
        pending={remove.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate(pendingDelete.id, {
            onSettled: () => {
              if (editingId === pendingDelete.id) resetForm();
              setPendingDelete(null);
            },
          });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 22 } as TextStyle,

  formCard: { maxWidth: 700, marginBottom: 28 } as ViewStyle,

  label: { marginBottom: 8 } as TextStyle,

  input: {
    minHeight: 46,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
  },

  bodyInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },

  switchRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  } as ViewStyle,

  submitBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,

  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,

  listHeading: { marginBottom: 12 } as TextStyle,

  listCard: { overflow: 'hidden', maxWidth: 700 } as ViewStyle,

  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 56,
  } as ViewStyle,

  bullet: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  homeChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(201,164,99,0.14)',
  } as ViewStyle,

  actions: {
    flexDirection: 'row-reverse',
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
});
