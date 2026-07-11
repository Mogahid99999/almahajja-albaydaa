/**
 * Shared Q&A board (V6 Feature A) — used by ساحة الأسئلة (scope 'general') and
 * أسئلة الدرس (scope 'lecture'). Two tabs:
 *   «الأسئلة المجابة» — public answered questions (Q + A, name or «سائل»)
 *   «أسئلتي»          — the caller's own, any status («قيد المراجعة»)
 * plus a compose card (body + إخفاء الاسم + للعامة/للشيخ فقط), registered-only —
 * guests get the calm quiz-style register nudge.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
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

import type {
  MyQuestion,
  PublicQuestion,
  QuestionAudience,
  QuestionCategory,
  QuestionScope,
} from '@/api/questions';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { ReportSheet } from '@/components/reports/ReportSheet';
import { Card, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import {
  useAskQuestion,
  useDeleteOwnQuestion,
  useMyQuestions,
  usePublicQuestions,
  useUpdateOwnQuestion,
} from '@/hooks/useQuestions';
import { useReportContent } from '@/hooks/useReports';
import { arSince } from '@/lib/format';

function SegChip({
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
        styles.segChip,
        active && styles.segChipActive,
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

/** Small on/off pill used inside the composer (إخفاء الاسم / للشيخ فقط). */
function TogglePill({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.togglePill,
        active && styles.togglePillActive,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Feather
        name={icon}
        size={13}
        color={active ? colors.accentBrassMuted : colors.textGhost}
      />
      <Txt
        size={12}
        weight={active ? 'semibold' : 'medium'}
        color={active ? colors.accentBrassMuted : colors.textMuted}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

function RegisterNudge() {
  const router = useRouter();
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Feather name="user-plus" size={16} color={colors.accentBrassMuted} />
        <Txt size={12.5} color={colors.textMuted} style={{ flex: 1, lineHeight: 20 }}>
          طرح سؤال يتطلب حساباً — حتى يصلك الجواب ويبقى معك.
        </Txt>
      </View>
      <Pressable
        onPress={() => router.push('/(auth)/register')}
        style={({ pressed }) => [styles.registerBtn, pressed && { opacity: 0.85 }]}
      >
        <Txt size={13.5} weight="semibold" color={colors.onTealPrimary}>
          إنشاء حساب
        </Txt>
      </Pressable>
    </Card>
  );
}

function Composer({ scope, lectureId }: { scope: QuestionScope; lectureId?: string }) {
  const ask = useAskQuestion();
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [audience, setAudience] = useState<QuestionAudience>('public');
  const [category, setCategory] = useState<QuestionCategory>('general');
  const [error, setError] = useState('');
  // Captured at submit time so the confirmation states clearly whether the
  // asker's name will show (the toggles may change before the line is read).
  const [sent, setSent] = useState<{ anonymous: boolean; audience: QuestionAudience } | null>(
    null,
  );

  function submit() {
    const text = body.trim();
    if (!text) return;
    setError('');
    ask.mutate(
      { scope, lectureId, isAnonymous: anonymous, audience, body: text, category },
      {
        onSuccess: () => {
          setBody('');
          setSent({ anonymous, audience });
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'تعذّر إرسال السؤال'),
      },
    );
  }

  const sentMessage = sent
    ? sent.audience === 'sheikh'
      ? `وصل سؤالك${sent.anonymous ? ' دون اسمك' : ' باسمك'}، ولن يطّلع عليه إلا الشيخ.`
      : sent.anonymous
        ? 'وصل سؤالك دون اسمك — يظهر للعامة بعد الإجابة بلا اسم.'
        : 'وصل سؤالك باسمك — يظهر للعامة بعد الإجابة مقروناً باسمك.'
    : '';

  return (
    <Card style={{ marginBottom: 12 }}>
      <Txt weight="semibold" size={14} color={colors.textInk}>
        اسأل سؤالاً
      </Txt>
      <TextInput
        value={body}
        onChangeText={(t) => {
          setBody(t);
          if (sent) setSent(null);
        }}
        placeholder="اكتب سؤالك هنا..."
        placeholderTextColor={colors.textGhost}
        multiline
        textAlign="right"
        textAlignVertical="top"
        style={styles.composerInput}
      />

      {/* Category: سؤال عام أو فتوى شرعية. The shared tabsRow bottom margin is
          zeroed here — the options row below brings its own 12px top margin,
          and letting both stack read as a hole in the composer's 12px rhythm. */}
      <View style={[styles.tabsRow, { marginTop: 12, marginBottom: 0 }]}>
        <SegChip
          label="سؤال عام"
          active={category === 'general'}
          onPress={() => setCategory('general')}
        />
        <SegChip
          label="فتوى شرعية"
          active={category === 'fatwa'}
          onPress={() => setCategory('fatwa')}
        />
      </View>

      {/* Options: anonymity + audience */}
      <View style={styles.optionsRow}>
        <TogglePill
          label={anonymous ? 'إخفاء الاسم' : 'نشر باسمي'}
          icon={anonymous ? 'eye-off' : 'user'}
          active={anonymous}
          onPress={() => setAnonymous((v) => !v)}
        />
        <TogglePill
          label={audience === 'sheikh' ? 'للشيخ فقط' : 'للعامة'}
          icon={audience === 'sheikh' ? 'lock' : 'globe'}
          active={audience === 'sheikh'}
          onPress={() => setAudience((a) => (a === 'sheikh' ? 'public' : 'sheikh'))}
        />
      </View>
      <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 12, lineHeight: 18 }}>
        {audience === 'sheikh'
          ? 'لن يطّلع على سؤالك إلا الشيخ.'
          : anonymous
            ? 'يُعرض سؤالك للعامة بعد الإجابة، دون اسمك.'
            : 'يُعرض سؤالك للعامة بعد الإجابة.'}
      </Txt>

      {error ? (
        <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
          {error}
        </Txt>
      ) : null}
      {sent ? (
        <View style={styles.sentRow}>
          <Feather name="check-circle" size={14} color={colors.stateSuccess} />
          <Txt size={12.5} color={colors.stateSuccess} style={{ flex: 1, lineHeight: 19 }}>
            {sentMessage}
          </Txt>
        </View>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={ask.isPending || !body.trim()}
        style={({ pressed }) => [
          styles.submitBtn,
          { opacity: pressed || ask.isPending || !body.trim() ? 0.7 : 1 },
        ]}
      >
        {ask.isPending ? (
          <ActivityIndicator size="small" color={colors.onTealPrimary} />
        ) : (
          <Txt size={13.5} weight="semibold" color={colors.onTealPrimary}>
            إرسال السؤال
          </Txt>
        )}
      </Pressable>
    </Card>
  );
}

function CategoryBadge({ category }: { category: QuestionCategory }) {
  const isFatwa = category === 'fatwa';
  return (
    <View style={[styles.categoryBadge, isFatwa && styles.categoryBadgeFatwa]}>
      <Txt size={10.5} weight="semibold" color={isFatwa ? colors.accentBrassMuted : colors.primaryTeal600}>
        {isFatwa ? 'فتوى شرعية' : 'سؤال عام'}
      </Txt>
    </View>
  );
}

function PublicQuestionCard({ q, onReport }: { q: PublicQuestion; onReport: () => void }) {
  return (
    <Card style={styles.qCard}>
      <View style={styles.qMetaRow}>
        <Feather name={q.askerDisplay ? 'user' : 'user-x'} size={13} color={colors.textGhost} />
        <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1} style={{ flex: 1 }}>
          {q.askerDisplay ?? 'سائل'}
        </Txt>
        <CategoryBadge category={q.category} />
        <Txt size={11.5} color={colors.textGhost}>
          {arSince(q.createdAt)}
        </Txt>
        <Pressable
          onPress={onReport}
          accessibilityLabel="الإبلاغ عن هذا السؤال"
          hitSlop={6}
          style={({ pressed }) => [styles.deleteMineBtn, pressed && { opacity: 0.7 }]}
        >
          <Feather name="flag" size={14} color={colors.textGhost} />
        </Pressable>
      </View>
      <Txt size={14.5} weight="medium" color={colors.textInk} style={styles.qBody}>
        {q.body}
      </Txt>
      {q.answerBody ? (
        <View style={styles.answerBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="message-circle" size={13} color={colors.primaryTeal600} />
            <Txt size={11.5} weight="semibold" color={colors.primaryTeal600}>
              جواب الشيخ
            </Txt>
          </View>
          <Txt size={13.5} color={colors.textSlate} style={{ marginTop: 6, lineHeight: 22 }}>
            {q.answerBody}
          </Txt>
        </View>
      ) : null}
    </Card>
  );
}

function MyQuestionCard({
  q,
  onDelete,
  onReport,
}: {
  q: MyQuestion;
  onDelete: () => void;
  onReport: () => void;
}) {
  const pending = q.status === 'pending';
  const update = useUpdateOwnQuestion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(q.body);
  const [audience, setAudience] = useState<QuestionAudience>(q.audience);
  const [category, setCategory] = useState<QuestionCategory>(q.category);
  const [editError, setEditError] = useState('');

  function startEdit() {
    setDraft(q.body);
    setAudience(q.audience);
    setCategory(q.category);
    setEditError('');
    setEditing(true);
  }

  function saveEdit() {
    const text = draft.trim();
    if (!text) return;
    setEditError('');
    update.mutate(
      { id: q.id, body: text, audience, category },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => setEditError(e instanceof Error ? e.message : 'تعذّر حفظ التعديل'),
      },
    );
  }

  return (
    <Card style={styles.qCard}>
      <View style={styles.qMetaRow}>
        <View
          style={[
            styles.statusBadge,
            pending ? styles.statusPending : styles.statusAnswered,
          ]}
        >
          <Txt
            size={10.5}
            weight="semibold"
            color={pending ? colors.accentBrassMuted : colors.stateSuccess}
          >
            {pending ? 'قيد المراجعة' : 'تمت الإجابة'}
          </Txt>
        </View>
        <CategoryBadge category={q.category} />
        {q.audience === 'sheikh' ? (
          <Txt size={11} color={colors.textGhost}>
            للشيخ فقط
          </Txt>
        ) : null}
        {/* Always state whether the asker's name shows — never leave it implicit. */}
        <View style={styles.nameBadge}>
          <Feather
            name={q.isAnonymous ? 'eye-off' : 'user'}
            size={11}
            color={q.isAnonymous ? colors.accentBrassMuted : colors.primaryTeal600}
          />
          <Txt
            size={10.5}
            weight="medium"
            color={q.isAnonymous ? colors.accentBrassMuted : colors.primaryTeal600}
          >
            {q.isAnonymous ? 'دون اسمك' : 'باسمك'}
          </Txt>
        </View>
        <View style={{ flex: 1 }} />
        <Txt size={11.5} color={colors.textGhost}>
          {arSince(q.createdAt)}
        </Txt>
        <Pressable
          onPress={onReport}
          accessibilityLabel="الإبلاغ عن هذا السؤال"
          hitSlop={6}
          style={({ pressed }) => [styles.deleteMineBtn, pressed && { opacity: 0.7 }]}
        >
          <Feather name="flag" size={14} color={colors.textGhost} />
        </Pressable>
        <Pressable
          onPress={editing ? () => setEditing(false) : startEdit}
          accessibilityLabel="تعديل سؤالي"
          hitSlop={6}
          style={({ pressed }) => [styles.deleteMineBtn, pressed && { opacity: 0.7 }]}
        >
          <Feather name="edit-2" size={14} color={editing ? colors.primaryTeal600 : colors.textGhost} />
        </Pressable>
        <Pressable
          onPress={onDelete}
          accessibilityLabel="حذف سؤالي"
          hitSlop={6}
          style={({ pressed }) => [styles.deleteMineBtn, pressed && { opacity: 0.7 }]}
        >
          <Feather name="trash-2" size={14} color={colors.stateDanger} />
        </Pressable>
      </View>
      {editing ? (
        <View style={{ marginTop: 10 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="اكتب سؤالك هنا..."
            placeholderTextColor={colors.textGhost}
            multiline
            textAlign="right"
            textAlignVertical="top"
            style={styles.composerInput}
            autoFocus
          />
          <View style={[styles.tabsRow, { marginTop: 12, marginBottom: 0 }]}>
            <SegChip
              label="سؤال عام"
              active={category === 'general'}
              onPress={() => setCategory('general')}
            />
            <SegChip
              label="فتوى شرعية"
              active={category === 'fatwa'}
              onPress={() => setCategory('fatwa')}
            />
          </View>
          <View style={styles.optionsRow}>
            <TogglePill
              label={audience === 'sheikh' ? 'للشيخ فقط' : 'للعامة'}
              icon={audience === 'sheikh' ? 'lock' : 'globe'}
              active={audience === 'sheikh'}
              onPress={() => setAudience((a) => (a === 'sheikh' ? 'public' : 'sheikh'))}
            />
          </View>
          {q.status === 'answered' ? (
            <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 12, lineHeight: 18 }}>
              تغيير نصّ السؤال يُعيده إلى قيد المراجعة ويُزيل الجواب الحالي.
            </Txt>
          ) : null}
          {editError ? (
            <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
              {editError}
            </Txt>
          ) : null}
          <View style={styles.editActionsRow}>
            <Pressable
              onPress={saveEdit}
              disabled={update.isPending || !draft.trim()}
              style={({ pressed }) => [
                styles.editSaveBtn,
                { opacity: pressed || update.isPending || !draft.trim() ? 0.7 : 1 },
              ]}
            >
              {update.isPending ? (
                <ActivityIndicator size="small" color={colors.onTealPrimary} />
              ) : (
                <Txt size={13} weight="semibold" color={colors.onTealPrimary}>
                  حفظ التعديل
                </Txt>
              )}
            </Pressable>
            <Pressable
              onPress={() => setEditing(false)}
              style={({ pressed }) => [styles.editCancelBtn, pressed && { opacity: 0.7 }]}
            >
              <Txt size={13} weight="medium" color={colors.textMuted}>
                إلغاء
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : (
        <Txt size={14.5} weight="medium" color={colors.textInk} style={styles.qBody}>
          {q.body}
        </Txt>
      )}
      {!editing && q.answerBody ? (
        <View style={styles.answerBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="message-circle" size={13} color={colors.primaryTeal600} />
            <Txt size={11.5} weight="semibold" color={colors.primaryTeal600}>
              جواب الشيخ
            </Txt>
          </View>
          <Txt size={13.5} color={colors.textSlate} style={{ marginTop: 6, lineHeight: 22 }}>
            {q.answerBody}
          </Txt>
        </View>
      ) : null}
    </Card>
  );
}

export function QuestionsBoard({
  scope,
  lectureId,
  bottomPad = 0,
}: {
  scope: QuestionScope;
  lectureId?: string;
  /** Clearance below the last row so the footer clears the nav bar + MiniPlayer. */
  bottomPad?: number;
}) {
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const [tab, setTab] = useState<'public' | 'mine'>('public');
  const [categoryFilter, setCategoryFilter] = useState<QuestionCategory | 'all'>('all');
  const [pendingDelete, setPendingDelete] = useState<MyQuestion | null>(null);
  const deleteOwn = useDeleteOwnQuestion();
  const [reportTarget, setReportTarget] = useState<PublicQuestion | MyQuestion | null>(null);
  const reportContent = useReportContent();

  const activeCategory = categoryFilter === 'all' ? undefined : categoryFilter;
  const publicQ = usePublicQuestions(scope, lectureId, activeCategory);
  const myQ = useMyQuestions(scope, lectureId, !isGuest, activeCategory);

  const isLoading = tab === 'public' ? publicQ.isLoading : myQ.isLoading;
  const data: (PublicQuestion | MyQuestion)[] =
    tab === 'public' ? (publicQ.data ?? []) : (myQ.data ?? []);

  const renderItem = useCallback(
    ({ item }: { item: PublicQuestion | MyQuestion }) =>
      tab === 'public' ? (
        <PublicQuestionCard q={item as PublicQuestion} onReport={() => setReportTarget(item)} />
      ) : (
        <MyQuestionCard
          q={item as MyQuestion}
          onDelete={() => setPendingDelete(item as MyQuestion)}
          onReport={() => setReportTarget(item)}
        />
      ),
    [tab],
  );

  const header = (
    <>
      {isGuest ? <RegisterNudge /> : <Composer scope={scope} lectureId={lectureId} />}

      {/* Tabs */}
      <View style={styles.tabsRow}>
        <SegChip
          label="الأسئلة المجابة"
          active={tab === 'public'}
          onPress={() => setTab('public')}
        />
        {!isGuest ? (
          <SegChip label="أسئلتي" active={tab === 'mine'} onPress={() => setTab('mine')} />
        ) : null}
      </View>

      {/* Category filter: الكل / سؤال عام / فتوى شرعية */}
      <View style={styles.tabsRow}>
        <SegChip label="الكل" active={categoryFilter === 'all'} onPress={() => setCategoryFilter('all')} />
        <SegChip
          label="سؤال عام"
          active={categoryFilter === 'general'}
          onPress={() => setCategoryFilter('general')}
        />
        <SegChip
          label="فتوى شرعية"
          active={categoryFilter === 'fatwa'}
          onPress={() => setCategoryFilter('fatwa')}
        />
      </View>
    </>
  );

  const confirmDialog = (
    <ConfirmDialog
      visible={!!pendingDelete}
      title="حذف السؤال"
      message={
        pendingDelete?.status === 'answered'
          ? 'سيُحذف سؤالك وجوابه نهائياً، ولن يظهر في الأسئلة المجابة.'
          : 'سيُحذف سؤالك نهائياً.'
      }
      confirmLabel="حذف"
      pending={deleteOwn.isPending}
      onConfirm={() => {
        if (!pendingDelete) return;
        deleteOwn.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
      }}
      onCancel={() => setPendingDelete(null)}
    />
  );

  const reportSheet = (
    <ReportSheet
      visible={!!reportTarget}
      pending={reportContent.isPending}
      error={reportContent.error instanceof Error ? reportContent.error.message : undefined}
      onClose={() => setReportTarget(null)}
      onSubmit={(reason) => {
        if (!reportTarget) return;
        reportContent.mutate(
          { contentType: 'question', contentId: reportTarget.id, reason: reason || undefined },
          { onSuccess: () => setReportTarget(null) },
        );
      }}
    />
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
        {confirmDialog}
        {reportSheet}
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      initialNumToRender={10}
      ListHeaderComponent={header}
      ListFooterComponent={
        <>
          {confirmDialog}
          {reportSheet}
        </>
      }
      ListEmptyComponent={
        tab === 'public' ? (
          <View style={styles.emptyBox}>
            <Feather name="help-circle" size={24} color={colors.textGhost} />
            <Txt size={13.5} color={colors.textMuted} align="center">
              لا أسئلة مجابة بعد
            </Txt>
            <Txt size={12} color={colors.textGhost} align="center">
              كن أول من يسأل — تُعرض الأسئلة هنا بعد إجابة الشيخ
            </Txt>
          </View>
        ) : (
          <View style={styles.emptyBox}>
            <Feather name="edit-3" size={24} color={colors.textGhost} />
            <Txt size={13.5} color={colors.textMuted} align="center">
              لم تسأل شيئاً بعد
            </Txt>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  segChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  segChipActive: {
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,

  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  } as ViewStyle,

  composerInput: {
    minHeight: 88,
    marginTop: 12,
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

  optionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  } as ViewStyle,

  togglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    backgroundColor: colors.bgSandRaised,
  } as ViewStyle,

  togglePillActive: {
    borderColor: 'rgba(176,137,79,0.45)',
    backgroundColor: 'rgba(176,137,79,0.1)',
  } as ViewStyle,

  sentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
  } as ViewStyle,

  submitBtn: {
    marginTop: 12,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  registerBtn: {
    marginTop: 12,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  qCard: { marginBottom: 12 } as ViewStyle,

  qMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  qBody: { marginTop: 10, lineHeight: 24 } as TextStyle,

  answerBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSandRaised,
    borderWidth: 1,
    borderColor: colors.borderSand,
  } as ViewStyle,

  statusBadge: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
  } as ViewStyle,

  statusPending: {
    backgroundColor: 'rgba(176,137,79,0.12)',
  } as ViewStyle,

  statusAnswered: {
    backgroundColor: 'rgba(31,138,91,0.1)',
  } as ViewStyle,

  deleteMineBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  } as ViewStyle,

  categoryBadge: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(44,97,87,0.08)',
  } as ViewStyle,

  categoryBadgeFatwa: {
    backgroundColor: 'rgba(176,137,79,0.12)',
  } as ViewStyle,

  nameBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSandRaised,
    borderWidth: 1,
    borderColor: colors.borderSand,
  } as ViewStyle,

  editActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  } as ViewStyle,

  editSaveBtn: {
    height: 42,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  editCancelBtn: {
    height: 42,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  loadingBox: { paddingVertical: 50, alignItems: 'center' } as ViewStyle,

  emptyBox: {
    paddingVertical: 50,
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,
});
