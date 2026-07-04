/**
 * تفاصيل المستخدم — /admin/user/[id]  (admin only).
 *
 * Read: profile + totals + progress + quiz results (admin_user_detail RPC).
 * Actions (via the admin-users Edge Function): إيقاف/تفعيل، تعيين كلمة سر بدون
 * القديمة، تعديل الاسم/البريد، تغيير الدور. All rollups are server-side.
 */
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Divider, IconButton, ProgressBar, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useAdminOnly } from '@/hooks/useAdminGuard';
import { useAdminUserActions, useAdminUserDetail } from '@/hooks/useAdminUsers';
import { arDate, arDuration, arNum, arSince } from '@/lib/format';
import type { AppRole } from '@/api/auth';
import type { AdminUserProfile } from '@/api/types';

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  active: { label: 'نشط', bg: 'rgba(31,138,91,0.12)', fg: colors.stateSuccess },
  inactive: { label: 'غير نشط', bg: 'rgba(154,143,124,0.16)', fg: colors.textFaint },
  banned: { label: 'محظور', bg: 'rgba(184,92,74,0.14)', fg: colors.stateDanger },
};

const ROLES: { key: AppRole; label: string }[] = [
  { key: 'student', label: 'طالب' },
  { key: 'publisher', label: 'ناشر' },
  { key: 'sheikh', label: 'شيخ' },
  { key: 'admin', label: 'مدير' },
];

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Txt size={13} color={colors.textInk} style={{ flex: 1, textAlign: 'right', writingDirection: 'rtl' }} numberOfLines={1}>
        {value}
      </Txt>
      <Txt size={12} color={colors.textMuted}>
        {label}
      </Txt>
    </View>
  );
}

