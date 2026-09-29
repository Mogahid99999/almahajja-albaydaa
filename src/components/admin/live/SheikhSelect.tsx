/**
 * The sheikh field of a live draft — prefilled with the server's suggestion
 * (marked «مقترح»), changeable from a searchable list. Keyboard-friendly on web:
 * the field is a focusable button, the list opens with its search box focused,
 * Enter picks the first match.
 */
import Feather from '@expo/vector-icons/Feather';
import { Fragment, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';

import type { SheikhOption } from '@/api/types';
import { Divider, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { ADMIN_LIVE_COPY } from './liveAdminUi';

export function SheikhSelect({
  sheikhs,
  value,
  suggestedId,
  onChange,
  invalid = false,
}: {
  sheikhs: readonly SheikhOption[];
  value: string | null;
  suggestedId: string | null;
  onChange: (id: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = value ? (sheikhs.find((s) => s.id === value) ?? null) : null;

  const filtered = useMemo(() => {
    const q = query.trim();
    return q ? sheikhs.filter((s) => s.name.includes(q)) : sheikhs;
  }, [sheikhs, query]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${ADMIN_LIVE_COPY.sheikh}: ${selected?.name ?? ADMIN_LIVE_COPY.pickSheikh}`}
        style={({ pressed }) => ({
          minHeight: 46,
          backgroundColor: colors.surfaceWhite,
          borderWidth: 1.5,
          borderColor: invalid ? colors.accentBrassMuted : colors.borderSand2,
          borderRadius: radius.input,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Txt size={14} color={selected ? colors.textInk : colors.textGhost} style={{ flex: 1 }} numberOfLines={1}>
          {selected?.name ?? ADMIN_LIVE_COPY.pickSheikh}
        </Txt>
        {selected && selected.id === suggestedId ? (
          <View
            style={{
              backgroundColor: 'rgba(176,137,79,0.12)',
              borderRadius: radius.pill,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Txt size={11} weight="semibold" color={colors.accentBrassMuted}>
              {ADMIN_LIVE_COPY.suggested}
            </Txt>
          </View>
        ) : null}
        <Feather name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}
          onPress={() => setOpen(false)}
          accessibilityLabel="إغلاق"
        >
          <View
            onStartShouldSetResponder={() => true}
            style={{
              width: '100%',
              maxWidth: 380,
              maxHeight: 460,
              backgroundColor: colors.surfaceWhite,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.borderSand,
              overflow: 'hidden',
              ...shadows.raised,
            }}
          >
            <View style={{ padding: 12 }}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                autoFocus
                placeholder="ابحث عن الشيخ..."
                placeholderTextColor={colors.textGhost}
                textAlign="right"
                returnKeyType="done"
                onSubmitEditing={() => {
                  const first = filtered[0];
                  if (first) pick(first.id);
                }}
                accessibilityLabel="ابحث عن الشيخ"
                style={{
                  height: 42,
                  backgroundColor: colors.bgSandRaised,
                  borderRadius: radius.sm,
                  paddingHorizontal: 12,
                  fontFamily: fonts.body,
                  fontSize: 14,
                  color: colors.textInk,
                  writingDirection: 'rtl',
                }}
              />
            </View>
            <Divider />
            <ScrollView keyboardShouldPersistTaps="handled">
              {filtered.map((s, idx) => {
                const on = s.id === value;
                return (
                  <Fragment key={s.id}>
                    <Pressable
                      onPress={() => pick(s.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        backgroundColor: on ? 'rgba(31,74,66,0.05)' : pressed ? colors.bgSand : 'transparent',
                      })}
                    >
                      <Txt size={13.5} color={on ? colors.primaryTeal : colors.textInk} style={{ flex: 1 }}>
                        {s.name}
                      </Txt>
                      {s.id === suggestedId ? (
                        <Txt size={11} color={colors.accentBrassMuted}>
                          {ADMIN_LIVE_COPY.suggested}
                        </Txt>
                      ) : null}
                      {on ? <Feather name="check" size={14} color={colors.primaryTeal} /> : null}
                    </Pressable>
                    {idx < filtered.length - 1 ? <Divider /> : null}
                  </Fragment>
                );
              })}
              {filtered.length === 0 ? (
                <Txt size={13} color={colors.textGhost} align="center" style={{ padding: 16 }}>
                  لا يوجد شيخ بهذا الاسم
                </Txt>
              ) : null}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
