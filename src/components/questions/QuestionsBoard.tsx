/**
 * Shared Q&A board (V6 Feature A) — used by ساحة الأسئلة (scope 'general') and
 * أسئلة الدرس (scope 'lecture'). Two tabs:
 *   «الأسئلة المجابة» — public answered questions (Q + A, name or «سائل»)
 *   «أسئلتي»          — the caller's own, any status («قيد المراجعة»)
 * plus a compose card (body + إخفاء الاسم + للعامة/للشيخ فقط), registered-only —
 * guests get the calm quiz-style register nudge.
 */
import { Feather } from '@expo/vector-icons';
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

import type { MyQuestion, PublicQuestion, QuestionAudience, QuestionScope } from '@/api/questions';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import {
  useAskQuestion,
  useDeleteOwnQuestion,
  useMyQuestions,
  usePublicQuestions,
} from '@/hooks/useQuestions';
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
    <Card style={{ marginBottom: 18 }}>
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
      { scope, lectureId, isAnonymous: anonymous, audience, body: text },
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
    <Card style={{ marginBottom: 18 }}>
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
      <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 8, lineHeight: 18 }}>
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

function PublicQuestionCard({ q }: { q: PublicQuestion }) {
  return (
    <Card style={styles.qCard}>
      <View style={styles.qMetaRow}>
        <Feather name={q.askerDisplay ? 'user' : 'user-x'} size={13} color={colors.textGhost} />
        <Txt size={12.5} weight="medium" color={colors.textSlate} numberOfLines={1} style={{ flex: 1 }}>
          {q.askerDisplay ?? 'سائل'}
        </Txt>
        <Txt size={11.5} color={colors.textGhost}>
          {arSince(q.createdAt)}
        </Txt>
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

function MyQuestionCard({ q, onDelete }: { q: MyQuestion; onDelete: () => void }) {
  const pending = q.status === 'pending';
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
          onPress={onDelete}
          accessibilityLabel="حذف سؤالي"
          hitSlop={6}
          style={({ pressed }) => [styles.deleteMineBtn, pressed && { opacity: 0.7 }]}
        >
          <Feather name="trash-2" size={14} color={colors.stateDanger} />
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

export function QuestionsBoard({
  scope,
  lectureId,
}: {
  scope: QuestionScope;
  lectureId?: string;
}) {
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const [tab, setTab] = useState<'public' | 'mine'>('public');
  const [pendingDelete, setPendingDelete] = useState<MyQuestion | null>(null);
  const deleteOwn = useDeleteOwnQuestion();

  const publicQ = usePublicQuestions(scope, lectureId);
  const myQ = useMyQuestions(scope, lectureId, !isGuest);

  const isLoading = tab === 'public' ? publicQ.isLoading : myQ.isLoading;
  const data: (PublicQuestion | MyQuestion)[] =
    tab === 'public' ? (publicQ.data ?? []) : (myQ.data ?? []);

  const renderItem = useCallback(
    ({ item }: { item: PublicQuestion | MyQuestion }) =>
      tab === 'public' ? (
        <PublicQuestionCard q={item as PublicQuestion} />
      ) : (
        <MyQuestionCard q={item as MyQuestion} onDelete={() => setPendingDelete(item as MyQuestion)} />
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

  if (isLoading) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
        {confirmDialog}
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1 }}
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      initialNumToRender={10}
      ListHeaderComponent={header}
      ListFooterComponent={confirmDialog}
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
    marginBottom: 14,
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
    marginTop: 14,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  registerBtn: {
    marginTop: 14,
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

  loadingBox: { paddingVertical: 50, alignItems: 'center' } as ViewStyle,

  emptyBox: {
    paddingVertical: 50,
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,
});
