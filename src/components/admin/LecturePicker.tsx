/**
 * LecturePicker — a searchable overlay for adding an existing published lecture
 * to the «المختارات» curated list (admin). Modeled on TreePicker's UX (trigger
 * → modal → search input → scrollable rows), sourced from the existing
 * is_content_manager-aware useAdminLectures() hook. Candidates are filtered
 * client-side to status === 'published' AND not already in the curated set.
 */
import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { Txt } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import { arDuration } from '@/lib/format';
import { useAdminLectures } from '@/hooks/useAdmin';

interface LecturePickerProps {
  /** Lecture ids already in the curated list — hidden from the candidates. */
  excludeIds: string[];
  onSelect: (lectureId: string) => void;
  disabled?: boolean;
}

export function LecturePicker({ excludeIds, onSelect, disabled }: LecturePickerProps) {
  const { data: lectures = [] } = useAdminLectures();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lectures.filter((l) => {
      if (l.status !== 'published' || excludeSet.has(l.id)) return false;
      if (!q) return true;
      return (
        l.title.toLowerCase().includes(q) ||
        (l.sectionTitle ?? '').toLowerCase().includes(q) ||
        (l.sheikhName ?? '').toLowerCase().includes(q)
      );
    });
  }, [lectures, excludeSet, query]);

  function handleSelect(id: string) {
    onSelect(id);
    setOpen(false);
    setQuery('');
  }

  return (
    <View>
      {/* Trigger */}
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        style={({ pressed }) => [styles.trigger, (pressed || disabled) && { opacity: 0.7 }]}
      >
        <Feather name="plus" size={16} color={colors.onTealPrimary} />
        <Txt size={13} weight="semibold" color={colors.onTealPrimary}>
          إضافة محاضرة
        </Txt>
      </Pressable>

      {/* Overlay modal */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.overlay} onStartShouldSetResponder={() => true}>
            {/* Search */}
            <View style={styles.searchRow}>
              <Feather name="search" size={15} color={colors.textMuted} style={{ marginLeft: 8 }} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="ابحث عن محاضرة..."
                placeholderTextColor={colors.textGhost}
                style={styles.searchInput}
                autoFocus
                textAlign="right"
              />
            </View>

            <View style={{ height: 1, backgroundColor: colors.borderHair }} />

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {candidates.length === 0 && (
                <View style={styles.emptyRow}>
                  <Txt size={13} color={colors.textGhost} align="center">
                    لا توجد محاضرات منشورة متاحة للإضافة
                  </Txt>
                </View>
              )}

              {candidates.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => handleSelect(l.id)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <View style={{ flex: 1 }}>
                    <Txt size={13.5} weight="semibold" color={colors.textInk} numberOfLines={1}>
                      {l.title}
                    </Txt>
                    <Txt size={11.5} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
                      {[l.sectionTitle, l.sheikhName].filter(Boolean).join(' · ') || 'غير مصنّف'}
                    </Txt>
                  </View>
                  <Txt size={11} color={colors.textGhost} tabular style={{ marginLeft: 10 }}>
                    {arDuration(l.durationSec)}
                  </Txt>
                  <Feather name="plus-circle" size={16} color={colors.primaryTeal} style={{ marginLeft: 2 }} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 42,
    paddingHorizontal: 18,
    borderRadius: radius.input,
    backgroundColor: colors.primaryTeal,
    justifyContent: 'center',
  } as ViewStyle,

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  } as ViewStyle,

  overlay: {
    width: 460,
    maxWidth: '100%',
    maxHeight: 460,
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderSand,
    overflow: 'hidden',
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  } as ViewStyle,

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 46,
  } as ViewStyle,

  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
    paddingHorizontal: 8,
    height: 46,
    textAlign: 'right',
  },

  list: {
    maxHeight: 380,
  } as ViewStyle,

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderHair,
  } as ViewStyle,

  rowPressed: {
    backgroundColor: colors.bgSand,
  } as ViewStyle,

  emptyRow: {
    padding: 28,
    alignItems: 'center',
  } as ViewStyle,
});
