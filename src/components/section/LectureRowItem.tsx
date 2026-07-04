/**
 * LectureRowItem — one row in the lectures card inside a section page.
 *
 * RTL layout (right → left):
 *   [34px status circle] [title + meta (flex:1)] [DownloadButton] [tools menu]
 *
 * Status variants:
 *   new         → surfaceInset bg + ghost Rhombus dot; label "لم تبدأ" (ghost)
 *   in_progress → teal bg + brass play triangle; label "قيد الاستماع · {time}" (brassMuted)
 *   completed   → teal-tint bg + green check; label "مكتملة" (success); title dimmed
 *
 * Tapping the row (not the buttons) → opens the full player page for the lesson
 * (the player route auto-starts playback on mount). The tools menu (V6) opens
 * ملاحظاتي / فوائد الدارسين / أسئلة الدرس for the lesson without playing it.
 *
 * Design ref: screens/صفحة القسم.dc.html › lectures block + Component class.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { arDuration } from '@/lib/format';
import { colors } from '@/constants/theme';
import { DownloadButton } from '@/components/DownloadButton';
import { LessonToolsSheet } from '@/components/player/LessonToolsSheet';
import { Rhombus } from '@/components/ui/Rhombus';
import { Txt } from '@/components/ui/Txt';
import type { LectureRow } from '@/api/types';

type Props = {
  lecture: LectureRow;
};

export function LectureRowItem({ lecture }: Props) {
  const { id, title, durationSec, status, positionSec } = lecture;
  const [toolsOpen, setToolsOpen] = useState(false);
  const router = useRouter();

  // ── Status circle styles & content ──────────────────────────────────────────
  let circleBg: string;
  let circleBorder: string;
  let statusLabel: string;
  let statusLabelColor: string;
  let titleColor: string;

  if (status === 'completed') {
    circleBg = 'rgba(31,74,66,0.10)';
    circleBorder = 'rgba(31,74,66,0.20)';
    statusLabel = 'مكتملة';
    statusLabelColor = colors.stateSuccess;
    titleColor = colors.textMuted;
  } else if (status === 'in_progress') {
    circleBg = colors.primaryTeal;
    circleBorder = 'rgba(176,137,79,0.4)';
    statusLabel = `قيد الاستماع · ${arDuration(positionSec)}`;
    statusLabelColor = colors.accentBrassMuted;
    titleColor = colors.textInk;
  } else {
    // new
    circleBg = colors.surfaceInset;
    circleBorder = colors.borderSand2;
    statusLabel = 'لم تبدأ';
    statusLabelColor = colors.textGhost;
    titleColor = colors.textInk;
  }

  // ── Status circle inner icon ─────────────────────────────────────────────────
  function StatusCircleContent() {
    if (status === 'completed') {
      return (
        <Feather
          name="check"
          size={16}
          color={colors.stateSuccess}
          strokeWidth={2.4}
        />
      );
    }
    if (status === 'in_progress') {
      // Brass play triangle: CSS border trick → in RN, use a small rotated View
      // We render a Feather "play" icon tinted brass, which matches the spec visually.
      return <Feather name="play" size={13} color={colors.accentBrass} />;
    }
    // new — ghost Rhombus dot
    return <Rhombus size={7} color={colors.accentBrassSoft} filled />;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => router.push(`/player/${id}`)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingVertical: 14,
        paddingHorizontal: 16,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {/* Status indicator circle */}
      <View
        style={{
          flexShrink: 0,
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: circleBg,
          borderWidth: 1,
          borderColor: circleBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <StatusCircleContent />
      </View>

      {/* Title + meta row */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt
          size={14}
          weight="semibold"
          color={titleColor}
          style={{ lineHeight: 19 }}
          numberOfLines={1}
        >
          {title}
        </Txt>

        {/* meta: duration · status label */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
          }}
        >
          <Txt size={11} color={colors.textGhost} tabular>
            {arDuration(durationSec)}
          </Txt>
          {/* separator dot */}
          <View
            style={{
              width: 3,
              height: 3,
              borderRadius: 1.5,
              backgroundColor: colors.accentBrassSoft,
            }}
          />
          <Txt size={11} weight="medium" color={statusLabelColor}>
            {statusLabel}
          </Txt>
        </View>
      </View>

      {/* Download button (RTL left side) */}
      <View onStartShouldSetResponder={() => true}>
        <DownloadButton lectureId={id} size={18} />
      </View>

      {/* Lesson tools (V6) — ملاحظاتي / فوائد الدارسين / أسئلة الدرس */}
      <View onStartShouldSetResponder={() => true}>
        <Pressable
          onPress={() => setToolsOpen(true)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="أدوات الدرس"
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="more-vertical" size={17} color={colors.textGhost} />
        </Pressable>
      </View>
      <LessonToolsSheet
        lectureId={id}
        visible={toolsOpen}
        onClose={() => setToolsOpen(false)}
      />
    </Pressable>
  );
}
