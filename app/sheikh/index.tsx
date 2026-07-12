/**
 * واجهة الشيخ — inbox of student questions (V6 Feature A).
 *
 * Route: /sheikh (AuthGate lands sheikh-role users here and keeps them out of
 * /admin and the student tabs). Segmented filters (عامة / الدروس) ×
 * (بانتظار الرد / تمت الإجابة), question cards with an inline answer composer
 * and a delete action. Anonymity: the RPC already replaced anonymous askers
 * with «سائل» — this screen never sees their identity.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { InboxQuestion, QuestionCategory, QuestionScope } from '@/api/questions';
import { SidebarDrawer } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Divider, Logo, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useSignOut } from '@/hooks/useAuth';
import { useNotificationPrefs, useSetNotificationPref } from '@/hooks/useNotifications';
import { useAnswerQuestion, useDeleteQuestion, useQuestionInbox } from '@/hooks/useQuestions';
import { arNum, arSince } from '@/lib/format';

type ScopeFilter = 'all' | QuestionScope;
type StatusFilter = 'pending' | 'answered';

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
      style={({ pressed }) => [
        styles.filterChip,
        active && styles.filterChipActive,
        pressed && !active && { opacity: 0.7 },
      ]}
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
}: {
  q: InboxQuestion;
  onDelete: () => void;
}) {
  const answer = useAnswerQuestion();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(q.answerBody ?? '');
  const [error, setError] = useState('');

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
      {/* Meta row: asker · time · badges */}
      <View style={styles.metaRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Feather
            name={q.isAnonymous ? 'user-x' : 'user'}
            size={13}
            color={colors.textGhost}
          />
          <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1}>
            {q.askerDisplay}
          </Txt>
          <Txt size={11.5} color={colors.textGhost}>
            {arSince(q.createdAt)}
          </Txt>
        </View>
        <View style={[styles.badge, q.category === 'fatwa' && styles.badgePrivate]}>
          <Txt size={10.5} weight="semibold" color={q.category === 'fatwa' ? colors.accentBrassMuted : colors.textMuted}>
            {q.category === 'fatwa' ? 'فتوى شرعية' : 'سؤال عام'}
          </Txt>
        </View>
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
      </View>

      {/* Lecture chip when lesson-scoped */}
      {q.lectureTitle ? (
        <View style={styles.lectureChip}>
          <Feather name="headphones" size={12} color={colors.primaryTeal600} />
          <Txt size={11.5} weight="medium" color={colors.primaryTeal600} numberOfLines={1}>
            {q.sectionTitle ? `${q.sectionTitle} ← ${q.lectureTitle}` : q.lectureTitle}
          </Txt>
        </View>
      ) : null}

      {/* The question */}
      <Txt size={14.5} color={colors.textInk} style={styles.questionBody}>
        {q.body}
      </Txt>

      {/* Existing answer */}
      {q.status === 'answered' && q.answerBody && !composing ? (
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
              name={q.status === 'answered' ? 'edit-2' : 'message-circle'}
              size={14}
              color={colors.onTealPrimary}
            />
            <Txt size={12.5} weight="semibold" color={colors.onTealPrimary}>
              {q.status === 'answered' ? 'تعديل الجواب' : 'الإجابة'}
            </Txt>
          </Pressable>
          <Pressable
            onPress={onDelete}
            accessibilityLabel="حذف السؤال"
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
          >
            <Feather name="trash-2" size={14} color={colors.stateDanger} />
          </Pressable>
        </View>
      )}
    </Card>
  );
}

