/**
 * مساحة الأسئلة — /admin/questions  (admin only).
 *
 * The admin-panel counterpart to the /sheikh inbox: admins are moderators, so
 * this lists get_question_inbox (all questions, asker_id resolved for admins)
 * with scope × status filters and offers, per question: answer (inline
 * composer), hide/unhide (0032 set_question_hidden), delete (hard), and
 * «حظر الكاتب» — the full account ban (admin-users `ban` on asker_id, reversible
 * from إدارة المستخدمين). Anonymity: admins see the real name, but a quiet
 * «سُئل بلا اسم» hint marks anonymous questions.
 */
import { Feather } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { InboxQuestion, QuestionScope, QuestionStatus } from '@/api/questions';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useAdminOnly } from '@/hooks/useAdminGuard';
import { useBanUser } from '@/hooks/useAdminUsers';
import {
  useAnswerQuestion,
  useDeleteQuestion,
  useQuestionInbox,
  useSetQuestionHidden,
} from '@/hooks/useQuestions';
import { arNum, arSince } from '@/lib/format';

type ScopeFilter = 'all' | QuestionScope;

const STATUS_META: Record<QuestionStatus, { label: string; bg: string; fg: string }> = {
  pending: { label: 'بانتظار الرد', bg: 'rgba(176,137,79,0.14)', fg: colors.accentBrassMuted },
  answered: { label: 'مُجاب', bg: 'rgba(31,138,91,0.12)', fg: colors.stateSuccess },
  hidden: { label: 'مخفي', bg: 'rgba(154,143,124,0.18)', fg: colors.textFaint },
};

