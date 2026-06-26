/**
 * PublishToggle — segmented control for draft/published status.
 *
 * Design reference: README › Interactions › "Publish segmented control (admin)"
 *   - Two segments: "مسودة" (draft) / "منشورة" (published).
 *   - Selected draft = white segment with shadow.
 *   - Selected published = teal segment with shadow.
 *   - Status note below with colored dot:
 *       draft  → accentBrassMuted dot + "هذه المحاضرة مسودة ولن تظهر للطلاب."
 *       published → stateSuccess dot + "ستظهر المحاضرة للطلاب فور الحفظ."
 */
import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Rhombus, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';

// ─── Props ───────────────────────────────────────────────────────────────────

interface PublishToggleProps {
  value: 'draft' | 'published';
  onChange: (v: 'draft' | 'published') => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PublishToggle({ value, onChange }: PublishToggleProps) {
  const isDraft = value === 'draft';

  return (
    <View style={styles.container}>
      {/* Segmented control */}
      <View style={styles.track}>
        <Pressable
          onPress={() => onChange('draft')}
          style={[styles.segment, isDraft && styles.segmentActiveDraft]}
          accessibilityRole="button"
          accessibilityLabel="مسودة"
          accessibilityState={{ selected: isDraft }}
        >
          <Txt
            size={13}
            weight={isDraft ? 'semibold' : 'regular'}
            color={isDraft ? colors.textInk : colors.textMuted}
          >
            مسودة
          </Txt>
        </Pressable>

        <Pressable
          onPress={() => onChange('published')}
          style={[styles.segment, !isDraft && styles.segmentActivePublished]}
          accessibilityRole="button"
          accessibilityLabel="منشورة"
          accessibilityState={{ selected: !isDraft }}
        >
          <Txt
            size={13}
            weight={!isDraft ? 'semibold' : 'regular'}
            color={!isDraft ? colors.onTealPrimary : colors.textMuted}
          >
            منشورة
          </Txt>
        </Pressable>
      </View>

      {/* Status note */}
      <View style={styles.noteRow}>
        <View
          style={[
            styles.dot,
            { backgroundColor: isDraft ? colors.accentBrassMuted : colors.stateSuccess },
          ]}
        />
        <Txt size={12} color={colors.textMuted} style={{ flex: 1 }}>
          {isDraft
            ? 'هذه المحاضرة مسودة ولن تظهر للطلاب.'
            : 'ستظهر المحاضرة للطلاب فور الحفظ.'}
        </Txt>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    gap: 10,
  } as ViewStyle,

  track: {
    flexDirection: 'row-reverse',
    backgroundColor: colors.surfaceTrack,
    borderRadius: radius.sm,
    padding: 3,
  } as ViewStyle,

  segment: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  } as ViewStyle,

  segmentActiveDraft: {
    backgroundColor: colors.surfaceWhite,
    ...shadows.button,
  } as ViewStyle,

  segmentActivePublished: {
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,

  noteRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  } as ViewStyle,

  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  } as ViewStyle,
});
