import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { ResumeCard as ResumeCardData } from '@/api/progress';
import { colors, radius } from '@/constants/theme';
import { arDuration, arNum } from '@/lib/format';
import { preloadLecture } from '@/lib/audioController';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Txt } from '@/components/ui/Txt';

/**
 * «واصل رحلتك» — the journey resume card (V20 · §3). Shows the student's latest
 * scholarly position with full context: the section breadcrumb (العقيدة ← التوحيد
 * ← كتاب التوحيد), the lesson, the series' completed count + %, and a direct
 * continue button. Two variants (server-derived, `data.variant`):
 *   - 'resume' → the current lesson is unfinished; «أكمل الاستماع» seeks to the
 *     pause position.
 *   - 'next'   → the current lesson is done; «ابدأ الدرس التالي» opens the next
 *     lesson in the series.
 * Renders nothing when there's no next lesson to point at after a completion (the
 * series is finished — nothing to resume). Calm sand card, full RTL.
 */
export function ResumeCard({ data }: { data: ResumeCardData }) {
  const router = useRouter();

  // Completed the last lesson AND no next lesson → series done, nothing to show.
  if (data.variant === 'next' && !data.nextLectureId) return null;

  const isResume = data.variant === 'resume';
  const targetId = isResume ? data.lectureId : (data.nextLectureId as string);
  const targetTitle = isResume ? data.lectureTitle : (data.nextLectureTitle ?? 'الدرس التالي');
  const startAt = isResume ? Math.floor(data.positionSec) : 0;

  const pct =
    data.seriesTotal > 0
      ? Math.round((data.seriesCompleted / data.seriesTotal) * 100)
      : 0;

  const breadcrumb = data.breadcrumb.join(' ← ');

  function go() {
    void preloadLecture(targetId, { startAtSec: startAt });
    router.push(`/player/${targetId}${startAt > 0 ? `?t=${startAt}` : ''}`);
  }

  return (
    <Card style={{ padding: 18, gap: 12 }}>
      {/* Breadcrumb — القسم ← الداخلي ← السلسلة */}
      {breadcrumb ? (
        <Txt size={11.5} weight="medium" color={colors.accentBrassMuted} numberOfLines={1}>
          {breadcrumb}
        </Txt>
      ) : null}

      {/* Lesson title (current for resume, next for the 'next' variant) */}
      <View style={{ gap: 4 }}>
        {!isResume ? (
          <Txt size={12} color={colors.textMuted}>
            الدرس التالي
          </Txt>
        ) : null}
        <Txt weight="display" size={18} color={colors.primaryTeal} style={{ lineHeight: 26 }} numberOfLines={2}>
          {isResume && data.lessonOrder > 0
            ? `الدرس ${arNum(data.lessonOrder)}: ${targetTitle}`
            : targetTitle}
        </Txt>
      </View>

      {/* Series progress */}
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt size={12.5} color={colors.textMuted} tabular>
            {`أنجزت ${arNum(data.seriesCompleted)} من ${arNum(data.seriesTotal)} درساً`}
          </Txt>
          <Txt size={12.5} weight="semibold" color={colors.primaryTeal600} tabular>
            {`${arNum(pct)}%`}
          </Txt>
        </View>
        <ProgressBar value={data.seriesTotal > 0 ? data.seriesCompleted / data.seriesTotal : 0} height={6} tint="teal" />
      </View>

      {/* Pause time — only for the resume variant */}
      {isResume && data.positionSec > 0 ? (
        <Txt size={12.5} color={colors.textMuted} tabular>
          {`توقفت عند ${arDuration(data.positionSec)}`}
        </Txt>
      ) : null}

      {/* Continue button */}
      <Pressable
        onPress={go}
        accessibilityRole="button"
        accessibilityLabel={isResume ? 'أكمل الاستماع' : 'ابدأ الدرس التالي'}
        style={({ pressed }) => ({
          marginTop: 2,
          paddingVertical: 13,
          borderRadius: radius.input,
          alignItems: 'center',
          backgroundColor: colors.primaryTeal,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Txt size={14.5} weight="semibold" color={colors.onTealPrimary}>
          {isResume ? 'أكمل الاستماع' : 'ابدأ الدرس التالي'}
        </Txt>
      </Pressable>
    </Card>
  );
}
