import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';

import type { ResumeLecture } from '@/api/types';
import { colors, radius, shadows } from '@/constants/theme';
import { arDuration } from '@/lib/format';
import { preloadLecture } from '@/lib/audioController';
import { usePlayerStore } from '@/stores/playerStore';
import { ConcentricMotif, ProgressBar, RhombusEmblem, Txt } from '@/components/ui';

type Props = {
  continueListening: ResumeLecture | null;
};

/** Dismissal is keyed on `lectureId@position`, so × hides THIS resume state
 * only — any new listening activity (position moved, or a different lecture)
 * brings the card back with the fresh resume point. */
const DISMISSED_KEY = 'riwaq-dismissed-continue';

/**
 * "أكمِل الاستماع" — teal feature card on the Home screen.
 * Renders nothing when there is no resume position (no in-progress lecture)
 * or when the current resume snapshot was dismissed via the × button.
 */
export function ContinueCard({ continueListening }: Props) {
  const currentLectureId = usePlayerStore((s) => s.currentLectureId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const router = useRouter();

  // undefined = AsyncStorage still loading (render nothing rather than flash
  // the card and yank it away); null = nothing dismissed.
  const [dismissedSnapshot, setDismissedSnapshot] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(DISMISSED_KEY)
      .then((raw) => {
        if (!cancelled) setDismissedSnapshot(raw);
      })
      .catch(() => {
        if (!cancelled) setDismissedSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!continueListening || dismissedSnapshot === undefined) return null;

  const { id, title, sheikhName, eyebrow, positionSec, durationSec } = continueListening;
  const snapshot = `${id}@${Math.floor(positionSec)}`;
  if (dismissedSnapshot === snapshot) return null;

  const isActive = currentLectureId === id && isPlaying;
  const progress = durationSec > 0 ? positionSec / durationSec : 0;

  function dismiss() {
    setDismissedSnapshot(snapshot);
    void AsyncStorage.setItem(DISMISSED_KEY, snapshot).catch(() => {});
  }

  function handlePress() {
    // Start playback the instant the tap lands, in parallel with the
    // navigation — see preloadLecture's doc comment in audioController. Pass
    // the fresh, currently-displayed position as the resume point directly
    // (and as `t` below, same deep-link param a resume notification uses,
    // honored by app/player/[id].tsx, guarded to never rewind):
    // belt-and-suspenders alongside the cache-invalidation fix (Phase 3.1) —
    // this entry point never has to trust the lecture-cache resume value at
    // all, since it hands over the number it's already showing.
    const startAtSec = Math.floor(positionSec);
    void preloadLecture(id, { startAtSec });
    router.push(`/player/${id}?t=${startAtSec}`);
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

        {/* × dismiss — last row child = leftmost under forced RTL, top corner */}
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            dismiss();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="إخفاء البطاقة"
          style={({ pressed }) => ({
            width: 30,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'flex-start',
            marginTop: -10,
            marginLeft: -10,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="x" size={16} color={colors.onTealSecondary} />
        </Pressable>
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
