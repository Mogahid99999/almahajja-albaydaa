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

import { FEEDBACK_LINK, type Broadcast, type BroadcastTarget } from '@/api/broadcasts';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  BroadcastTargeting,
  EMPTY_TARGETING,
  type TargetingState,
} from '@/components/admin/BroadcastTargeting';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Divider, Rhombus, Txt, cardRowStyle } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import {
  useAdminBroadcasts,
  useBroadcastImageUrl,
  useCreateBroadcast,
  useUploadBroadcastAudio,
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

/**
 * Common in-app destinations an admin can point a reminder button at, without
 * needing to know Expo Router paths. Tapping a chip fills the link URL field;
 * the reminder detail screen navigates internally when the URL starts with "/"
 * (see app/(student)/reminder/[id].tsx), so route entries must be leading-slash
 * routes. FEEDBACK_LINK is a sentinel that opens the «إرسال ملاحظة» sheet there
 * instead of navigating.
 */
const IN_APP_DESTINATIONS: { label: string; url: string }[] = [
  { label: 'إنشاء حساب', url: '/(auth)/register' },
  { label: 'تسجيل الدخول', url: '/sign-in' },
  { label: 'الرئيسية', url: '/' },
  { label: 'رحلتي العلمية', url: '/(student)/journey' },
  { label: 'ساحة الأسئلة', url: '/(student)/questions' },
  { label: 'رفيق الدراسة', url: '/(student)/buddy-search' },
  { label: 'التنبيهات', url: '/(student)/notifications' },
  { label: 'عن المنصة', url: '/(student)/about' },
  { label: 'إرسال ملاحظة', url: FEEDBACK_LINK },
];

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
  const uploadAudio = useUploadBroadcastAudio();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [showOnHome, setShowOnHome] = useState(true);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [targeting, setTargeting] = useState<TargetingState>({ ...EMPTY_TARGETING });
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
    setAudioPath(null);
    setAudioName(null);
    setLinkUrl('');
    setLinkLabel('');
    setTargeting({ ...EMPTY_TARGETING });
    setError('');
  }

  function startEdit(b: Broadcast) {
    setEditingId(b.id);
    setTitle(b.title);
    setBody(b.body);
    setShowOnHome(b.showOnHome);
    setImagePath(b.imagePath);
    setImagePreview(null);
    setAudioPath(b.audioPath);
    setAudioName(b.audioPath ? 'المقطع الصوتي الحالي' : null);
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

  async function pickAudio() {
    setError('');
    try {
      const res = await getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      uploadAudio.mutate(
        { uri: asset.uri, name: asset.name, mimeType: asset.mimeType },
        {
          onSuccess: (key) => {
            setAudioPath(key);
            setAudioName(asset.name);
          },
          onError: () => setError('تعذّر رفع المقطع الصوتي.'),
        },
      );
    } catch {
      setError('تعذّر اختيار المقطع الصوتي.');
    }
  }

  function removeAudio() {
    setAudioPath(null);
    setAudioName(null);
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
      audioPath,
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

  /**
   * Translate the targeting panel into a send target + human summary.
   * Ticked users win (send exactly them); otherwise the attribute filters send
   * to the whole matching pool; nothing = every student (undefined target).
   */
  function resolveTarget(): { target?: BroadcastTarget; summary: string } {
    if (!targeting.enabled) return { summary: 'جميع الدارسين' };
    if (targeting.selectedIds.size > 0) {
      return {
        target: { userIds: Array.from(targeting.selectedIds) },
        summary: `${arNum(targeting.selectedIds.size)} دارس محدَّد`,
      };
    }
    if (targeting.noEmail || targeting.notRegistered || targeting.gender) {
      const parts: string[] = [];
      if (targeting.gender === 'male') parts.push('رجال');
      if (targeting.gender === 'female') parts.push('نساء');
      if (targeting.noEmail) parts.push('بلا بريد');
      if (targeting.notRegistered) parts.push('غير مسجّل');
      return {
        target: {
          noEmail: targeting.noEmail,
          notRegistered: targeting.notRegistered,
          gender: targeting.gender,
        },
        summary: `الدارسون المطابقون (${parts.join(' و')})`,
      };
    }
    return { summary: 'جميع الدارسين' };
  }

  function confirmSend() {
    const { target, summary } = resolveTarget();
    const input = {
      title: title.trim(),
      body: body.trim(),
      showOnHome,
      imagePath,
      audioPath,
      linkUrl: linkUrl.trim() || null,
      linkLabel: linkLabel.trim() || null,
      target,
    };
    create.mutate(input, {
      onSuccess: () => {
        setNotice(`أُرسل التذكير إلى: ${summary}.`);
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

        {/* Optional audio clip — plays inline in the reminder (speed + seekbar). */}
        <View style={{ marginTop: 12 }}>
          {audioName ? (
            <View style={styles.audioRow}>
              <Feather name="headphones" size={15} color={colors.primaryTeal} />
              <Txt size={13} weight="medium" color={colors.textInk} numberOfLines={1} style={{ flex: 1 }}>
                {audioName}
              </Txt>
              <Pressable
                onPress={removeAudio}
                accessibilityLabel="إزالة المقطع الصوتي"
                style={({ pressed }) => [styles.audioRemoveBtn, pressed && { opacity: 0.6 }]}
              >
                <Feather name="x" size={13} color={colors.onTealPrimary} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={pickAudio}
              disabled={uploadAudio.isPending}
              style={({ pressed }) => [styles.pickImageBtn, pressed && { opacity: 0.6 }]}
            >
              <Feather name="headphones" size={16} color={colors.primaryTeal} />
              <Txt size={13} weight="medium" color={colors.primaryTeal}>
                {uploadAudio.isPending ? 'جارٍ رفع المقطع...' : 'إضافة مقطع صوتي (اختياري)'}
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

          {/* Quick-pick in-app destinations — tapping fills the URL (and the
              button text, if still empty) so no Expo Router path is needed. */}
          <Txt size={11.5} color={colors.textGhost}>
            أو اختر صفحة داخل التطبيق:
          </Txt>
          <View style={styles.destChips}>
            {IN_APP_DESTINATIONS.map((d) => {
              const active = linkUrl.trim() === d.url;
              return (
                <Pressable
                  key={d.url + d.label}
                  onPress={() => {
                    setLinkUrl(d.url);
                    if (!linkLabel.trim()) setLinkLabel(d.label);
                  }}
                  style={({ pressed }) => [
                    styles.destChip,
                    active && styles.destChipActive,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Txt
                    size={12.5}
                    weight="medium"
                    color={active ? colors.onTealPrimary : colors.textSlate}
                  >
                    {d.label}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Recipient targeting — new sends only (editing doesn't re-fan-out). */}
        {!editingId ? (
          <View style={{ marginTop: 12 }}>
            <BroadcastTargeting value={targeting} onChange={setTargeting} />
          </View>
        ) : null}

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
        title={`إرسال إلى: ${resolveTarget().summary}؟`}
        message="سيصل إشعار فوري إلى المستقبِلين المفعّل لديهم استقبال التذكيرات النافعة. تأكد من العنوان والنص قبل الإرسال."
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

  destChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  } as ViewStyle,

  destChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,

  destChipActive: {
    backgroundColor: colors.primaryTeal,
    borderColor: colors.primaryTeal,
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

  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  audioRemoveBtn: {
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
