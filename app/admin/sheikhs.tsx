/**
 * Admin sheikhs management — /admin/sheikhs (PLAN_ADMIN_FIXES #1)
 *
 * List + add + rename + delete. `sheikhs.name` is UNIQUE; deleting a sheikh is
 * safe — `lectures.sheikh_id` is ON DELETE SET NULL, so lectures keep playing,
 * the chip simply disappears.
 */
import Feather from '@expo/vector-icons/Feather';
import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';

import type { SheikhProfile } from '@/api/sheikhs';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import {
  useCreateSheikh,
  useCreateSheikhAccount,
  useDeleteSheikh,
  useSheikhProfiles,
  useUpdateSheikh,
  useUpdateSheikhBio,
  useUploadSheikhPhoto,
} from '@/hooks/useAdmin';
import { getDocumentAsync } from '@/lib/documentPicker';
import { arNum } from '@/lib/format';

function SheikhRow({
  sheikh,
  onRename,
  onSaveBio,
  onDelete,
  onPhotoPick,
  renamePending,
  bioPending,
  photoPending,
}: {
  sheikh: SheikhProfile;
  onRename: (name: string) => void;
  onSaveBio: (bio: string) => void;
  onDelete: () => void;
  onPhotoPick: () => void;
  renamePending: boolean;
  bioPending: boolean;
  photoPending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sheikh.name);
  const [bio, setBio] = useState(sheikh.bio ?? '');

  function save() {
    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== sheikh.name) onRename(trimmedName);
    const trimmedBio = bio.trim();
    if (trimmedBio !== (sheikh.bio ?? '')) onSaveBio(trimmedBio);
    setEditing(false);
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPhotoPick}
        disabled={photoPending}
        accessibilityLabel="تغيير صورة الشيخ"
        style={[styles.avatar, photoPending && { opacity: 0.6 }]}
      >
        {sheikh.photoUrl ? (
          <Image source={{ uri: sheikh.photoUrl }} style={styles.avatarImg} />
        ) : (
          <Feather name="user" size={18} color={colors.textGhost} />
        )}
        <View style={styles.avatarBadge}>
          <Feather name="camera" size={9} color={colors.onTealPrimary} />
        </View>
      </Pressable>

      <View style={{ flex: 1 }}>
        {editing ? (
          <TextInput
            value={name}
            onChangeText={setName}
            textAlign="right"
            autoFocus
            placeholder="اسم الشيخ..."
            placeholderTextColor={colors.textGhost}
            style={styles.input}
          />
        ) : (
          <Txt size={14} weight="medium" color={colors.textInk} numberOfLines={1}>
            {sheikh.name}
          </Txt>
        )}

        {editing ? (
          <TextInput
            value={bio}
            onChangeText={setBio}
            textAlign="right"
            multiline
            numberOfLines={3}
            placeholder="نبذة عن الشيخ..."
            placeholderTextColor={colors.textGhost}
            style={[styles.input, styles.bioInput]}
          />
        ) : sheikh.bio ? (
          <Txt size={12} color={colors.textMuted} numberOfLines={2} style={{ marginTop: 4 }}>
            {sheikh.bio}
          </Txt>
        ) : null}
      </View>

      <View style={styles.actions}>
        {editing ? (
          <Pressable
            onPress={save}
            disabled={renamePending || bioPending}
            accessibilityLabel="حفظ"
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
          >
            <Feather name="check" size={16} color={colors.stateSuccess} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setEditing(true)}
            accessibilityLabel="تعديل"
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
          >
            <Feather name="edit-2" size={15} color={colors.primaryTeal} />
          </Pressable>
        )}
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

/** V6: provision a sheikh LOGIN (email + password, role sheikh → /sheikh inbox). */
function SheikhAccountCard() {
  const createAccount = useCreateSheikhAccount();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');

  function handleCreate() {
    const n = name.trim();
    const e = email.trim().toLowerCase();
    if (!n || !e || password.length < 6) {
      setError('أكمل الاسم والبريد وكلمة مرور من 8 أحرف فأكثر.');
      return;
    }
    setError('');
    setCreated('');
    createAccount.mutate(
      { name: n, email: e, password },
      {
        onSuccess: () => {
          setCreated(`أُنشئ حساب الشيخ «${n}» — يدخل بالبريد ${e} إلى صندوق الأسئلة.`);
          setName('');
          setEmail('');
          setPassword('');
        },
        onError: (err) =>
          setError(err instanceof Error ? err.message : 'تعذّر إنشاء الحساب.'),
      },
    );
  }

  return (
    <Card style={styles.addCard}>
      <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
        إضافة حساب شيخ
      </Txt>
      <Txt size={12} color={colors.textMuted} style={{ marginBottom: 12, lineHeight: 19 }}>
        حساب دخول يستقبل أسئلة الدارسين ويجيب عنها (صندوق الأسئلة). يُربط تلقائياً باسم
        الشيخ في قائمة المشايخ.
      </Txt>
      <View style={styles.accountFields}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="اسم الشيخ"
          placeholderTextColor={colors.textGhost}
          textAlign="right"
          style={styles.input}
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="البريد الإلكتروني"
          placeholderTextColor={colors.textGhost}
          textAlign="right"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="كلمة المرور (٦ أحرف فأكثر)"
          placeholderTextColor={colors.textGhost}
          textAlign="right"
          autoCapitalize="none"
          style={styles.input}
        />
      </View>
      {error ? (
        <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
          {error}
        </Txt>
      ) : null}
      {created ? (
        <Txt size={12} color={colors.stateSuccess} style={{ marginTop: 8, lineHeight: 19 }}>
          {created}
        </Txt>
      ) : null}
      <Pressable
        onPress={handleCreate}
        disabled={createAccount.isPending}
        style={({ pressed }) => [
          styles.addBtn,
          { marginTop: 12, alignSelf: 'flex-start', opacity: pressed || createAccount.isPending ? 0.6 : 1 },
        ]}
      >
        <Feather name="user-plus" size={16} color={colors.onTealPrimary} style={{ marginLeft: 6 }} />
        <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
          {createAccount.isPending ? 'جارٍ الإنشاء...' : 'إنشاء الحساب'}
        </Txt>
      </Pressable>
    </Card>
  );
}

