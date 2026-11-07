/**
 * «🌍 كل الدول ▾» — the users-page country filter (migration 0165). A chip beside the status
 * chips; it opens the countries that actually exist in the data, largest first, with their
 * account counts (admin_country_counts, aggregated in the database) and «كل الدول» to clear.
 * The value is an ISO code ('ZZ' = no recognisable calling code); the screen keeps it in the URL.
 * Same visual language as the status chips and the registration country picker (PhoneInput).
 */
import Feather from '@expo/vector-icons/Feather';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import type { AdminCountryCount } from '@/api/adminUsers';
import { Txt } from '@/components/ui';
import { CountryFlag } from '@/components/ui/CountryFlag';
import { colors, radius, shadows } from '@/constants/theme';
import { countryName } from '@/lib/countryDisplay';
import { arNum } from '@/lib/format';

export function CountryFilter({
  value,
  onChange,
  counts,
  loading,
}: {
  value: string | undefined;
  onChange: (country: string | undefined) => void;
  counts: AdminCountryCount[] | undefined;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = !!value;
  const list = counts ?? [];
  const pick = (c: string | undefined) => {
    setOpen(false);
    if (c !== value) onChange(c);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="تصفية حسب الدولة"
        style={[styles.chip, active && styles.chipActive]}
      >
        {/* RTL chip: flag · name · ▾ */}
        {active ? <CountryFlag code={value} size={13} /> : <Txt size={12}>🌍</Txt>}
        <Txt
          size={12}
          weight={active ? 'semibold' : 'regular'}
          color={active ? colors.onTealPrimary : colors.textMuted}
        >
          {active ? countryName(value) : 'كل الدول'}
        </Txt>
        <Feather name="chevron-down" size={13} color={active ? colors.onTealPrimary : colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.overlay} onStartShouldSetResponder={() => true}>
            <View style={styles.titleRow}>
              <Txt weight="semibold" size={14} color={colors.textInk}>
                الدولة
              </Txt>
            </View>
            <View style={{ height: 1, backgroundColor: colors.borderHair }} />
            <ScrollView style={styles.list}>
              <Row label="كل الدول" selected={!value} onPress={() => pick(undefined)} />
              {list.map((c) => (
                <Row
                  key={c.country}
                  code={c.country}
                  label={countryName(c.country)}
                  count={c.users}
                  selected={c.country === value}
                  onPress={() => pick(c.country)}
                />
              ))}
              {list.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Txt size={13} color={colors.textGhost} align="center">
                    {loading ? 'جارٍ التحميل…' : 'لا توجد بيانات دول بعد.'}
                  </Txt>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function Row({
  label,
  code,
  count,
  selected,
  onPress,
}: {
  label: string;
  /** ISO code → flag; omitted = «كل الدول» (🌍). */
  code?: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {/* RTL row: flag · name ……… count · ✓ */}
      {code ? <CountryFlag code={code} size={16} /> : <Txt size={16}>🌍</Txt>}
      <Txt
        size={13.5}
        weight={selected ? 'semibold' : 'regular'}
        color={selected ? colors.primaryTeal : colors.textInk}
        numberOfLines={1}
        style={{ flex: 1 }}
      >
        {label}
      </Txt>
      {count !== undefined ? (
        <Txt size={12.5} color={colors.textMuted} tabular>
          {arNum(count)}
        </Txt>
      ) : null}
      {selected ? <Feather name="check" size={15} color={colors.primaryTeal} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,
  chipActive: { backgroundColor: colors.primaryTeal } as ViewStyle,
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
    maxHeight: 480,
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderSand,
    overflow: 'hidden',
    ...shadows.raised,
  } as ViewStyle,
  titleRow: { paddingHorizontal: 14, height: 46, justifyContent: 'center' } as ViewStyle,
  list: { maxHeight: 420 } as ViewStyle,
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
  rowPressed: { backgroundColor: colors.bgSand } as ViewStyle,
  emptyRow: { padding: 28, alignItems: 'center' } as ViewStyle,
});
