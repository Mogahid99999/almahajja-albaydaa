/**
 * Quiz intro screen — /quiz/[id] (PRD §12.2).
 *
 * Pre-quiz summary: title, section, question count, total/pass score, time
 * limit, attempts allowed/left, personal status. Primary action starts (or
 * resumes) an attempt; guests see a calm register nudge instead — quiz-taking
 * requires a registered account (results are personal & synced).
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card, Divider, Rhombus, Screen, Txt } from '@/components/ui';
import { QuizStatusPill } from '@/components/quiz/QuizStatusPill';
import { SectionNavBar } from '@/components/section/SectionNavBar';
import { colors, radius, shadows } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useLocalQuizAttempt, useQuizIntegrity, useQuizIntro, useStartAttempt } from '@/hooks/useQuizzes';
import { arabicOr } from '@/lib/errorText';
import { arAttemptCount, arDateTime, arMinuteCount, arNum, arQuestionCount } from '@/lib/format';

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 11,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Rhombus size={6} color={colors.accentBrassMuted} />
        <Txt size={13} color={colors.textMuted}>
          {label}
        </Txt>
      </View>
      <Txt size={13} weight="semibold" color={colors.textInk} tabular>
        {value}
      </Txt>
    </View>
  );
}

export default function QuizIntroScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: quiz, isLoading, isError } = useQuizIntro(id ?? '');
  const startAttempt = useStartAttempt();
  const { data: localAttempt } = useLocalQuizAttempt(id ?? '');
  const [startError, setStartError] = useState('');
  const [integrityAccepted, setIntegrityAccepted] = useState(false);
  // A new attempt only: resuming one needs nothing new.
  const needsStart =
    !!quiz && !isGuest && !localAttempt && quiz.status !== 'in_progress' && quiz.status !== 'exhausted' && quiz.status !== 'pending_review';
  const integrityQuery = useQuizIntegrity(id ?? '', needsStart);
  const integrity = needsStart ? (integrityQuery.data ?? null) : null;
  const integrityWaiting = needsStart && integrityQuery.isLoading;

  const openAttempt = (attemptId: string) =>
    router.push(`/quiz-attempt/${attemptId}` as Parameters<typeof router.push>[0]);

  // Offline with nothing cached, yet the attempt itself is on the device (0174).
  if (!quiz && localAttempt) {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <SectionNavBar contextLabel={null} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <Txt size={15} weight="semibold" color={colors.textMuted} align="center" style={{ alignSelf: 'stretch' }}>
            {localAttempt.phase === 'locked' ? 'إجاباتك محفوظة بانتظار الإرسال' : 'لديك محاولة محفوظة على جهازك'}
          </Txt>
          <Pressable
            onPress={() => openAttempt(localAttempt.attemptId)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingVertical: 12,
              paddingHorizontal: 28,
              borderRadius: radius.sm,
              backgroundColor: colors.primaryTeal,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
              {localAttempt.phase === 'locked' ? 'عرض الحالة' : 'تابع الاختبار'}
            </Txt>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (isLoading) {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <SectionNavBar contextLabel={null} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  if (!quiz) {
    return (
      <Screen scroll={false} padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
        <SectionNavBar contextLabel={null} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {/* Distinguish a network failure from a truly missing/unpublished quiz
              (audit F-054 — the old copy blamed the quiz for a dead connection). */}
          <Txt size={15} weight="semibold" color={colors.textMuted} align="center">
            {isError ? 'تعذّر التحميل' : 'الاختبار غير متاح'}
          </Txt>
          <Txt size={12} color={colors.textGhost} align="center">
            {isError ? 'تحقق من الاتصال ثم حاول مرة أخرى' : 'لا يمكن تحميل بيانات هذا الاختبار'}
          </Txt>
        </View>
      </Screen>
    );
  }

  const exhausted = quiz.status === 'exhausted' && !localAttempt;
  const inProgress = quiz.status === 'in_progress' || !!localAttempt;
  // 0166: a submitted attempt awaits a grader — no new attempt until it is
  // graded (the server refuses too); «عرض آخر نتيجة» shows its pending state.
  const pendingReview = quiz.status === 'pending_review' && !localAttempt;
  const startBlocked = exhausted || pendingReview;
  const canViewLastResult = quiz.lastResultAttemptId != null;

  // Availability gates only the START of a new attempt. A student already
  // mid-attempt keeps «تابع الاختبار» regardless — matching the server, which
  // resumes an in-progress attempt before checking availability (0118).
  const unavailable = !inProgress && quiz.availability !== 'open';
  const unavailableNotice =
    quiz.availability === 'closed'
      ? { icon: 'lock' as const, text: 'هذا الاختبار غير متاح حاليًا.' }
      : quiz.availability === 'scheduled'
        ? {
            icon: 'clock' as const,
            text: quiz.availableFrom
              ? `يبدأ هذا الاختبار في: ${arDateTime(quiz.availableFrom)}`
              : 'لم يبدأ هذا الاختبار بعد.',
          }
        : quiz.availability === 'expired'
          ? {
              icon: 'slash' as const,
              text: quiz.availableUntil
                ? `انتهت مدة هذا الاختبار في: ${arDateTime(quiz.availableUntil)}`
                : 'انتهت مدة هذا الاختبار.',
            }
          : null;

  const primaryLabel = startAttempt.isPending
    ? 'جارٍ التحضير...'
    : integrity
      ? 'بدء الاختبار'
    : inProgress
      ? localAttempt?.phase === 'locked'
        ? 'بانتظار الإرسال'
        : 'تابع الاختبار'
      : pendingReview
        ? 'بانتظار التصحيح'
        : exhausted
          ? 'استنفدت المحاولات'
          : quiz.attemptsUsed > 0
            ? 'إعادة المحاولة'
            : 'ابدأ الاختبار';

  const startDisabled = startBlocked || integrityWaiting || (!!integrity && !integrityAccepted);

  function handleStart() {
    setStartError('');
    if (localAttempt) {
      openAttempt(localAttempt.attemptId);
      return;
    }
    startAttempt.mutate({ quizId: quiz!.id, integrityVersion: integrity?.version }, {
      onSuccess: (attemptId) =>
        router.push(`/quiz-attempt/${attemptId}` as Parameters<typeof router.push>[0]),
      // Server refusals are calm Arabic and surface verbatim; network noise /
      // constraint English (e.g. a two-device unique_violation race) falls back
      // to the generic Arabic line (audit F-054).
      onError: (err) => setStartError(arabicOr(err, 'تعذّر بدء الاختبار. حاول مرة أخرى.')),
    });
  }

  return (
    <Screen scroll padded bottomPad={40 + BOTTOM_NAV_CLEARANCE}>
      <SectionNavBar contextLabel={quiz.sectionTitle} />

      {/* Header */}
      <View style={{ alignItems: 'center', marginTop: 18, gap: 10 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.card,
            backgroundColor: colors.primaryTeal,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="check-square" size={24} color={colors.accentBrass} />
        </View>
        {/* alignSelf:'stretch': content-sized RTL Text with align center clips
            its trailing word on Android (see player titleBlock). */}
        <Txt
          weight="display"
          size={22}
          color={colors.primaryTeal}
          align="center"
          style={{ alignSelf: 'stretch' }}
        >
          {quiz.title}
        </Txt>
        {quiz.description ? (
          <Txt
            size={13}
            color={colors.textMuted}
            align="center"
            style={{ lineHeight: 22, alignSelf: 'stretch' }}
          >
            {quiz.description}
          </Txt>
        ) : null}
        <QuizStatusPill status={quiz.status} />
      </View>

      {/* Stats card */}
      <Card style={{ marginTop: 22, paddingVertical: 6 }}>
        <StatRow label="عدد الأسئلة" value={arQuestionCount(quiz.questionCount)} />
        <Divider />
        <StatRow label="الدرجة الكلية" value={arNum(quiz.totalScore)} />
        <Divider />
        <StatRow label="درجة النجاح" value={arNum(quiz.passScore)} />
        <Divider />
        <StatRow
          label="زمن الاختبار"
          value={
            quiz.timeLimitSec ? arMinuteCount(Math.round(quiz.timeLimitSec / 60)) : 'بدون تحديد'
          }
        />
        <Divider />
        <StatRow
          label="المحاولات المسموحة"
          value={quiz.maxAttempts != null ? arAttemptCount(quiz.maxAttempts) : 'غير محدودة'}
        />
        {quiz.maxAttempts != null ? (
          <>
            <Divider />
            <StatRow label="المحاولات المتبقية" value={arNum(quiz.attemptsLeft ?? 0)} />
          </>
        ) : null}
        {quiz.bestScore != null ? (
          <>
            <Divider />
            <StatRow
              label="أفضل نتيجة"
              value={`${arNum(quiz.bestScore)} من ${arNum(quiz.totalScore)}`}
            />
          </>
        ) : null}
      </Card>

      {/* Actions */}
      <View style={{ marginTop: 24, gap: 12 }}>
        {startError ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(184,92,74,0.09)',
              borderRadius: radius.sm,
              padding: 12,
              gap: 8,
            }}
          >
            <Feather name="alert-circle" size={15} color={colors.stateDanger} />
            <Txt size={12.5} color={colors.stateDanger} style={{ flex: 1 }}>
              {startError}
            </Txt>
          </View>
        ) : null}

        {unavailable && unavailableNotice ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.surfaceInset,
              borderRadius: radius.sm,
              padding: 14,
              gap: 10,
            }}
          >
            <Feather name={unavailableNotice.icon} size={17} color={colors.textMuted} />
            <Txt size={13} color={colors.textSlate} style={{ flex: 1, lineHeight: 21 }}>
              {unavailableNotice.text}
            </Txt>
          </View>
        ) : isGuest ? (
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: 'rgba(176,137,79,0.1)',
                borderRadius: radius.sm,
                padding: 12,
                gap: 8,
              }}
            >
              <Feather name="user-plus" size={15} color={colors.accentBrassMuted} />
              <Txt size={12.5} color={colors.textMuted} style={{ flex: 1, lineHeight: 20 }}>
                أداء الاختبار يتطلب حسابًا — حتى تُحفظ نتائجك وتبقى معك.
              </Txt>
            </View>
            <Pressable
              onPress={() => router.push('/(auth)/register')}
              style={({ pressed }) => [
                {
                  backgroundColor: colors.primaryTeal,
                  height: 50,
                  borderRadius: radius.sm,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.85 : 1,
                  ...shadows.button,
                },
              ]}
              accessibilityRole="button"
            >
              <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
                إنشاء حساب
              </Txt>
            </Pressable>
          </>
        ) : (
          <>
          {integrity ? (
            <Card style={{ padding: 14, marginBottom: 12 }}>
              <Txt size={15} weight="semibold" color={colors.textInk}>
                إقرار النزاهة
              </Txt>
              <Txt size={13} color={colors.textMuted} style={{ lineHeight: 24, marginTop: 6 }}>
                {integrity.body}
              </Txt>
              <Pressable
                onPress={() => setIntegrityAccepted((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: integrityAccepted }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    borderWidth: 2,
                    borderColor: integrityAccepted ? colors.primaryTeal : colors.borderSand2,
                    backgroundColor: integrityAccepted ? colors.primaryTeal : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {integrityAccepted ? <Feather name="check" size={14} color={colors.onTealPrimary} /> : null}
                </View>
                <Txt size={13} weight="semibold" color={colors.textInk} style={{ flex: 1, lineHeight: 22 }}>
                  أوافق على الإقرار وأتعهد بالالتزام به.
                </Txt>
              </Pressable>
            </Card>
          ) : null}
          <Pressable
            onPress={handleStart}
            disabled={startDisabled || startAttempt.isPending}
            accessibilityState={{ disabled: startDisabled || startAttempt.isPending }}
            style={({ pressed }) => [
              {
                backgroundColor: startDisabled ? colors.surfaceInset : colors.primaryTeal,
                height: 50,
                borderRadius: radius.sm,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed || startAttempt.isPending ? 0.85 : 1,
                ...(startDisabled ? null : shadows.button),
              },
            ]}
            accessibilityRole="button"
          >
            <Txt
              weight="semibold"
              size={15}
              color={startDisabled ? colors.textMuted : colors.onTealPrimary}
              align="center"
              style={{ alignSelf: 'stretch' }}
            >
              {primaryLabel}
            </Txt>
          </Pressable>
          </>
        )}

        {canViewLastResult ? (
          <Pressable
            onPress={() =>
              router.push(
                `/quiz-result/${quiz.lastResultAttemptId}` as Parameters<typeof router.push>[0],
              )
            }
            style={({ pressed }) => [
              {
                height: 44,
                borderRadius: radius.sm,
                borderWidth: 1.5,
                borderColor: colors.primaryTeal,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            accessibilityRole="button"
          >
            <Txt weight="semibold" size={14} color={colors.primaryTeal}>
              عرض آخر نتيجة
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}
