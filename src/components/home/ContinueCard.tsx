import { Pressable, View } from 'react-native';

import type { ResumeLecture } from '@/api/types';
import { colors, radius, shadows } from '@/constants/theme';
import { arDuration } from '@/lib/format';
import { playLecture } from '@/lib/audioController';
import { usePlayerStore } from '@/stores/playerStore';
import { ConcentricMotif, ProgressBar, RhombusEmblem, Txt } from '@/components/ui';

type Props = {
  continueListening: ResumeLecture | null;
};

/**
 * "أكمِل الاستماع" — teal feature card on the Home screen.
 * Renders nothing when there is no resume position (no in-progress lecture).
 */
export function ContinueCard({ continueListening }: Props) {
  const { currentLectureId, isPlaying } = usePlayerStore();

  if (!continueListening) return null;

  const { id, title, sheikhName, eyebrow, positionSec, durationSec } = continueListening;
  const isActive = currentLectureId === id && isPlaying;
  const progress = durationSec > 0 ? positionSec / durationSec : 0;

  function handlePress() {
    void playLecture(id);
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`أكمِل الاستماع: ${title}`}
      style={({ pressed }) => ({
        backgroundColor: colors.primaryTeal,
        borderRadius: radius.feature,
        padding: 20,
        paddingBottom: 18,
        overflow: 'hidden',
        opacity: pressed ? 0.92 : 1,
        ...shadows.feature,
      })}
    >
      {/* Faint concentric-circle motif — absolute behind content */}
      <ConcentricMotif
        size={180}
        color="rgba(176,137,79,0.18)"
        rings={3}
        style={{ left: -60, top: -60 }}
      />

      {/* Content row: emblem + text */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15, position: 'relative' }}>
        <RhombusEmblem size={62} radius={16} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt
            size={11}
            weight="medium"
            color={colors.accentBrass}
            style={{ marginBottom: 4 }}
            numberOfLines={1}
          >
            {eyebrow}
          </Txt>
          <Txt
            weight="display"
            size={19}
            color={colors.onTealPrimary}
            style={{ lineHeight: 26 }}
            numberOfLines={2}
          >
            {title}
          </Txt>
          {sheikhName ? (
            <Txt size={12} color={colors.onTealSecondary} style={{ marginTop: 4 }}>
              {sheikhName}
            </Txt>
          ) : null}
        </View>
      </View>

      {/* Progress row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginTop: 16,
        }}
      >
        <Txt size={10} color={colors.onTealSecondary} tabular>
          {arDuration(positionSec)}
        </Txt>

        <ProgressBar
          value={progress}
          height={4}
          tint="onTeal"
          trackColor="rgba(223,231,227,0.22)"
          style={{ flex: 1 }}
        />

        <Txt size={10} color={colors.onTealSecondary} tabular>
          {arDuration(durationSec)}
        </Txt>

        {/* 42px brass play/pause button */}
        <Pressable
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={isActive ? 'إيقاف مؤقت' : 'تشغيل'}
          style={({ pressed }) => ({
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: colors.accentBrass,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 4,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          {isActive ? (
            /* Pause glyph — two bars */
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <View
                style={{ width: 4, height: 14, backgroundColor: colors.primaryTealDeep, borderRadius: 1 }}
              />
              <View
                style={{ width: 4, height: 14, backgroundColor: colors.primaryTealDeep, borderRadius: 1 }}
              />
            </View>
          ) : (
            /* Play glyph — RTL-pointing triangle (right-facing) */
            <View
              style={{
                width: 0,
                height: 0,
                borderTopWidth: 8,
                borderBottomWidth: 8,
                borderRightWidth: 12,
                borderTopColor: 'transparent',
                borderBottomColor: 'transparent',
                borderRightColor: colors.primaryTealDeep,
                marginLeft: -2,
              }}
            />
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}