export default function SheikhsScreen() {
  const { data: sheikhs = [], isLoading } = useSheikhProfiles();
  const createSheikh = useCreateSheikh();
  const updateSheikh = useUpdateSheikh();
  const updateSheikhBio = useUpdateSheikhBio();
  const uploadSheikhPhoto = useUploadSheikhPhoto();
  const deleteSheikh = useDeleteSheikh();

  const [newName, setNewName] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SheikhProfile | null>(null);

  async function pickAndUploadPhoto(sheikhId: string) {
    setPhotoError('');
    try {
      const res = await getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      uploadSheikhPhoto.mutate(
        { sheikhId, file: { uri: asset.uri, name: asset.name, mimeType: asset.mimeType } },
        { onError: () => setPhotoError('تعذّر رفع الصورة.') },
      );
    } catch {
      setPhotoError('تعذّر اختيار الصورة.');
    }
  }

  function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setError('');
    createSheikh.mutate(trimmed, {
      onSuccess: () => setNewName(''),
      onError: () => setError('تعذّر الإضافة — قد يكون الاسم موجوداً بالفعل.'),
    });
  }

  return (
    <AdminShell active="sheikhs" breadcrumb="المشايخ">
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        المشايخ
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        {arNum(sheikhs.length)} شيخ · يظهرون في نموذج الرفع وكشريحة فوق قائمة الدروس
      </Txt>

      {/* Add form */}
      <Card style={styles.addCard}>
        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
          إضافة شيخ
        </Txt>
        <View style={styles.addRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="مثال: الشيخ عبد الله بن سالم"
            placeholderTextColor={colors.textGhost}
            textAlign="right"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={handleAdd}
            style={[styles.input, { flex: 1 }, focused && styles.inputFocused]}
          />
          <Pressable
            onPress={handleAdd}
            disabled={createSheikh.isPending || !newName.trim()}
            style={({ pressed }) => [
              styles.addBtn,
              { opacity: pressed || !newName.trim() ? 0.6 : 1 },
            ]}
          >
            <Feather name="plus" size={16} color={colors.onTealPrimary} style={{ marginLeft: 6 }} />
            <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
              إضافة
            </Txt>
          </Pressable>
        </View>
        {error ? (
          <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
            {error}
          </Txt>
        ) : null}
      </Card>

      {/* Sheikh LOGIN account (V6 Q&A) */}
      <SheikhAccountCard />

      {/* List */}
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.listHeading}>
        قائمة المشايخ
      </Txt>
      {isLoading ? (
        <Card>
          <Txt size={13} color={colors.textGhost} align="center">جارٍ التحميل...</Txt>
        </Card>
      ) : sheikhs.length === 0 ? (
        <Card>
          <Txt size={13} color={colors.textMuted} align="center">لا يوجد مشايخ بعد. أضف الأول أعلاه.</Txt>
        </Card>
      ) : (
        <Card padded={false} style={styles.listCard}>
          {sheikhs.map((s, idx) => (
            <React.Fragment key={s.id}>
              {idx > 0 ? <Divider /> : null}
              <SheikhRow
                sheikh={s}
                renamePending={updateSheikh.isPending}
                bioPending={updateSheikhBio.isPending}
                photoPending={uploadSheikhPhoto.isPending}
                onRename={(name) => updateSheikh.mutate({ id: s.id, name })}
                onSaveBio={(bio) => updateSheikhBio.mutate({ id: s.id, bio })}
                onPhotoPick={() => pickAndUploadPhoto(s.id)}
                onDelete={() => setPendingDelete(s)}
              />
            </React.Fragment>
          ))}
        </Card>
      )}
      {photoError ? (
        <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
          {photoError}
        </Txt>
      ) : null}

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف الشيخ"
        message={`سيتم حذف «${pendingDelete?.name ?? ''}». تبقى محاضراته تعمل، لكن تختفي شريحة اسم الشيخ منها.`}
        confirmLabel="حذف"
        pending={deleteSheikh.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteSheikh.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 22 } as TextStyle,

  addCard: { maxWidth: 700, marginBottom: 28 } as ViewStyle,

  label: { marginBottom: 8 } as TextStyle,

  addRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  } as ViewStyle,

  accountFields: {
    gap: 10,
  } as ViewStyle,

  input: {
    height: 46,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
  },

  inputFocused: {
    borderColor: colors.primaryTeal600,
    ...shadows.subtle,
  },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
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

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bgSand,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  } as ViewStyle,

  avatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },

  avatarBadge: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surfaceWhite,
  } as ViewStyle,

  bioInput: {
    marginTop: 6,
    minHeight: 60,
    paddingTop: 10,
    textAlignVertical: 'top',
  },

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
