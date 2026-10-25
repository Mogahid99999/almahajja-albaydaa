/**
 * The «مصدر» row under a lecture question or a benefit: section crumb + lesson
 * title; opens the lesson in the existing player (no new screen).
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { QuestionSource } from '@/api/questions';
import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';

/** The «مصدر» row: section crumb + lesson title, opens the lesson. */
export function SourceLink({ src }: { src: QuestionSource }) {
  const router = useRouter();
  if (!src.lectureId || !src.lectureTitle) return null;
  const crumb = [src.parentTitle, src.sectionTitle].filter(Boolean).join(' ← ');
  return (
    <Pressable
      onPress={() => router.push(`/player/${src.lectureId}`)}
      accessibilityRole="link"
      accessibilityLabel={`فتح الدرس: ${src.lectureTitle}`}
      style={({ pressed }) => [styles.src, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.srcPlay}>
        <Feather name="play" size={13} color={colors.onTealPrimary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {crumb ? (
          <Txt size={11} color={colors.textGhost} numberOfLines={1}>
            {crumb}
          </Txt>
        ) : null}
        <Txt size={12.5} weight="semibold" color={colors.primaryTeal} numberOfLines={2}>
          {src.lectureTitle}
        </Txt>
      </View>
      <Feather name="chevron-left" size={16} color={colors.textGhost} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  src: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceInset,
    borderRadius: radius.input,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  srcPlay: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
