/**
 * مشاركات الدارسين — admin moderation (V6, admin-only).
 *
 * Two tabs:
 *   «فوائد الدارسين» — every فائدة with the RESOLVED author (name + email —
 *     admin is the only role that ever sees it); إخفاء/إظهار · حذف · حظر الكاتب.
 *   «الأسئلة» — every question incl. sheikh-only; anonymous askers show as
 *     «سائل» even here (V14 — only asker_id ships, for the ban action);
 *     حذف · حظر السائل. Answering stays the sheikh's job.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { AdminBenefitRow } from '@/api/benefits';
import type { InboxQuestion } from '@/api/questions';
import { banUser } from '@/api/adminUsers';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import {
  useAdminBenefits,
  useAdminDeleteBenefit,
  useAdminSetBenefitStatus,
} from '@/hooks/useBenefits';
import { useDeleteQuestion, useQuestionInbox } from '@/hooks/useQuestions';
import { arNum, arSince } from '@/lib/format';
import { notify } from '@/lib/notify';

type Tab = 'benefits' | 'questions';

function TabChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.tabChip,
        active && styles.tabChipActive,
        pressed && !active && { opacity: 0.7 },
      ]}
    >
      <Txt
        size={13}
        weight={active ? 'semibold' : 'medium'}
        color={active ? colors.onTealPrimary : colors.textSlate}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

function ActionBtn({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
    >
      <Feather name={icon} size={13} color={color} />
      <Txt size={12} weight="medium" color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

function useBanAuthor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => banUser(userId),
    onSuccess: () => {
      notify('تم الحظر', 'حُظر الحساب وسُجّل خروجه من جميع الأجهزة.');
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (e) => notify('تعذّر الحظر', (e as Error).message),
  });
}

// ─── Benefits tab ─────────────────────────────────────────────────────────────

function BenefitsTab() {
  const { data: benefits, isLoading } = useAdminBenefits();
  const setStatus = useAdminSetBenefitStatus();
  const deleteBenefit = useAdminDeleteBenefit();
  const ban = useBanAuthor();
  const [pendingDelete, setPendingDelete] = useState<AdminBenefitRow | null>(null);
  const [pendingBan, setPendingBan] = useState<AdminBenefitRow | null>(null);

  if (isLoading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.primaryTeal} />
      </View>
    );
  }
  if ((benefits ?? []).length === 0) {
    return (
      <Card>
        <Txt size={13} color={colors.textMuted} align="center">
          لا فوائد منشورة بعد.
        </Txt>
      </Card>
    );
  }

  return (
    <>
      <Txt size={12} color={colors.textGhost} style={{ marginBottom: 10 }}>
        {arNum((benefits ?? []).length)} فائدة · يظهر الكاتب هنا للمشرف فقط
      </Txt>
      {(benefits ?? []).map((b) => (
        <Card key={b.id} style={styles.itemCard}>
          <View style={styles.metaRow}>
            <Feather name="user" size={13} color={colors.textGhost} />
            <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1}>
              {b.authorName}
            </Txt>
            {b.authorEmail ? (
              <Txt size={11.5} color={colors.textGhost} numberOfLines={1} style={{ flexShrink: 1 }}>
                {b.authorEmail}
              </Txt>
            ) : null}
            <View style={{ flex: 1 }} />
            {b.status === 'hidden' ? (
              <View style={styles.hiddenBadge}>
                <Txt size={10.5} weight="semibold" color={colors.stateDanger}>
                  مخفية
                </Txt>
              </View>
            ) : null}
            <Txt size={11.5} color={colors.textGhost}>
              {arSince(b.createdAt)}
            </Txt>
          </View>
          <View style={styles.lectureChip}>
            <Feather name="headphones" size={12} color={colors.primaryTeal600} />
            <Txt size={11.5} weight="medium" color={colors.primaryTeal600} numberOfLines={1}>
              {b.sectionTitle ? `${b.sectionTitle} ← ${b.lectureTitle}` : b.lectureTitle}
            </Txt>
          </View>
          <Txt size={14} color={colors.textInk} style={{ marginTop: 8, lineHeight: 23 }}>
            {b.body}
          </Txt>
          <View style={styles.actionsRow}>
            <ActionBtn
              icon={b.status === 'visible' ? 'eye-off' : 'eye'}
              label={b.status === 'visible' ? 'إخفاء' : 'إظهار'}
              color={colors.primaryTeal600}
              onPress={() =>
                setStatus.mutate(
                  {
                    benefitId: b.id,
                    status: b.status === 'visible' ? 'hidden' : 'visible',
                  },
                  { onError: (e) => notify('تعذّر تغيير الحالة', (e as Error).message) },
                )
              }
            />
            <ActionBtn
              icon="trash-2"
              label="حذف"
              color={colors.stateDanger}
              onPress={() => setPendingDelete(b)}
            />
            <ActionBtn
              icon="slash"
              label="حظر الكاتب"
              color={colors.stateDanger}
              onPress={() => setPendingBan(b)}
            />
          </View>
        </Card>
      ))}

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف الفائدة"
        message="ستُحذف الفائدة نهائياً."
        confirmLabel="حذف"
        pending={deleteBenefit.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteBenefit.mutate(pendingDelete.id, {
            onSettled: () => setPendingDelete(null),
            onError: (e) => notify('تعذّر الحذف', (e as Error).message),
          });
        }}
        onCancel={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        visible={!!pendingBan}
        title="حظر الكاتب"
        message={`سيُحظر «${pendingBan?.authorName ?? ''}» من الدخول نهائياً (يمكن رفع الحظر من إدارة المستخدمين).`}
        confirmLabel="حظر"
        pending={ban.isPending}
        onConfirm={() => {
          if (!pendingBan) return;
          ban.mutate(pendingBan.authorId, { onSettled: () => setPendingBan(null) });
        }}
        onCancel={() => setPendingBan(null)}
      />
    </>
  );
}

// ─── Questions tab ────────────────────────────────────────────────────────────

function QuestionsTab() {
  const { data: questions, isLoading } = useQuestionInbox({});
  const deleteQuestion = useDeleteQuestion();
  const ban = useBanAuthor();
  const [pendingDelete, setPendingDelete] = useState<InboxQuestion | null>(null);
  const [pendingBan, setPendingBan] = useState<InboxQuestion | null>(null);

  if (isLoading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.primaryTeal} />
      </View>
    );
  }
  if ((questions ?? []).length === 0) {
    return (
      <Card>
        <Txt size={13} color={colors.textMuted} align="center">
          لا أسئلة بعد.
        </Txt>
      </Card>
    );
  }

  return (
    <>
      <Txt size={12} color={colors.textGhost} style={{ marginBottom: 10 }}>
        {arNum((questions ?? []).length)} سؤال · من أخفى اسمه يظهر «سائل» حتى هنا
      </Txt>
      {(questions ?? []).map((q) => (
        <Card key={q.id} style={styles.itemCard}>
          <View style={styles.metaRow}>
            <Feather name={q.isAnonymous ? 'user-x' : 'user'} size={13} color={colors.textGhost} />
            <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1}>
              {q.askerDisplay}
            </Txt>
            {q.isAnonymous ? (
              <Txt size={11} color={colors.textGhost}>
                (سُئل بلا اسم)
              </Txt>
            ) : null}
            <View style={{ flex: 1 }} />
            {q.audience === 'sheikh' ? (
              <View style={styles.privateBadge}>
                <Txt size={10.5} weight="semibold" color={colors.accentBrassMuted}>
                  للشيخ فقط
                </Txt>
              </View>
            ) : null}
            <Txt size={11.5} color={colors.textGhost}>
              {arSince(q.createdAt)}
            </Txt>
          </View>
          {q.lectureTitle ? (
            <View style={styles.lectureChip}>
              <Feather name="headphones" size={12} color={colors.primaryTeal600} />
              <Txt size={11.5} weight="medium" color={colors.primaryTeal600} numberOfLines={1}>
                {q.sectionTitle ? `${q.sectionTitle} ← ${q.lectureTitle}` : q.lectureTitle}
              </Txt>
            </View>
          ) : null}
          <Txt size={14} color={colors.textInk} style={{ marginTop: 8, lineHeight: 23 }}>
            {q.body}
          </Txt>
          {q.answerBody ? (
            <View style={styles.answerBox}>
              <Txt size={11.5} weight="semibold" color={colors.stateSuccess}>
                الجواب
              </Txt>
              <Txt size={13} color={colors.textSlate} style={{ marginTop: 4, lineHeight: 21 }}>
                {q.answerBody}
              </Txt>
            </View>
          ) : (
            <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 8 }}>
              بانتظار جواب الشيخ
            </Txt>
          )}
          <View style={styles.actionsRow}>
            <ActionBtn
              icon="trash-2"
              label="حذف"
              color={colors.stateDanger}
              onPress={() => setPendingDelete(q)}
            />
            {q.askerId ? (
              <ActionBtn
                icon="slash"
                label="حظر السائل"
                color={colors.stateDanger}
                onPress={() => setPendingBan(q)}
              />
            ) : null}
          </View>
        </Card>
      ))}

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف السؤال"
        message="سيُحذف السؤال نهائياً ولن يظهر لأحد."
        confirmLabel="حذف"
        pending={deleteQuestion.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteQuestion.mutate(pendingDelete.id, {
            onSettled: () => setPendingDelete(null),
            onError: (e) => notify('تعذّر الحذف', (e as Error).message),
          });
        }}
        onCancel={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        visible={!!pendingBan}
        title="حظر السائل"
        message={`سيُحظر «${pendingBan?.askerDisplay ?? ''}» من الدخول نهائياً (يمكن رفع الحظر من إدارة المستخدمين).`}
        confirmLabel="حظر"
        pending={ban.isPending}
        onConfirm={() => {
          if (!pendingBan?.askerId) return;
          ban.mutate(pendingBan.askerId, { onSettled: () => setPendingBan(null) });
        }}
        onCancel={() => setPendingBan(null)}
      />
    </>
  );
}

export default function ContributionsScreen() {
  const [tab, setTab] = useState<Tab>('benefits');

  return (
    <AdminShell active="contributions" breadcrumb="مشاركات الدارسين">
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        مشاركات الدارسين
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        مراجعة فوائد الدارسين والأسئلة — الهوية تظهر هنا فقط، ولا تُعرض للعامة أبداً
      </Txt>

      <View style={styles.tabsRow}>
        <TabChip
          label="فوائد الدارسين"
          active={tab === 'benefits'}
          onPress={() => setTab('benefits')}
        />
        <TabChip label="الأسئلة" active={tab === 'questions'} onPress={() => setTab('questions')} />
      </View>

      <View style={{ maxWidth: 860 }}>
        {tab === 'benefits' ? <BenefitsTab /> : <QuestionsTab />}
      </View>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 22 } as TextStyle,

  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  } as ViewStyle,

  tabChip: {
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  tabChipActive: {
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,

  itemCard: { marginBottom: 12 } as ViewStyle,

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  lectureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(44,97,87,0.08)',
  } as ViewStyle,

  hiddenBadge: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(184,92,74,0.1)',
  } as ViewStyle,

  privateBadge: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(176,137,79,0.12)',
  } as ViewStyle,

  answerBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSandRaised,
    borderWidth: 1,
    borderColor: colors.borderSand,
  } as ViewStyle,

  actionsRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 12,
  } as ViewStyle,

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  } as ViewStyle,

  loadingBox: { paddingVertical: 40, alignItems: 'center' } as ViewStyle,
});
