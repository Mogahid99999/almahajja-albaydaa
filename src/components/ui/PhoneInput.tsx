import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';

import { COUNTRIES, findCountry } from '@/constants/countries';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { Txt } from './Txt';

/**
 * Country-code trigger + local-number field, used everywhere a phone number
 * is entered (register, profile phone change, admin create/edit user) — see
 * `normalizePhone` (src/api/auth.ts) for why guessing the country from the
 * digits alone was wrong: a 9-digit Saudi number and a 9-digit Sudanese
 * number are indistinguishable, so the app must ask instead of assume.
 *
 * `value` is local digits only (no leading 0, no country code) — the caller
 * combines it with `countryCode` via `normalizePhone(value, countryCode)`.
 */
export function PhoneInput({
  countryCode,
  onChangeCountryCode,
  value,
  onChangeValue,
  placeholder = 'xxxxxxxxx',
  height = 44,
}: {
  countryCode: string;
  onChangeCountryCode: (code: string) => void;
  value: string;
  onChangeValue: (digits: string) => void;
  placeholder?: string;
  height?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = findCountry(countryCode);

  const candidates = useMemo(() => {
    const q = query.trim();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.includes(q) || c.code.includes(q));
  }, [query]);

  function handleSelect(code: string) {
    onChangeCountryCode(code);
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="اختيار رمز الدولة"
        style={({ pressed }) => [styles.trigger, { height }, pressed && { opacity: 0.7 }]}
      >
        <Txt size={16}>{selected.flag}</Txt>
        <Txt size={14} weight="medium" color={colors.textInk}>
          +{selected.code}
        </Txt>
        <Feather name="chevron-down" size={14} color={colors.textMuted} />
      </Pressable>

      <TextInput
        value={value}
        onChangeText={(t) => onChangeValue(t.replace(/[^0-9]/g, ''))}
        placeholder={placeholder}
        placeholderTextColor={colors.textGhost}
        keyboardType="phone-pad"
        style={[styles.input, { height }]}
      />

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.overlay} onStartShouldSetResponder={() => true}>
            <View style={styles.searchRow}>
              <Feather name="search" size={15} color={colors.textMuted} style={{ marginLeft: 8 }} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="ابحث عن الدولة..."
                placeholderTextColor={colors.textGhost}
                style={styles.searchInput}
                autoFocus
                textAlign="right"
              />
            </View>

            <View style={{ height: 1, backgroundColor: colors.borderHair }} />

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {candidates.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Txt size={13} color={colors.textGhost} align="center">
                    لا توجد نتائج
                  </Txt>
                </View>
              ) : null}
              {candidates.map((c) => {
                const active = c.code === countryCode;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => handleSelect(c.code)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    <Txt size={17}>{c.flag}</Txt>
                    <Txt
                      size={13.5}
                      weight={active ? 'semibold' : 'regular'}
                      color={active ? colors.primaryTeal : colors.textInk}
                      style={{ flex: 1 }}
                    >
                      {c.name}
                    </Txt>
                    <Txt size={12.5} color={colors.textMuted} tabular>
                      +{c.code}
                    </Txt>
                    {active ? <Feather name="check" size={15} color={colors.primaryTeal} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,

  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    backgroundColor: colors.surfaceWhite,
    paddingHorizontal: 14,
    textAlign: 'left',
    writingDirection: 'ltr',
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  } as ViewStyle,

  overlay: {
    width: 380,
    maxWidth: '100%',
    maxHeight: 440,
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderSand,
    overflow: 'hidden',
    ...shadows.raised,
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
    maxHeight: 370,
  } as ViewStyle,

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
