/**
 * Admin sheikhs management — /admin/sheikhs (PLAN_ADMIN_FIXES #1)
 *
 * List + add + rename + delete. `sheikhs.name` is UNIQUE; deleting a sheikh is
 * safe — `lectures.sheikh_id` is ON DELETE SET NULL, so lectures keep playing,
 * the chip simply disappears.
 */
import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';

import type { SheikhOption } from '@/api/types';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import {
  useCreateSheikh,
  useCreateSheikhAccount,
  useDeleteSheikh,
  useSheikhs,
  useUpdateSheikh,
} from '@/hooks/useAdmin';
import { arNum } from '@/lib/format';

function SheikhRow({
  sheikh,
  onRename,
  onDelete,
  renamePending,
}: {
  sheikh: SheikhOption;
  onRename: (name: string) => void;
  onDelete: () => void;
  renamePending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sheikh.name);

  function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === sheikh.name) {
      setEditing(false);
      setName(sheikh.name);
      return;
    }
    onRename(trimmed);
    setEditing(false);
  }

  return (
    <View style={styles.row}>
      <View style={styles.bullet}>
        <Rhombus size={8} color={colors.accentBrass} filled={false} />
      </View>

      {editing ? (
        <TextInput
          value={name}
          onChangeText={setName}
          textAlign="right"
          autoFocus
          onSubmitEditing={save}
          placeholder="اسم الشيخ..."
          placeholderTextColor={colors.textGhost}
          style={[styles.input, { flex: 1 }]}
        />
      ) : (
        <Txt size={14} weight="medium" color={colors.textInk} style={{ flex: 1 }} numberOfLines={1}>
          {sheikh.name}
        </Txt>
      )}

      <View style={styles.actions}>
        {editing ? (
          <Pressable
            onPress={save}
            disabled={renamePending}
            accessibilityLabel="حفظ"
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
          >
            <Feather name="check" size={16} color={colors.stateSuccess} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setEditing(true)}
            accessibilityLabel="إعادة تسمية"
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
      setError('أكمل الاسم والبريد وكلمة مرور من ٦ أحرف فأكثر.');
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
  const { data: sheikhs = [], isLoading } = useSheikhs();
  const createSheikh = useCreateSheikh();
  const updateSheikh = useUpdateSheikh();
  const deleteSheikh = useDeleteSheikh();

  const [newName, setNewName] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SheikhOption | null>(null);

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
                onRename={(name) => updateSheikh.mutate({ id: s.id, name })}
                onDelete={() => setPendingDelete(s)}
              />
            </React.Fragment>
          ))}
        </Card>
      )}

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
    flexDirection: 'row-reverse',
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
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },

  addBtn: {
    flexDirection: 'row-reverse',
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
