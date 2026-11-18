/**
 * «شهاداتي» — the student's completion certificates (certificates phase 2).
 *
 * Route: /(student)/certificates — opened from the profile and from
 * «رحلتي العلمية».
 *
 * Two groups, both straight from get_my_certificates (0169), i.e. one
 * certificate_eligibility per certificate section the student can reach:
 *   «شهاداتي»     — issued or earned: a brass seal, the status, view / PDF. The
 *                    certificate itself is rendered on the server (0170).
 *   «قيد الإنجاز» — the rest, with a compact progress line (the same figures the
 *                    section page shows) and what is left.
 * Tapping a row opens that section. Guests get the account invitation.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import type { MyCertificate } from '@/api/certificates';
import { colors } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useMyCertificates } from '@/hooks/useCertificates';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { arNum, arPercent } from '@/lib/format';
import { CertificateActions } from '@/components/certificates/CertificateActions';
import { issuedStatusLine, lectureProgress, quizProgress, remainingSummary } from '@/components/certificates/certificateText';
import { JourneyGate } from '@/components/journey/JourneyGate';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Rhombus } from '@/components/ui/Rhombus';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';

function openSection(router: ReturnType<typeof useRouter>, id: string) {
  router.push({ pathname: '/section/[id]', params: { id } });
}

function EarnedCard({ c }: { c: MyCertificate }) {
  const router = useRouter();
  const issued = c.issued?.status === 'valid' ? c.issued : null;
  return (
    <Pressable
      onPress={() =>
        issued
          ? router.push(`/certificate/${issued.id}` as Parameters<typeof router.push>[0])
          : c.sectionId && openSection(router, c.sectionId)
      }
      accessibilityRole="button"
      accessibilityLabel={`${c.title} — ${issuedStatusLine(c.issued)}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {/* Brass seal — the app's completion emblem */}
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accentBrass,
          }}
        >
          <Rhombus size={22} color={colors.surfaceCard} filled={false} />
          <Feather name="award" size={12} color={colors.surfaceCard} style={{ position: 'absolute' }} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          {c.parentTitle ? (
            <Txt size={11.5} weight="medium" color={colors.accentBrassMuted} numberOfLines={1}>
              {c.parentTitle}
            </Txt>
          ) : null}
          <Txt size={15} weight="semibold" color={colors.textInk} numberOfLines={2}>
            {c.title}
          </Txt>
          <Txt size={11.5} color={colors.textMuted}>
            {issuedStatusLine(c.issued)}
          </Txt>
        </View>
        <Feather name="chevron-left" size={18} color={colors.textGhost} />
      </View>
      {issued ? <CertificateActions certificate={issued} /> : null}
      </Card>
    </Pressable>
  );
}

function InProgressRow({ c }: { c: MyCertificate }) {
  const router = useRouter();
  const quizOnly = c.eligibility.lectures.rule === 'none';
  const progress = quizOnly ? quizProgress(c.eligibility) : lectureProgress(c.eligibility);
  return (
    <Pressable
      onPress={() => openSection(router, c.sectionId)}
      accessibilityRole="button"
      accessibilityLabel={`${c.title} — ${remainingSummary(c.eligibility)}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            {c.parentTitle ? (
              <Txt size={11.5} weight="medium" color={colors.accentBrassMuted} numberOfLines={1}>
                {c.parentTitle}
              </Txt>
            ) : null}
            <Txt size={14} weight="semibold" color={colors.textInk} numberOfLines={2}>
              {c.title}
            </Txt>
          </View>
          <Txt size={13} weight="bold" color={colors.accentBrassMuted} tabular>
            {quizOnly
              ? `الاختبارات ${arNum(c.eligibility.quizzes.passedCount)} من ${arNum(c.eligibility.quizzes.requiredCount)}`
              : `المحاضرات ${arPercent(progress * 100)}`}
          </Txt>
        </View>
        <ProgressBar value={progress} height={5} tint="brass" />
        <Txt size={12} color={colors.primaryTeal600}>
          {remainingSummary(c.eligibility)}
        </Txt>
      </Card>
    </Pressable>
  );
}

function Quiet({ text }: { text: string }) {
  return (
    <Txt size={12.5} color={colors.textMuted} align="center" style={{ paddingVertical: 14, lineHeight: 21 }}>
      {text}
    </Txt>
  );
}

export default function CertificatesScreen() {
  const router = useRouter();
  const miniPad = useMiniPlayerPad();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data, isLoading, isError, refetch } = useMyCertificates({
    enabled: !isGuest,
    refetchOnMount: 'always',
  });
  const { refreshing, onRefresh } = usePullToRefresh([refetch]);

  const earned = (data ?? []).filter((c) => c.eligibility.eligible || c.issued);
  const inProgress = (data ?? []).filter((c) => !c.eligibility.eligible && !c.issued);

  return (
    <Screen
      bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}
      padded
      refreshing={refreshing}
      onRefresh={isGuest ? undefined : onRefresh}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22 }}>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
          شهاداتي
        </Txt>
      </View>

      {isGuest ? (
        <JourneyGate
          title="سجّل لتحصل على شهاداتك"
          body="بعض الأقسام تمنح شهادة إتمام لمن أكمل دروسها واجتاز اختباراتها. أنشئ حسابًا ليُحفظ تقدّمك نحوها."
        />
      ) : isLoading && !data ? (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      ) : isError && !data ? (
        <Quiet text="تعذّر تحميل الشهادات الآن. اسحب للأسفل لإعادة المحاولة." />
      ) : (data ?? []).length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
          <Feather name="award" size={26} color={colors.accentBrassSoft} />
          <Txt size={14} weight="semibold" color={colors.textInk} align="center">
            لا توجد أقسام تمنح شهادة حاليًا
          </Txt>
          <Txt size={12.5} color={colors.textMuted} align="center" style={{ lineHeight: 21 }}>
            ستظهر هنا الأقسام التي تمنح شهادة إتمام وتقدّمك نحوها.
          </Txt>
        </Card>
      ) : (
        <>
          <SectionTitle title="شهاداتي" />
          {earned.length > 0 ? (
            <View style={{ gap: 12, marginBottom: 24 }}>
              {earned.map((c) => (
                <EarnedCard key={c.issued?.id ?? c.sectionId} c={c} />
              ))}
            </View>
          ) : (
            <View style={{ marginBottom: 16 }}>
              <Quiet text="لم تستحق شهادة بعد. أكمل متطلبات أحد الأقسام أدناه وستظهر هنا." />
            </View>
          )}

          <SectionTitle title="قيد الإنجاز" />
          {inProgress.length > 0 ? (
            <View style={{ gap: 12 }}>
              {inProgress.map((c) => (
                <InProgressRow key={c.sectionId} c={c} />
              ))}
            </View>
          ) : (
            <Quiet text="أتممت شروط كل الشهادات المتاحة لك، بارك الله في سعيك." />
          )}
        </>
      )}
    </Screen>
  );
}