export default function SheikhInboxScreen() {
  const router = useRouter();
  const signOut = useSignOut();
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [category, setCategory] = useState<QuestionCategory | 'all'>('all');
  const [pendingDelete, setPendingDelete] = useState<InboxQuestion | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const deleteQuestion = useDeleteQuestion();

  // The sheikh never sees the student prefs page, so their «سؤال جديد» toggle
  // lives here — one calm switch, revealed by the bell.
  const { data: prefs } = useNotificationPrefs();
  const setPref = useSetNotificationPref();
  const questionAlerts = prefs?.question_received ?? true;

  const { data: questions, isLoading } = useQuestionInbox({
    scope: scope === 'all' ? undefined : scope,
    status,
    category: category === 'all' ? undefined : category,
  });

  return (
    // KeyboardAvoidingView + `padding` (same fix as ملاحظاتي's note editor):
    // the app is edge-to-edge, so an open keyboard OVERLAYS the screen rather
    // than resizing it. Without this the composer TextInput — which can sit
    // anywhere down this scrollable list, not just at the top — was left
    // covered by the keyboard with no way to see what was being typed.
    // Screen's own ScrollView auto-scrolls the focused input into whatever
    // room this frees up.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen bottomPad={40}>
        {/* ── Header ── */}
        <View style={styles.header}>
          {/* Same `menu` hamburger, same start (right) placement, and same
              BEHAVIOUR as every AdminShell tab: it opens the nav sidebar in
              place (drawer) — it does NOT navigate away. */}
          <Pressable
            onPress={() => setDrawerOpen(true)}
            accessibilityLabel="القائمة"
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
          >
            <Feather name="menu" size={20} color={colors.textSlate} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
            <Logo size={40} />
            <View>
              <Txt weight="display" size={20} color={colors.primaryTeal}>
                أسئلة طلبة العلم
              </Txt>
              <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
                أجب بما يفتح الله به عليك
              </Txt>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => setShowSettings((s) => !s)}
              accessibilityLabel="إعدادات التنبيهات"
              style={({ pressed }) => [
                styles.iconBtn,
                showSettings && styles.iconBtnActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Feather
                name="bell"
                size={17}
                color={showSettings ? colors.primaryTeal : colors.textMuted}
              />
            </Pressable>
            <Pressable
              onPress={async () => {
                try {
                  await signOut.mutateAsync();
                } catch {
                  // Session is cleared locally even on server errors.
                }
                router.replace('/');
              }}
              disabled={signOut.isPending}
              accessibilityLabel="تسجيل الخروج"
              style={({ pressed }) => [
                styles.iconBtn,
                (pressed || signOut.isPending) && { opacity: 0.7 },
              ]}
            >
              {signOut.isPending ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Feather name="log-out" size={17} color={colors.textMuted} />
              )}
            </Pressable>
          </View>
        </View>

        {showSettings ? (
          <Card style={styles.settingsCard}>
            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Txt size={13.5} weight="semibold" color={colors.textInk}>
                  تنبيه سؤال جديد
                </Txt>
                <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 3, lineHeight: 18 }}>
                  إشعار عند وصول سؤال جديد من طالب علم
                </Txt>
              </View>
              <Switch
                value={questionAlerts}
                onValueChange={(next) =>
                  setPref.mutate({ type: 'question_received', enabled: next })
                }
                trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
                thumbColor={colors.surfaceWhite}
                ios_backgroundColor={colors.surfaceInset}
              />
            </View>
          </Card>
        ) : null}

        <Divider />

        {/* ── Filters ── */}
        <View style={styles.filters}>
          <View style={styles.filterRow}>
            <FilterChip label="الكل" active={scope === 'all'} onPress={() => setScope('all')} />
            <FilterChip label="عامة" active={scope === 'general'} onPress={() => setScope('general')} />
            <FilterChip label="الدروس" active={scope === 'lecture'} onPress={() => setScope('lecture')} />
          </View>
          <View style={styles.filterRow}>
            <FilterChip
              label="بانتظار الرد"
              active={status === 'pending'}
              onPress={() => setStatus('pending')}
            />
            <FilterChip
              label="تمت الإجابة"
              active={status === 'answered'}
              onPress={() => setStatus('answered')}
            />
          </View>
          <View style={styles.filterRow}>
            <FilterChip label="كل التصنيفات" active={category === 'all'} onPress={() => setCategory('all')} />
            <FilterChip label="سؤال عام" active={category === 'general'} onPress={() => setCategory('general')} />
            <FilterChip label="فتوى شرعية" active={category === 'fatwa'} onPress={() => setCategory('fatwa')} />
          </View>
        </View>

        {/* ── List ── */}
        {isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primaryTeal} />
          </View>
        ) : (questions ?? []).length === 0 ? (
          <View style={{ paddingVertical: 60, alignItems: 'center', gap: 8 }}>
            <Feather name="inbox" size={26} color={colors.textGhost} />
            <Txt size={14} color={colors.textMuted} align="center">
              {status === 'pending' ? 'لا أسئلة بانتظار الرد' : 'لا أسئلة مجابة بعد'}
            </Txt>
          </View>
        ) : (
          <>
            <Txt size={12} color={colors.textGhost} style={{ marginBottom: 10 }}>
              {arNum((questions ?? []).length)} سؤال
            </Txt>
            {(questions ?? []).map((q) => (
              <QuestionCard key={q.id} q={q} onDelete={() => setPendingDelete(q)} />
            ))}
          </>
        )}

        <ConfirmDialog
          visible={!!pendingDelete}
          title="حذف السؤال"
          message="سيُحذف السؤال نهائياً ولن يظهر لأحد. هل أنت متأكد؟"
          confirmLabel="حذف"
          pending={deleteQuestion.isPending}
          onConfirm={() => {
            if (!pendingDelete) return;
            deleteQuestion.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
          }}
          onCancel={() => setPendingDelete(null)}
        />

        {/* Same nav sidebar as the AdminShell tabs, opened in place. */}
        <SidebarDrawer
          visible={drawerOpen}
          active="questions-inbox"
          onClose={() => setDrawerOpen(false)}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 16,
  } as ViewStyle,

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  iconBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  iconBtnActive: {
    backgroundColor: 'rgba(44,97,87,0.10)',
  } as ViewStyle,

  settingsCard: { marginTop: 12, marginBottom: 4 } as ViewStyle,

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  } as ViewStyle,

  filters: { marginTop: 16, marginBottom: 18, gap: 8 } as ViewStyle,

  filterRow: {
    flexDirection: 'row',
    gap: 8,
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
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(44,97,87,0.08)',
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
    justifyContent: 'space-between',
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

  deleteBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  } as ViewStyle,
});