function FilterChip({
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
      style={[styles.filterChip, active && styles.filterChipActive]}
    >
      <Txt
        size={12.5}
        weight={active ? 'semibold' : 'medium'}
        color={active ? colors.onTealPrimary : colors.textSlate}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

function QuestionCard({
  q,
  onDelete,
  onBlock,
}: {
  q: InboxQuestion;
  onDelete: () => void;
  onBlock: () => void;
}) {
  const answer = useAnswerQuestion();
  const setHidden = useSetQuestionHidden();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(q.answerBody ?? '');
  const [error, setError] = useState('');

  const st = STATUS_META[q.status];
  const isHidden = q.status === 'hidden';

  function submit() {
    const body = draft.trim();
    if (!body) return;
    setError('');
    answer.mutate(
      { questionId: q.id, answerBody: body },
      {
        onSuccess: () => setComposing(false),
        onError: (e) => setError(e instanceof Error ? e.message : 'تعذّر حفظ الجواب'),
      },
    );
  }

  return (
    <Card style={styles.questionCard}>
      {/* Meta row: asker · time · status */}
      <View style={styles.metaRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Feather name={q.isAnonymous ? 'user-x' : 'user'} size={13} color={colors.textGhost} />
          <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1}>
            {q.askerDisplay}
          </Txt>
          <Txt size={11.5} color={colors.textGhost}>
            {arSince(q.createdAt)}
          </Txt>
        </View>
        <View style={[styles.badge, { backgroundColor: st.bg }]}>
          <Txt size={10.5} weight="semibold" color={st.fg}>
            {st.label}
          </Txt>
        </View>
      </View>

      {/* Secondary tags: audience + anonymity hint */}
      <View style={styles.tagRow}>
        {q.audience === 'sheikh' ? (
          <View style={[styles.badge, styles.badgePrivate]}>
            <Txt size={10.5} weight="semibold" color={colors.accentBrassMuted}>
              للشيخ فقط
            </Txt>
          </View>
        ) : (
          <View style={styles.badge}>
            <Txt size={10.5} weight="medium" color={colors.textMuted}>
              عام
            </Txt>
          </View>
        )}
        {q.isAnonymous ? (
          <Txt size={10.5} color={colors.textGhost}>
            سُئل بلا اسم
          </Txt>
        ) : null}
        {q.lectureTitle ? (
          <View style={styles.lectureChip}>
            <Feather name="headphones" size={11} color={colors.primaryTeal600} />
            <Txt size={11} weight="medium" color={colors.primaryTeal600} numberOfLines={1}>
              {q.lectureTitle}
            </Txt>
          </View>
        ) : null}
      </View>

      {/* The question */}
      <Txt size={14.5} color={colors.textInk} style={styles.questionBody}>
        {q.body}
      </Txt>

      {/* Existing answer */}
      {q.answerBody && !composing ? (
        <View style={styles.answerBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="check-circle" size={13} color={colors.stateSuccess} />
            <Txt size={11.5} weight="semibold" color={colors.stateSuccess}>
              الجواب
            </Txt>
          </View>
          <Txt size={13.5} color={colors.textSlate} style={{ marginTop: 6, lineHeight: 22 }}>
            {q.answerBody}
          </Txt>
        </View>
      ) : null}

      {/* Inline composer */}
      {composing ? (
        <View style={{ marginTop: 12 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="اكتب الجواب هنا..."
            placeholderTextColor={colors.textGhost}
            multiline
            textAlign="right"
            textAlignVertical="top"
            style={styles.composer}
            autoFocus
          />
          {error ? (
            <Txt size={12} color={colors.stateDanger} style={{ marginTop: 6 }}>
              {error}
            </Txt>
          ) : null}
          <View style={styles.composerActions}>
            <Pressable
              onPress={submit}
              disabled={answer.isPending || !draft.trim()}
              style={({ pressed }) => [
                styles.primaryBtn,
                { opacity: pressed || answer.isPending || !draft.trim() ? 0.7 : 1 },
              ]}
            >
              {answer.isPending ? (
                <ActivityIndicator size="small" color={colors.onTealPrimary} />
              ) : (
                <Txt size={13} weight="semibold" color={colors.onTealPrimary}>
                  إرسال الجواب
                </Txt>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setComposing(false);
                setDraft(q.answerBody ?? '');
              }}
              style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
            >
              <Txt size={13} weight="medium" color={colors.textMuted}>
                إلغاء
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => setComposing(true)}
            style={({ pressed }) => [styles.answerBtn, pressed && { opacity: 0.8 }]}
          >
            <Feather
              name={q.answerBody ? 'edit-2' : 'message-circle'}
              size={14}
              color={colors.onTealPrimary}
            />
            <Txt size={12.5} weight="semibold" color={colors.onTealPrimary}>
              {q.answerBody ? 'تعديل الجواب' : 'الإجابة'}
            </Txt>
          </Pressable>

          <Pressable
            onPress={() => setHidden.mutate({ questionId: q.id, hidden: !isHidden })}
            disabled={setHidden.isPending}
            style={({ pressed }) => [styles.iconTextBtn, pressed && { opacity: 0.7 }]}
          >
            <Feather name={isHidden ? 'eye' : 'eye-off'} size={14} color={colors.textMuted} />
            <Txt size={12.5} weight="medium" color={colors.textMuted}>
              {isHidden ? 'إظهار' : 'إخفاء'}
            </Txt>
          </Pressable>

          {q.askerId ? (
            <Pressable
              onPress={onBlock}
              accessibilityLabel="حظر الكاتب"
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
            >
              <Feather name="slash" size={14} color={colors.stateDanger} />
            </Pressable>
          ) : null}

          <Pressable
            onPress={onDelete}
            accessibilityLabel="حذف السؤال"
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
          >
            <Feather name="trash-2" size={14} color={colors.stateDanger} />
          </Pressable>
        </View>
      )}
    </Card>
  );
}

export default function AdminQuestions() {
  useAdminOnly();
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [status, setStatus] = useState<QuestionStatus>('pending');
  const [pendingDelete, setPendingDelete] = useState<InboxQuestion | null>(null);
  const [pendingBlock, setPendingBlock] = useState<InboxQuestion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const deleteQuestion = useDeleteQuestion();
  const banUser = useBanUser();

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  const { data: questions, isLoading } = useQuestionInbox({
    scope: scope === 'all' ? undefined : scope,
    status,
  });

  const list = questions ?? [];

  const renderItem = useCallback(
    ({ item: q }: { item: InboxQuestion }) => (
      <QuestionCard q={q} onDelete={() => setPendingDelete(q)} onBlock={() => setPendingBlock(q)} />
    ),
    [],
  );

  const header = (
    <>
      <Txt weight="display" size={26} color={colors.primaryTeal} style={{ marginBottom: 4 }}>
        مساحة الأسئلة
      </Txt>
      <Txt size={13} color={colors.textMuted} style={{ marginBottom: 18 }}>
        أسئلة طلبة العلم — أجب، أو أخفِ، أو احذف، أو احظر الكاتب
      </Txt>

      {notice ? (
        <View style={styles.notice}>
          <Feather name="check" size={14} color={colors.stateSuccess} />
          <Txt size={12} color={colors.stateSuccess}>
            {notice}
          </Txt>
        </View>
      ) : null}

      {/* Filters */}
      <View style={styles.filterRow}>
        <FilterChip label="الكل" active={scope === 'all'} onPress={() => setScope('all')} />
        <FilterChip label="عامة" active={scope === 'general'} onPress={() => setScope('general')} />
        <FilterChip label="الدروس" active={scope === 'lecture'} onPress={() => setScope('lecture')} />
      </View>
      <View style={[styles.filterRow, { marginBottom: 18 }]}>
        <FilterChip label="بانتظار الرد" active={status === 'pending'} onPress={() => setStatus('pending')} />
        <FilterChip label="تمت الإجابة" active={status === 'answered'} onPress={() => setStatus('answered')} />
        <FilterChip label="المخفية" active={status === 'hidden'} onPress={() => setStatus('hidden')} />
      </View>

      {!isLoading && list.length > 0 ? (
        <Txt size={12} color={colors.textGhost} style={{ marginBottom: 10 }}>
          {arNum(list.length)} سؤال
        </Txt>
      ) : null}
    </>
  );

  return (
    <AdminShell active="questions" breadcrumb="مساحة الأسئلة" scroll={false}>
      <FlatList
        style={{ flex: 1 }}
        data={list}
        keyExtractor={(q) => q.id}
        renderItem={renderItem}
        initialNumToRender={10}
        ListHeaderComponent={header}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primaryTeal} />
            </View>
          ) : (
            <View style={{ paddingVertical: 60, alignItems: 'center', gap: 8 }}>
              <Feather name="inbox" size={26} color={colors.textGhost} />
              <Txt size={14} color={colors.textMuted} align="center">
                {status === 'pending'
                  ? 'لا أسئلة بانتظار الرد'
                  : status === 'answered'
                    ? 'لا أسئلة مجابة بعد'
                    : 'لا أسئلة مخفية'}
              </Txt>
            </View>
          )
        }
      />

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف السؤال"
        message="سيُحذف السؤال نهائياً ولن يظهر لأحد. هل أنت متأكد؟"
        confirmLabel="حذف"
        pending={deleteQuestion.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteQuestion.mutate(pendingDelete.id, {
            onSuccess: () => flash('تم حذف السؤال'),
            onSettled: () => setPendingDelete(null),
          });
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        visible={!!pendingBlock}
        title="حظر الكاتب"
        message={`سيُمنع «${pendingBlock?.askerDisplay ?? 'الكاتب'}» من الدخول إلى التطبيق. يمكنك رفع الحظر لاحقاً من إدارة المستخدمين.`}
        confirmLabel="حظر"
        pending={banUser.isPending}
        onConfirm={() => {
          if (!pendingBlock?.askerId) return;
          banUser.mutate(pendingBlock.askerId, {
            onSuccess: () => flash('تم حظر الكاتب'),
            onError: (e) => flash((e as Error).message),
            onSettled: () => setPendingBlock(null),
          });
        }}
        onCancel={() => setPendingBlock(null)}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(31,138,91,0.1)',
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 14,
  } as ViewStyle,

  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  } as ViewStyle,

  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  filterChipActive: {
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,

  questionCard: { marginBottom: 12 } as ViewStyle,

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  } as ViewStyle,

  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  } as ViewStyle,

  badge: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  badgePrivate: {
    backgroundColor: 'rgba(176,137,79,0.12)',
  } as ViewStyle,

  lectureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(44,97,87,0.08)',
    maxWidth: '100%',
  } as ViewStyle,

  questionBody: { marginTop: 10, lineHeight: 24 } as TextStyle,

  answerBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSandRaised,
    borderWidth: 1,
    borderColor: colors.borderSand,
  } as ViewStyle,

  composer: {
    minHeight: 96,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textInk,
  } as TextStyle,

  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  } as ViewStyle,

  primaryBtn: {
    height: 42,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  ghostBtn: {
    height: 42,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  } as ViewStyle,

  answerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,

  iconTextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,
});