function EditableField({
  label,
  initial,
  placeholder,
  actionLabel,
  onSave,
  pending,
  secure,
  keyboardType,
  clearOnSave,
  validate,
}: {
  label: string;
  initial: string;
  placeholder: string;
  actionLabel: string;
  onSave: (value: string) => void;
  pending: boolean;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  clearOnSave?: boolean;
  validate: (value: string, initial: string) => boolean;
}) {
  const [val, setVal] = useState(initial);
  const ok = validate(val, initial) && !pending;
  return (
    <View style={{ gap: 6 }}>
      <Txt size={12} color={colors.textMuted}>
        {label}
      </Txt>
      <View style={styles.editRow}>
        <TextInput
          value={val}
          onChangeText={setVal}
          placeholder={placeholder}
          placeholderTextColor={colors.textGhost}
          secureTextEntry={secure}
          keyboardType={keyboardType}
          autoCapitalize="none"
          style={styles.input}
        />
        <Pressable
          disabled={!ok}
          onPress={() => {
            onSave(val.trim());
            if (clearOnSave) setVal('');
          }}
          style={[styles.saveBtn, !ok && { opacity: 0.4 }]}
        >
          <Txt size={12} weight="semibold" color={colors.onTealPrimary}>
            {actionLabel}
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminUserDetailScreen() {
  useAdminOnly();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = String(id);
  const router = useRouter();
  const { data, isLoading } = useAdminUserDetail(userId);
  const actions = useAdminUserActions(userId);
  const [notice, setNotice] = useState<string | null>(null);

  const profile = data?.profile;

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  const onError = (e: unknown) => Alert.alert('تعذّر التنفيذ', (e as Error).message);

  return (
    <AdminShell active="users" breadcrumb="تفاصيل المستخدم">
      <View style={styles.headerRow}>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt weight="display" size={22} color={colors.primaryTeal} numberOfLines={1} style={{ flex: 1 }}>
          {profile?.displayName || 'تفاصيل المستخدم'}
        </Txt>
      </View>

      {notice && (
        <View style={styles.notice}>
          <Feather name="check" size={14} color={colors.stateSuccess} />
          <Txt size={12} color={colors.stateSuccess}>
            {notice}
          </Txt>
        </View>
      )}

      {isLoading || !profile ? (
        <Txt size={13} color={colors.textMuted} align="center" style={{ paddingVertical: 24 }}>
          جارٍ التحميل…
        </Txt>
      ) : (
        <>
          <ProfileCard profile={profile} />
          <TotalsCard
            completed={data!.totals.completedLectures}
            inProgress={data!.totals.inProgressLectures}
            passed={data!.totals.passedQuizzes}
          />

          {/* Account actions */}
          <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
            إجراءات الحساب
          </Txt>
          <Card style={{ gap: 16 }}>
            {/* Ban / unban */}
            <Pressable
              disabled={actions.ban.isPending || actions.unban.isPending}
              onPress={() => {
                const banned = profile.status === 'banned';
                Alert.alert(
                  banned ? 'تفعيل الحساب' : 'إيقاف الحساب',
                  banned
                    ? 'سيتمكن الطالب من الدخول مجددًا.'
                    : 'لن يتمكن الطالب من الدخول حتى تُفعّل الحساب.',
                  [
                    { text: 'إلغاء', style: 'cancel' },
                    {
                      text: banned ? 'تفعيل' : 'إيقاف',
                      style: banned ? 'default' : 'destructive',
                      onPress: () =>
                        (banned ? actions.unban : actions.ban).mutate(undefined, {
                          onSuccess: () => flash(banned ? 'تم تفعيل الحساب' : 'تم إيقاف الحساب'),
                          onError,
                        }),
                    },
                  ],
                );
              }}
              style={[
                styles.wideBtn,
                {
                  backgroundColor:
                    profile.status === 'banned' ? colors.primaryTeal : 'rgba(184,92,74,0.12)',
                },
              ]}
            >
              <Feather
                name={profile.status === 'banned' ? 'unlock' : 'slash'}
                size={16}
                color={profile.status === 'banned' ? colors.onTealPrimary : colors.stateDanger}
              />
              <Txt
                size={13}
                weight="semibold"
                color={profile.status === 'banned' ? colors.onTealPrimary : colors.stateDanger}
              >
                {profile.status === 'banned' ? 'تفعيل الحساب' : 'إيقاف الحساب'}
              </Txt>
            </Pressable>

            {/* Role */}
            <View style={{ gap: 8 }}>
              <Txt size={12} color={colors.textMuted}>
                الدور
              </Txt>
              <View style={styles.roleRow}>
                {ROLES.map((r) => {
                  const active = r.key === profile.role;
                  return (
                    <Pressable
                      key={r.key}
                      disabled={active || actions.setRole.isPending}
                      onPress={() =>
                        Alert.alert('تغيير الدور', `تعيين هذا الحساب كـ«${r.label}»؟`, [
                          { text: 'إلغاء', style: 'cancel' },
                          {
                            text: 'تأكيد',
                            onPress: () =>
                              actions.setRole.mutate(r.key, {
                                onSuccess: () => flash('تم تغيير الدور'),
                                onError,
                              }),
                          },
                        ])
                      }
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
            </View>
          </Card>

          {/* Edit data */}
          <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
            تعديل البيانات
          </Txt>
          <Card style={{ gap: 16 }}>
            <EditableField
              label="الاسم"
              initial={profile.displayName ?? ''}
              placeholder="الاسم"
              actionLabel="حفظ"
              pending={actions.setName.isPending}
              validate={(v, i) => v.trim().length > 0 && v.trim() !== i}
              onSave={(v) => actions.setName.mutate(v, { onSuccess: () => flash('تم حفظ الاسم'), onError })}
            />
            <Divider />
            <EditableField
              label="البريد الإلكتروني"
              initial={profile.email ?? ''}
              placeholder="name@example.com"
              actionLabel="حفظ"
              keyboardType="email-address"
              pending={actions.setEmail.isPending}
              validate={(v, i) => /.+@.+\..+/.test(v.trim()) && v.trim() !== i}
              onSave={(v) => actions.setEmail.mutate(v, { onSuccess: () => flash('تم تحديث البريد'), onError })}
            />
            <Divider />
            <EditableField
              label="كلمة سر جديدة (بدون معرفة القديمة)"
              initial=""
              placeholder="٦ أحرف على الأقل"
              actionLabel="تعيين"
              secure
              clearOnSave
              pending={actions.setPassword.isPending}
              validate={(v) => v.trim().length >= 6}
              onSave={(v) =>
                actions.setPassword.mutate(v, { onSuccess: () => flash('تم تعيين كلمة السر'), onError })
              }
            />
          </Card>

          {/* Progress */}
          <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
            {`التقدم (${arNum(data!.progress.length)})`}
          </Txt>
          {data!.progress.length === 0 ? (
            <Card>
              <Txt size={13} color={colors.textMuted} align="center">
                لا تقدم بعد.
              </Txt>
            </Card>
          ) : (
            <Card padded={false}>
              {data!.progress.map((p, i) => {
                const pct = p.durationSec && p.durationSec > 0 ? p.positionSec / p.durationSec : 0;
                return (
                  <React.Fragment key={p.lectureId}>
                    <View style={styles.progressRow}>
                      <View style={styles.progressHead}>
                        {p.completed ? (
                          <Feather name="check-circle" size={15} color={colors.stateSuccess} />
                        ) : (
                          <Feather name="circle" size={15} color={colors.textGhost} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Txt size={13} color={colors.textInk} numberOfLines={1}>
                            {p.lectureTitle}
                          </Txt>
                          {p.sectionTitle && (
                            <Txt size={11} color={colors.textFaint} numberOfLines={1} style={{ marginTop: 1 }}>
                              {p.sectionTitle}
                            </Txt>
                          )}
                        </View>
                        <Txt size={11} color={colors.textFaint} tabular>
                          {p.completed ? 'مكتمل' : arDuration(p.positionSec)}
                        </Txt>
                      </View>
                      {!p.completed && pct > 0 && (
                        <ProgressBar value={pct} style={{ marginTop: 8 }} />
                      )}
                    </View>
                    {i < data!.progress.length - 1 && <Divider />}
                  </React.Fragment>
                );
              })}
            </Card>
          )}

          {/* Quiz results */}
          <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
            {`نتائج الاختبارات (${arNum(data!.quizResults.length)})`}
          </Txt>
          {data!.quizResults.length === 0 ? (
            <Card style={{ marginBottom: 20 }}>
              <Txt size={13} color={colors.textMuted} align="center">
                لم يدخل أي اختبار بعد.
              </Txt>
            </Card>
          ) : (
            <Card padded={false} style={{ marginBottom: 20 }}>
              {data!.quizResults.map((q, i) => (
                <React.Fragment key={`${q.quizTitle}-${i}`}>
                  <View style={styles.quizRow}>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: q.passed
                            ? 'rgba(31,138,91,0.12)'
                            : 'rgba(184,92,74,0.12)',
                        },
                      ]}
                    >
                      <Txt size={11} weight="semibold" color={q.passed ? colors.stateSuccess : colors.stateDanger}>
                        {q.passed ? 'ناجح' : 'راسب'}
                      </Txt>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt size={13} color={colors.textInk} numberOfLines={1}>
                        {q.quizTitle}
                      </Txt>
                      <Txt size={11} color={colors.textFaint} style={{ marginTop: 1 }}>
                        {arDate(q.submittedAt)}
                      </Txt>
                    </View>
                    {q.score !== null && (
                      <Txt size={13} weight="semibold" color={colors.primaryTeal} tabular>
                        {arNum(q.score)}
                      </Txt>
                    )}
                  </View>
                  {i < data!.quizResults.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </Card>
          )}
        </>
      )}
    </AdminShell>
  );
}

function ProfileCard({ profile }: { profile: AdminUserProfile }) {
  const st = STATUS_META[profile.status] ?? STATUS_META.active;
  const gender = profile.gender === 'male' ? 'ذكر' : profile.gender === 'female' ? 'أنثى' : '—';
  const goal =
    profile.weeklyGoalTarget != null
      ? `${arNum(profile.weeklyGoalTarget)} ${profile.weeklyGoalMetric === 'minutes' ? 'دقيقة' : 'درساً'}`
      : 'لا هدف';
  return (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      <View style={styles.profileHead}>
        <View style={[styles.badge, { backgroundColor: st.bg }]}>
          <Txt size={11} weight="semibold" color={st.fg}>
            {st.label}
          </Txt>
        </View>
        <Txt size={13} color={colors.textMuted} style={{ flex: 1 }} numberOfLines={1}>
          {profile.email || profile.phone || 'حساب ضيف (بدون بريد)'}
        </Txt>
      </View>
      <Divider />
      <View style={{ padding: 16, gap: 2 }}>
        <InfoRow label="النوع" value={gender} />
        <InfoRow label="تاريخ التسجيل" value={arDate(profile.createdAt)} />
        <InfoRow label="آخر دخول" value={arSince(profile.lastOpenedAt)} />
        <InfoRow label="آخر تسجيل دخول" value={arDate(profile.lastSignInAt)} />
        <InfoRow label="المداومة الحالية" value={`${arNum(profile.currentStreak)} يوماً`} />
        <InfoRow label="الهدف الأسبوعي" value={goal} />
      </View>
    </Card>
  );
}

function TotalsCard({
  completed,
  inProgress,
  passed,
}: {
  completed: number;
  inProgress: number;
  passed: number;
}) {
  return (
    <View style={styles.totalsRow}>
      <Totals label="دروس مكتملة" value={completed} />
      <Totals label="قيد المتابعة" value={inProgress} />
      <Totals label="اختبارات مجتازة" value={passed} />
    </View>
  );
}

function Totals({ label, value }: { label: string; value: number }) {
  return (
    <Card style={styles.totalTile}>
      <Txt weight="display" size={24} color={colors.primaryTeal} style={{ lineHeight: 30 }}>
        {arNum(value)}
      </Txt>
      <Txt size={11} color={colors.textMuted} align="center">
        {label}
      </Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  } as ViewStyle,

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(31,138,91,0.1)',
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 14,
  } as ViewStyle,

  heading: { marginBottom: 12, marginTop: 20 } as TextStyle,

  profileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  } as ViewStyle,

  // Label right / value left: plain 'row' is RTL on native (forced) AND on web
  // (the document is dir="rtl"), so no per-platform branching is needed.
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 7,
  } as ViewStyle,

  totalsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  } as ViewStyle,

  totalTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  } as ViewStyle,

  wideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: radius.input,
  } as ViewStyle,

  roleRow: {
    flexDirection: 'row',
    gap: 8,
  } as ViewStyle,

  roleChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  roleChipActive: { backgroundColor: colors.primaryTeal } as ViewStyle,

  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  input: {
    flex: 1,
    fontFamily: 'IBMPlexSansArabic_400Regular',
    fontSize: 14,
    color: colors.textInk,
    textAlign: 'right',
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    height: 44,
  } as TextStyle,

  saveBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: radius.input,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  progressRow: { paddingHorizontal: 16, paddingVertical: 12 } as ViewStyle,

  progressHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  } as ViewStyle,

  quizRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  } as ViewStyle,

  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  } as ViewStyle,
});
