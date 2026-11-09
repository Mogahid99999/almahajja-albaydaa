/**
 * «شهادة إتمام» progress on the section page (certificates phase 2).
 *
 * Every figure is certificate_eligibility(section, me) (0168), so what the
 * student reads is exactly what decides the certificate: the lectures of the
 * certificate's content_scope («هذا القسم» / «هذا القسم وأقسامه الفرعية»), the
 * required count, each required quiz with its state, and what is left. Renders
 * nothing when the section grants no certificate (or none this student can
 * earn). Guests get a calm invitation instead (certificates belong to an
 * account, like رحلتي العلمية).
 *
 * Issued (0170): «تم إصدار شهادتك» with view / PDF; the certificate itself is
 * rendered on the server.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import type { CertificateEligibility, IssuedCertificate } from '@/api/certificates';
import { colors, radius } from '@/constants/theme';
import { useCertificateEligibility, useMyCertificates } from '@/hooks/useCertificates';
import { arNum, arPercent } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Txt } from '@/components/ui/Txt';

import { CertificateActions } from './CertificateActions';
import { CERTIFICATE_LABEL } from './CertificateTag';
import {
  certificateHasConditions,
  issuedStatusLine,
  lectureProgress,
  lectureRequirementLine,
  QUIZ_STATE_LABEL,
  quizState,
  remainingSummary,
  type QuizState,
} from './certificateText';

const STATE_ICON: Record<QuizState, { name: 'check-circle' | 'clock' | 'circle'; color: string }> = {
  passed: { name: 'check-circle', color: colors.stateSuccess },
  pending: { name: 'clock', color: colors.accentBrassMuted },
  todo: { name: 'circle', color: colors.textGhost },
};

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(201, 164, 99, 0.16)',
        }}
      >
        <Feather name="award" size={16} color={colors.accentBrassMuted} />
      </View>
      <Txt size={14} weight="semibold" color={colors.textInk} style={{ flex: 1 }}>
        {CERTIFICATE_LABEL}
      </Txt>
      {right}
    </View>
  );
}

export function CertificateProgressView({ e, issued = null }: { e: CertificateEligibility; issued?: IssuedCertificate | null }) {
  const router = useRouter();
  const progress = lectureProgress(e);

  return (
    <Card style={{ marginTop: 12, padding: 14 }}>
      <Header
        right={
          e.eligible ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: colors.accentBrass,
                borderRadius: radius.pill,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Feather name="check" size={12} color={colors.surfaceCard} />
              <Txt size={11.5} weight="semibold" color={colors.surfaceCard}>
                مستحقة
              </Txt>
            </View>
          ) : undefined
        }
      />

      {/* Lectures of the certificate's content scope (no block when they are no condition) */}
      {e.lectures.rule !== 'none' ? (
      <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Txt size={12} weight="medium" color={colors.textMuted}>
          المحاضرات المكتملة
        </Txt>
        <Txt size={12.5} weight="semibold" color={colors.textInk} tabular>
          {/* The share belongs to the lectures only — never reads as «the certificate is at 100 %». */}
          {`${arNum(Math.min(e.lectures.completed, e.lectures.required))} من ${arNum(e.lectures.required)} · ${arPercent(progress * 100)}`}
        </Txt>
      </View>
      <ProgressBar value={progress} height={7} tint="brass" />
      <Txt size={11} color={colors.textGhost} style={{ marginTop: 8, lineHeight: 18 }}>
        {lectureRequirementLine(e)}
      </Txt>
      </>
      ) : null}

      {/* Required quizzes */}
      {e.quizzes.rule === 'selected' && e.quizzes.items.length > 0 ? (
        <View style={{ marginTop: e.lectures.rule === 'none' ? 0 : 12 }}>
          <Txt size={12} weight="medium" color={colors.textMuted} style={{ marginBottom: 4 }}>
            {`الاختبارات المطلوبة — ${arNum(e.quizzes.passedCount)} من ${arNum(e.quizzes.requiredCount)}`}
          </Txt>
          {e.quizzes.items.map((q, i) => {
            const state = quizState(q);
            const icon = STATE_ICON[state];
            return (
              <View key={q.quizId}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/quiz/[id]', params: { id: q.quizId } } as never)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${q.title} — ${QUIZ_STATE_LABEL[state]}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingVertical: 9,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Feather name={icon.name} size={15} color={icon.color} />
                  <Txt size={13} color={colors.textInk} style={{ flex: 1 }} numberOfLines={2}>
                    {q.title}
                  </Txt>
                  <Txt
                    size={11.5}
                    weight="semibold"
                    color={state === 'passed' ? colors.stateSuccess : state === 'pending' ? colors.accentBrassMuted : colors.textGhost}
                  >
                    {QUIZ_STATE_LABEL[state]}
                  </Txt>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* What is left / earned */}
      <View
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTopWidth: 1,
          borderTopColor: colors.borderHair,
          gap: 2,
        }}
      >
        <Txt
          size={12.5}
          weight="semibold"
          color={e.eligible ? colors.accentBrassMuted : colors.primaryTeal600}
        >
          {remainingSummary(e)}
        </Txt>
        {e.eligible || issued ? (
          <Txt size={11.5} color={colors.textMuted}>
            {issuedStatusLine(issued)}
          </Txt>
        ) : null}
      </View>
      {issued?.status === 'valid' ? <CertificateActions certificate={issued} /> : null}
    </Card>
  );
}

export function CertificateProgressCard({ sectionId, isGuest }: { sectionId: string; isGuest: boolean }) {
  const router = useRouter();
  const { data } = useCertificateEligibility(sectionId, { enabled: !isGuest });
  const { data: mine } = useMyCertificates({ enabled: !isGuest });
  const issued = mine?.find((c) => c.sectionId === sectionId)?.issued ?? null;

  if (isGuest) {
    return (
      <Card style={{ marginTop: 12, padding: 14 }}>
        <Header />
        <Txt size={12.5} color={colors.textMuted} style={{ lineHeight: 20 }}>
          يمنح هذا القسم شهادة إتمام. أنشئ حسابًا لتتابع تقدّمك نحوها وتُحفظ لك.
        </Txt>
        <Pressable
          onPress={() => router.push('/(auth)/register')}
          accessibilityRole="button"
          style={({ pressed }) => ({ marginTop: 8, alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}
        >
          <Txt size={12.5} weight="semibold" color={colors.accentBrassMuted}>
            إنشاء حساب
          </Txt>
        </Pressable>
      </Card>
    );
  }

  if (!data || !data.enabled || !certificateHasConditions(data)) return null;
  return <CertificateProgressView e={data} issued={issued} />;
}
