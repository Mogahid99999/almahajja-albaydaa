/**
 * إدارة المستخدمين — /admin/users  (admin only).
 *
 * Searchable, status-filterable list of accounts (rendered as stacked cards so
 * it never overflows a phone). Each card opens the per-user detail + actions.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useAdminOnly } from '@/hooks/useAdminGuard';
import { useAdminUsers, useCreateUser } from '@/hooks/useAdminUsers';
import { arNum, arSince } from '@/lib/format';
import type { AppRole } from '@/api/auth';
import type { AdminUserRow, AdminUserStatus } from '@/api/types';

const STATUS_META: Record<AdminUserStatus, { label: string; bg: string; fg: string }> = {
  active: { label: 'نشط', bg: 'rgba(31,138,91,0.12)', fg: colors.stateSuccess },
  inactive: { label: 'غير نشط', bg: 'rgba(154,143,124,0.16)', fg: colors.textFaint },
  banned: { label: 'محظور', bg: 'rgba(184,92,74,0.14)', fg: colors.stateDanger },
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'مدير',
  publisher: 'ناشر',
  sheikh: 'شيخ',
  student: 'طالب',
};

type Filter = 'all' | 'registered' | AdminUserStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'registered', label: 'المسجلين' },
  { key: 'active', label: 'نشط' },
  { key: 'inactive', label: 'غير نشط' },
  { key: 'banned', label: 'محظور' },
];

function UserCard({ user, onPress }: { user: AdminUserRow; onPress: () => void }) {
  const st = STATUS_META[user.status];
  const contact = user.email || user.phone || 'حساب ضيف';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      <Card style={styles.userCard}>
        <View style={styles.userTop}>
          <View style={[styles.badge, { backgroundColor: st.bg }]}>
            <Txt size={11} weight="semibold" color={st.fg}>
              {st.label}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt size={14} weight="semibold" color={colors.textInk} numberOfLines={1}>
              {user.displayName || 'بدون اسم'}
            </Txt>
            <Txt size={12} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
              {contact}
            </Txt>
          </View>
        </View>
        <View style={styles.userMeta}>
          <MetaChip icon="check-circle" text={`${arNum(user.completedLectures)} درساً`} />
          <MetaChip icon="award" text={`${arNum(user.passedQuizzes)} اختباراً`} />
          <MetaChip icon="zap" text={`مداومة ${arNum(user.currentStreak)}`} />
          <MetaChip icon="clock" text={arSince(user.lastOpenedAt)} />
          {user.role !== 'student' && (
            <View style={[styles.badge, { backgroundColor: 'rgba(31,74,66,0.1)' }]}>
              <Txt size={11} weight="semibold" color={colors.primaryTeal}>
                {ROLE_LABEL[user.role]}
              </Txt>
            </View>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

function MetaChip({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View style={styles.metaChip}>
      <Feather name={icon} size={12} color={colors.textFaint} />
      <Txt size={11} color={colors.textMuted}>
        {text}
      </Txt>
    </View>
  );
}

const ROLE_OPTIONS: { key: AppRole; label: string }[] = [
  { key: 'student', label: 'طالب' },
  { key: 'publisher', label: 'ناشر' },
  { key: 'sheikh', label: 'شيخ' },
  { key: 'admin', label: 'مدير' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6, marginBottom: 14 }}>
      <Txt size={12} color={colors.textMuted}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

function CreateUserModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const create = useCreateUser();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppRole>('student');

  const close = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('student');
    onClose();
  };

  const valid = /.+@.+\..+/.test(email.trim()) && password.trim().length >= 6;

  const submit = () => {
    create.mutate(
      { email: email.trim(), password: password.trim(), displayName: name.trim(), role },
      {
        onSuccess: () => {
          Alert.alert('تم', 'أُنشئ الحساب بنجاح.');
          close();
        },
        onError: (e) => Alert.alert('تعذّر الإنشاء', (e as Error).message),
      },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={close} accessibilityLabel="إغلاق" />
        <View style={styles.modalCard}>
          <Txt weight="display" size={20} color={colors.primaryTeal} style={{ marginBottom: 16 }}>
            إضافة مستخدم
          </Txt>

          <Field label="الاسم">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="الاسم"
              placeholderTextColor={colors.textGhost}
              style={styles.modalInput}
            />
          </Field>
          <Field label="البريد الإلكتروني">
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor={colors.textGhost}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.modalInput}
            />
          </Field>
          <Field label="كلمة المرور (٦ أحرف على الأقل)">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••"
              placeholderTextColor={colors.textGhost}
              secureTextEntry
              autoCapitalize="none"
              style={styles.modalInput}
            />
          </Field>
          <Field label="الدور">
            <View style={styles.roleRow}>
              {ROLE_OPTIONS.map((r) => {
                const active = r.key === role;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => setRole(r.key)}
                    style={[styles.roleChip, active && styles.roleChipActive]}
                  >
                    <Txt
                      size={12}
                      weight={active ? 'semibold' : 'regular'}
                      color={active ? colors.onTealPrimary : colors.textMuted}
                    >
                      {r.label}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          <View style={styles.modalActions}>
            <Pressable onPress={close} style={[styles.modalBtn, styles.modalCancel]}>
              <Txt size={13} weight="semibold" color={colors.textMuted}>
                إلغاء
              </Txt>
            </Pressable>
            <Pressable
              disabled={!valid || create.isPending}
              onPress={submit}
              style={[styles.modalBtn, styles.modalCreate, (!valid || create.isPending) && { opacity: 0.5 }]}
            >
              <Txt size={13} weight="semibold" color={colors.onTealPrimary}>
                {create.isPending ? 'جارٍ الإنشاء…' : 'إنشاء'}
              </Txt>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function AdminUsers() {
  useAdminOnly();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Debounce the search field so we don't fire an RPC on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  const [showCreate, setShowCreate] = useState(false);

  const { data: users = [], isLoading } = useAdminUsers(search);

  const shown = useMemo(() => {
    if (filter === 'all') return users;
    // "المسجلين" = accounts that completed registration (have an email);
    // anonymous guests have none.
    if (filter === 'registered') return users.filter((u) => !!u.email);
    return users.filter((u) => u.status === filter);
  }, [users, filter]);

  const countLabel =
    filter === 'all'
      ? `${arNum(users.length)} حساباً`
      : `${arNum(shown.length)} من ${arNum(users.length)} حساباً`;

  return (
    <AdminShell active="users" breadcrumb="إدارة المستخدمين">
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Txt weight="display" size={26} color={colors.primaryTeal} style={{ marginBottom: 4 }}>
            إدارة المستخدمين
          </Txt>
          <Txt size={13} color={colors.textMuted}>
            {countLabel}
          </Txt>
        </View>
        <Pressable
          onPress={() => setShowCreate(true)}
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
        >
          <Feather name="user-plus" size={16} color={colors.onTealPrimary} />
          <Txt size={13} weight="semibold" color={colors.onTealPrimary}>
            إضافة مستخدم
          </Txt>
        </Pressable>
      </View>
      <View style={{ height: 20 }} />

      <CreateUserModal visible={showCreate} onClose={() => setShowCreate(false)} />

      {/* Search */}
      <View style={styles.searchBox}>
        <Feather name="search" size={16} color={colors.textFaint} />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="ابحث بالاسم أو البريد أو الهاتف"
          placeholderTextColor={colors.textGhost}
          style={styles.searchInput}
        />
        {input.length > 0 && (
          <Pressable onPress={() => setInput('')} hitSlop={8}>
            <Feather name="x" size={16} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {/* Status filter */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Txt
                size={12}
                weight={active ? 'semibold' : 'regular'}
                color={active ? colors.onTealPrimary : colors.textMuted}
              >
                {f.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {/* List */}
      {isLoading ? (
        <Txt size={13} color={colors.textMuted} align="center" style={{ paddingVertical: 24 }}>
          جارٍ التحميل…
        </Txt>
      ) : shown.length === 0 ? (
        <Card>
          <Txt size={13} color={colors.textMuted} align="center">
            لا حسابات مطابقة.
          </Txt>
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          {shown.map((u) => (
            <UserCard
              key={u.id}
              user={u}
              onPress={() =>
                router.push(`/admin/user/${u.id}` as Parameters<typeof router.push>[0])
              }
            />
          ))}
        </View>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  } as ViewStyle,

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.primaryTeal,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: radius.input,
    justifyContent: 'center',
  } as ViewStyle,

  modalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  } as ViewStyle,

  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,40,36,0.45)',
  } as ViewStyle,

  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.bgSandRaised,
    borderRadius: radius.card,
    padding: 22,
  } as ViewStyle,

  modalInput: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    fontSize: 14,
    color: colors.textInk,
    textAlign: 'right',
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    height: 46,
  } as TextStyle,

  roleRow: {
    flexDirection: 'row',
    gap: 8,
  } as ViewStyle,

  roleChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  roleChipActive: { backgroundColor: colors.primaryTeal } as ViewStyle,

  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  } as ViewStyle,

  modalBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.input,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  modalCancel: {
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  modalCreate: {
    backgroundColor: colors.primaryTeal,
  } as ViewStyle,

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    height: 46,
    marginBottom: 14,
  } as ViewStyle,

  searchInput: {
    flex: 1,
    fontFamily: 'IBMPlexSansArabic_400Regular',
    fontSize: 14,
    color: colors.textInk,
    textAlign: 'right',
    paddingVertical: 0,
  } as TextStyle,

  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  } as ViewStyle,

  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  filterChipActive: { backgroundColor: colors.primaryTeal } as ViewStyle,

  userCard: { gap: 12 } as ViewStyle,

  userTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  } as ViewStyle,

  userMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  } as ViewStyle,

  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  } as ViewStyle,

  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  } as ViewStyle,
});
