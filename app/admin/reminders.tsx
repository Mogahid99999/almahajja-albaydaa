/**
 * Admin/publisher التذكيرات النافعة — /admin/reminders (V7 feature).
 *
 * Create + list + edit + delete broadcast reminders (virtuous seasons/sunan).
 * Creating one immediately pushes a `beneficial_reminder` to every student
 * (server fan-out in create_broadcast); «إظهار كبطاقة في الرئيسية» also pins it
 * on Home for one day. Editing updates the detail page (already-sent inbox rows
 * keep their wording); deleting soft-deletes and clears the inbox rows.
 */
import Feather from '@expo/vector-icons/Feather';
import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { Broadcast } from '@/api/broadcasts';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Divider, Rhombus, Txt, cardRowStyle } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import {
  useAdminBroadcasts,
  useBroadcastImageUrl,
  useCreateBroadcast,
  useDeleteBroadcast,
  useUpdateBroadcast,
  useUploadBroadcastImage,
} from '@/hooks/useBroadcasts';
import { getDocumentAsync } from '@/lib/documentPicker';
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
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
          <View style={styles.viewsChip}>
            <Feather name="eye" size={11} color={colors.textMuted} />
            <Txt size={10.5} weight="medium" color={colors.textMuted}>
              {arNum(broadcast.viewCount ?? 0)} مشاهدة
            </Txt>
          </View>
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
  const uploadImage = useUploadBroadcastImage();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [showOnHome, setShowOnHome] = useState(true);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Broadcast | null>(null);
  const [confirmingSend, setConfirmingSend] = useState(false);

  // Editing an existing reminder: resolve its stored image key to a preview URL.
  const { data: existingImageUrl } = useBroadcastImageUrl(
    editingId && !imagePreview ? imagePath : null,
  );
  useEffect(() => {
    if (existingImageUrl) setImagePreview(existingImageUrl);
  }, [existingImageUrl]);

  const pending = create.isPending || update.isPending;

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setBody('');
    setShowOnHome(true);
    setImagePath(null);
    setImagePreview(null);
    setLinkUrl('');
    setLinkLabel('');
    setError('');
  }

  function startEdit(b: Broadcast) {
    setEditingId(b.id);
    setTitle(b.title);
    setBody(b.body);
    setShowOnHome(b.showOnHome);
    setImagePath(b.imagePath);
    setImagePreview(null);
    setLinkUrl(b.linkUrl ?? '');
    setLinkLabel(b.linkLabel ?? '');
    setError('');
    setNotice('');
  }

  async function pickImage() {
    setError('');
    try {
      const res = await getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      uploadImage.mutate(
        { uri: asset.uri, name: asset.name, mimeType: asset.mimeType },
        {
          onSuccess: (key) => {
            setImagePath(key);
            setImagePreview(asset.uri);
          },
          onError: () => setError('تعذّر رفع الصورة.'),
        },
      );
    } catch {
      setError('تعذّر اختيار الصورة.');
    }
  }

  function removeImage() {
    setImagePath(null);
    setImagePreview(null);
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
    const input = {
      title: t,
      body: b,
      showOnHome,
      imagePath,
      linkUrl: linkUrl.trim() || null,
      linkLabel: linkLabel.trim() || null,
    };
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
      // Sending fans out a real push notification to every opted-in student —
      // confirm before firing, so a typo/misclick can't blast everyone.
      setConfirmingSend(true);
    }
  }

  function confirmSend() {
    const input = {
      title: title.trim(),
      body: body.trim(),
      showOnHome,
      imagePath,
      linkUrl: linkUrl.trim() || null,
      linkLabel: linkLabel.trim() || null,
    };
    create.mutate(input, {
      onSuccess: () => {
        setNotice('أُرسل التذكير إلى جميع الدارسين.');
        resetForm();
      },
      onError: (err) => setError(err instanceof Error ? err.message : 'تعذّر الإرسال.'),
      onSettled: () => setConfirmingSend(false),
    });
  }

  const renderItem = useCallback(
    ({ item: b, index }: { item: Broadcast; index: number }) => (
      <View style={[cardRowStyle(index === 0, index === broadcasts.length - 1), { maxWidth: 700 }]}>
        <BroadcastRow broadcast={b} onEdit={() => startEdit(b)} onDelete={() => setPendingDelete(b)} />
      </View>
    ),
    [broadcasts.length],
  );

  const separator = useCallback(
    () => (
      <View style={{ maxWidth: 700 }}>
        <Divider />
      </View>
    ),
    [],
  );

  const header = (
    <>
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

        {/* Optional image (shown on the detail page + as a rich push image) */}
        <View style={styles.imageRow}>
          {imagePreview ? (
            <View style={styles.imagePreviewWrap}>
              <Image source={{ uri: imagePreview }} style={styles.imagePreview} />
              <Pressable
                onPress={removeImage}
                accessibilityLabel="إزالة الصورة"
                style={({ pressed }) => [styles.removeImageBtn, pressed && { opacity: 0.7 }]}
              >
                <Feather name="x" size={13} color={colors.onTealPrimary} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={pickImage}
              disabled={uploadImage.isPending}
              style={({ pressed }) => [styles.pickImageBtn, pressed && { opacity: 0.6 }]}
            >
              <Feather name="image" size={16} color={colors.primaryTeal} />
              <Txt size={13} weight="medium" color={colors.primaryTeal}>
                {uploadImage.isPending ? 'جارٍ رفع الصورة...' : 'إضافة صورة (اختياري)'}
              </Txt>
            </Pressable>
          )}
        </View>

        {/* Optional action button (link to a URL, or an in-app route like /(student)/...) */}
        <View style={{ gap: 10, marginTop: 12 }}>
          <TextInput
            value={linkLabel}
            onChangeText={setLinkLabel}
            placeholder="نص الزر (اختياري) — مثال: اطّلع أكثر"
            placeholderTextColor={colors.textGhost}
            textAlign="right"
            style={styles.input}
          />
          <TextInput
            value={linkUrl}
            onChangeText={setLinkUrl}
            placeholder="رابط الزر (اختياري) — https://…"
            placeholderTextColor={colors.textGhost}
            textAlign="left"
            autoCapitalize="none"
            style={[styles.input, { textAlign: 'left' }]}
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

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
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
    </>
  );

  return (
    <AdminShell active="reminders" breadcrumb="التذكيرات النافعة" scroll={false}>
      <FlatList
        style={{ flex: 1 }}
        data={broadcasts}
        keyExtractor={(b) => b.id}
        renderItem={renderItem}
        ItemSeparatorComponent={separator}
        initialNumToRender={10}
        ListHeaderComponent={header}
        ListEmptyComponent={
          isLoading ? (
            <Card>
              <Txt size={13} color={colors.textGhost} align="center">
                جارٍ التحميل...
              </Txt>
            </Card>
          ) : (
            <Card>
              <Txt size={13} color={colors.textMuted} align="center">
                لا تذكيرات بعد. أرسل الأول أعلاه.
              </Txt>
            </Card>
          )
        }
      />

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

      <ConfirmDialog
        visible={confirmingSend}
        destructive={false}
        title="إرسال إلى جميع الدارسين؟"
        message="سيصل إشعار فوري إلى كل الدارسين المفعّل لديهم استقبال التذكيرات النافعة. تأكد من العنوان والنص قبل الإرسال."
        confirmLabel="إرسال"
        cancelLabel="تراجع"
        pending={create.isPending}
        onConfirm={confirmSend}
        onCancel={() => setConfirmingSend(false)}
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

  imageRow: {
    marginTop: 12,
  } as ViewStyle,

  pickImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  imagePreviewWrap: {
    alignSelf: 'flex-start',
  } as ViewStyle,

  imagePreview: {
    width: 140,
    height: 90,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceInset,
  } as ImageStyle,

  removeImageBtn: {
    position: 'absolute',
    top: -8,
    left: -8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.stateDanger,
  } as ViewStyle,

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  } as ViewStyle,

  submitBtn: {
    flexDirection: 'row',
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
    flexDirection: 'row',
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

  viewsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
});
