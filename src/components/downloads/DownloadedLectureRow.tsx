/**
 * DownloadedLectureRow — one row on the Downloads page.
 *
 * RTL layout (right → left):
 *   [RhombusEmblem 40px] [title + sheikh + duration (flex:1)] [DownloadButton]
 *
 * Tapping the row → opens the full player page (which auto-starts playback).
 * The DownloadButton in downloaded state lets the user delete the file.
 *
 * Design tokens: manuscript-warm palette, IBM Plex Sans Arabic body, Amiri titles.
 */
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { arDuration } from '@/lib/format';
import { colors } from '@/constants/theme';
import { preloadLecture } from '@/lib/audioController';
import { DownloadButton } from '@/components/DownloadButton';
import { RhombusEmblem } from '@/components/ui/Rhombus';
import { Txt } from '@/components/ui/Txt';
import type { LectureCard } from '@/api/types';

type Props = {
  lecture: LectureCard;
};

export function DownloadedLectureRow({ lecture }: Props) {
  const { id, title, sheikhName, durationSec } = lecture;
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => {
        // Start playback the instant the tap lands, in parallel with the
        // navigation — see preloadLecture's doc comment in audioController.
        void preloadLecture(id);
        router.push(`/player/${id}`);
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 13,
        paddingHorizontal: 16,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {/* Artwork tile: small RhombusEmblem as cover stand-in */}
      <View style={{ flexShrink: 0 }}>
        <RhombusEmblem size={40} radius={10} />
      </View>

      {/* Title + sheikh + duration — flex:1 so it fills the middle */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt
          size={14}
          weight="semibold"
          color={colors.textInk}
          style={{ lineHeight: 19 }}
          numberOfLines={2}
        >
          {title}
        </Txt>

        {/* Meta row: sheikh name · duration */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 4,
            flexWrap: 'wrap',
          }}
        >
          {sheikhName ? (
            <>
              <Txt size={11} color={colors.textGhost}>
                {sheikhName}
              </Txt>
              <View
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: 1.5,
                  backgroundColor: colors.accentBrassSoft,
                }}
              />
            </>
          ) : null}
          <Txt size={11} color={colors.textGhost} tabular>
            {arDuration(durationSec)}
          </Txt>
        </View>
      </View>

      {/* DownloadButton on the left edge (RTL) — in "downloaded" state shows delete */}
      <View onStartShouldSetResponder={() => true}>
        <DownloadButton lectureId={id} size={20} />
      </View>
    </Pressable>
  );
}
