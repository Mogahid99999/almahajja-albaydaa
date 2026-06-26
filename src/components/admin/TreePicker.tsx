/**
 * TreePicker — searchable nested-tree section picker (admin).
 *
 * Design reference: README › Interactions › "Searchable tree dropdown (admin)"
 *   - Clicking the field toggles an overlay; active field border → primaryTeal600.
 *   - Overlay has a search input that filters by node title OR ancestor path.
 *   - Rows indented by `paddingRight: 12 + depth * 20`.
 *   - depth-0 nodes: filled teal Rhombus; deeper: brass ring Rhombus.
 *   - Selecting closes overlay, sets value, clears query.
 *   - Field shows full breadcrumb path joined with " › ", leaf in a teal-tint pill.
 *   - If `allowNull`, a "— المستوى الأعلى —" option sets null.
 */
import { Feather } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import { useSectionsFlat } from '@/hooks/useSections';
import type { FlatSectionNode } from '@/api/types';

// ─── Props ───────────────────────────────────────────────────────────────────

interface TreePickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  allowNull?: boolean;
  label?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TreePicker({ value, onChange, allowNull = false, label }: TreePickerProps) {
  const { data: sections = [] } = useSectionsFlat();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // The selected node (for display)
  const selectedNode = useMemo(
    () => (value ? sections.find((s) => s.id === value) ?? null : null),
    [value, sections],
  );

  // Filter flat tree by query
  const filtered = useMemo<FlatSectionNode[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.path.some((p) => p.toLowerCase().includes(q)),
    );
  }, [sections, query]);

  function handleSelect(id: string | null) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  // Display value: breadcrumb path, leaf emphasized
  function renderFieldContent() {
    if (!selectedNode) {
      return (
        <Txt size={14} color={colors.textGhost} style={{ flex: 1 }}>
          {label ?? 'اختر القسم الأب'}
        </Txt>
      );
    }
    const ancestors = selectedNode.path.slice(0, -1);
    const leaf = selectedNode.path[selectedNode.path.length - 1];
    return (
      <View style={styles.breadcrumbRow}>
        {ancestors.map((part, i) => (
          <React.Fragment key={i}>
            <Txt size={12} color={colors.textMuted} key={`p-${i}`}>
              {part}
            </Txt>
            <Txt size={12} color={colors.textGhost} key={`s-${i}`}> › </Txt>
          </React.Fragment>
        ))}
        <View style={styles.leafPill}>
          <Txt size={12} weight="semibold" color={colors.primaryTeal600}>
            {leaf}
          </Txt>
        </View>
      </View>
    );
  }

  return (
    <View>
      {/* Trigger field */}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={[styles.field, open && styles.fieldOpen]}
      >
        {renderFieldContent()}
        <Feather
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </Pressable>

      {/* Overlay modal */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View
            style={styles.overlay}
            // Stop propagation so tapping inside doesn't close
            onStartShouldSetResponder={() => true}
          >
            {/* Search */}
            <View style={styles.searchRow}>
              <Feather name="search" size={15} color={colors.textMuted} style={{ marginLeft: 8 }} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="ابحث في الأقسام..."
                placeholderTextColor={colors.textGhost}
                style={styles.searchInput}
                autoFocus
                textAlign="right"
              />
            </View>

            <View style={{ height: 1, backgroundColor: colors.borderHair }} />

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {/* Null option */}
              {allowNull && (
                <Pressable
                  onPress={() => handleSelect(null)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <Txt size={13} color={colors.textMuted} style={{ flex: 1 }}>
                    — المستوى الأعلى —
                  </Txt>
                </Pressable>
              )}

              {filtered.length === 0 && (
                <View style={styles.emptyRow}>
                  <Txt size={13} color={colors.textGhost}>
                    لا توجد نتائج
                  </Txt>
                </View>
              )}

              {filtered.map((node) => (
                <Pressable
                  key={node.id}
                  onPress={() => handleSelect(node.id)}
                  style={({ pressed }) => [
                    styles.row,
                    { paddingRight: 12 + node.depth * 20 },
                    node.id === value && styles.rowSelected,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={styles.rowBullet}>
                    {node.depth === 0 ? (
                      <Rhombus size={8} color={colors.primaryTeal} filled />
                    ) : (
                      <Rhombus size={8} color={colors.accentBrass} filled={false} />
                    )}
                  </View>
                  <Txt
                    size={13}
                    color={node.id === value ? colors.primaryTeal : colors.textInk}
                    weight={node.id === value ? 'semibold' : 'regular'}
                    style={{ flex: 1 }}
                  >
                    {node.title}
                  </Txt>
                  {node.id === value && (
                    <Feather name="check" size={14} color={colors.primaryTeal} style={{ marginLeft: 8 }} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  field: {
    height: 46,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  fieldOpen: {
    borderColor: colors.primaryTeal600,
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  } as ViewStyle,

  breadcrumbRow: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 2,
  } as ViewStyle,

  leafPill: {
    backgroundColor: 'rgba(31,74,66,0.08)',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  } as ViewStyle,

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  } as ViewStyle,

  overlay: {
    width: 460,
    maxHeight: 420,
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
    maxHeight: 340,
  } as ViewStyle,

  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 16,
    minHeight: 40,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderHair,
  } as ViewStyle,

  rowSelected: {
    backgroundColor: 'rgba(31,74,66,0.05)',
  } as ViewStyle,

  rowPressed: {
    backgroundColor: colors.bgSand,
  } as ViewStyle,

  rowBullet: {
    marginLeft: 10,
    width: 16,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  emptyRow: {
    padding: 20,
    alignItems: 'center',
  } as ViewStyle,
});
