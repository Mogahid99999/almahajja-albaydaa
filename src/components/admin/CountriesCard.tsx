/**
 * «الطلاب حسب الدول 🌍» — one dashboard card (admin only): how many countries, the top 5 by
 * students with a small relative bar, «عرض جميع الدول» expands to the rest in place. Every row
 * opens إدارة المستخدمين filtered to that country (`/admin/users?country=SD`).
 * Counts come from admin_country_counts (migration 0165) — aggregated in the database.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import type { AdminCountryCount } from '@/api/adminUsers';
import { Card, Divider, ProgressBar, Txt } from '@/components/ui';
import { CountryFlag } from '@/components/ui/CountryFlag';
import { colors } from '@/constants/theme';
import { countryName } from '@/lib/countryDisplay';
import { arNum } from '@/lib/format';

const TOP = 5;

/** «طلاب من ١٨ دولة» — Arabic counted-noun agreement. */
export function countriesPhrase(n: number): string {
  if (n === 1) return 'طلاب من دولة واحدة';
  if (n === 2) return 'طلاب من دولتين';
  if (n >= 3 && n <= 10) return `طلاب من ${arNum(n)} دول`;
  return `طلاب من ${arNum(n)} دولة`;
}

export function CountriesCard({
  rows,
  loading,
}: {
  rows: AdminCountryCount[] | undefined;
  loading?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const list = rows ?? [];
  const max = list.reduce((m, r) => Math.max(m, r.users), 0);
  const shown = expanded ? list : list.slice(0, TOP);
  const open = (code: string) =>
    router.push(`/admin/users?country=${encodeURIComponent(code)}` as Parameters<typeof router.push>[0]);

  return (
    <Card padded={false} style={styles.card}>
      <View style={styles.header}>
        <Feather name="globe" size={16} color={colors.primaryTeal} />
        <View style={{ flex: 1, marginRight: 8 }}>
          <Txt weight="semibold" size={14} color={colors.textInk}>
            الطلاب حسب الدول 🌍
          </Txt>
          {list.length > 0 ? (
            <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
              {countriesPhrase(list.length)}
            </Txt>
          ) : null}
        </View>
      </View>
      <Divider />
      {list.length === 0 ? (
        <Txt size={12} color={colors.textMuted} align="center" style={{ padding: 16 }}>
          {loading ? 'جارٍ التحميل…' : 'لا توجد بيانات دول بعد.'}
        </Txt>
      ) : (
        shown.map((r, i) => (
          <React.Fragment key={r.country}>
            <Pressable
              onPress={() => open(r.country)}
              accessibilityRole="link"
              accessibilityLabel={`${countryName(r.country)}، ${arNum(r.users)} طالب`}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.row,
                (pressed || hovered) && styles.rowActive,
              ]}
            >
              {/* RTL row: flag · name ……… count */}
              <View style={styles.rowLine}>
                <CountryFlag code={r.country} />
                <Txt size={13} color={colors.textInk} numberOfLines={1} style={{ flex: 1 }}>
                  {countryName(r.country)}
                </Txt>
                <Txt size={12.5} color={colors.textFaint} tabular>
                  {arNum(r.users)}
                </Txt>
              </View>
              <ProgressBar value={max > 0 ? r.users / max : 0} height={5} tint="teal" style={{ marginTop: 6 }} />
            </Pressable>
            {i < shown.length - 1 && <Divider />}
          </React.Fragment>
        ))
      )}
      {list.length > TOP ? (
        <>
          <Divider />
          <Pressable
            onPress={() => setExpanded((e) => !e)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.footer, pressed && styles.rowActive]}
          >
            <Txt size={12.5} weight="semibold" color={colors.primaryTeal} align="center">
              {expanded ? 'عرض أقل' : 'عرض جميع الدول'}
            </Txt>
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: 260,
    flexGrow: 1,
    minWidth: 240,
    overflow: 'hidden',
  } as ViewStyle,
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  } as ViewStyle,
  row: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  } as ViewStyle,
  rowActive: { backgroundColor: colors.bgSand } as ViewStyle,
  rowLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,
  footer: {
    paddingVertical: 11,
    paddingHorizontal: 14,
  } as ViewStyle,
});
