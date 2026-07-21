/**
 * التذكيرات النافعة — recipient targeting (migration 0120).
 *
 * By default a reminder reaches every student (no filter). This panel lets an
 * admin narrow it:
 *   • toggle «بلا بريد» (no email) and/or «غير مسجّل» (guest) — combined with AND,
 *   • search + tick specific users, with «تحديد كل النتائج» to pick the whole
 *     filtered list at once.
 *
 * State is lifted to the parent (reminders.tsx) so submit() can read it:
 *   - noEmail / notRegistered: attribute filters
 *   - selectedIds: explicitly ticked users
 * The parent decides the send shape — ticked users send as an explicit id list;
 * filters alone send as a filter-only target (whole filtered pool).
 */
import Feather from '@expo/vector-icons/Feather';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { Txt } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import { useBroadcastRecipients } from '@/hooks/useBroadcasts';
import { arNum } from '@/lib/format';

export type TargetingState = {
  enabled: boolean;
  noEmail: boolean;
  notRegistered: boolean;
  search: string;
  selectedIds: Set<string>;
};

export const EMPTY_TARGETING: TargetingState = {
  enabled: false,
  noEmail: false,
  notRegistered: false,
  search: '',
  selectedIds: new Set<string>(),
};

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.filterChip,
        active && styles.filterChipActive,
        pressed && { opacity: 0.6 },
      ]}
    >
      {active ? <Feather name="check" size={13} color={colors.onTealPrimary} /> : null}
      <Txt size={12.5} weight="medium" color={active ? colors.onTealPrimary : colors.textSlate}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function BroadcastTargeting({
  value,
  onChange,
}: {
  value: TargetingState;
  onChange: (next: TargetingState) => void;
}) {
  const set = (patch: Partial<TargetingState>) => onChange({ ...value, ...patch });

  const {
    items,
    totalCount,
    isLoading,
    isFetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useBroadcastRecipients(value.search, value.noEmail, value.notRegistered, {
    enabled: value.enabled,
  });

  const toggleUser = (id: string) => {
    const next = new Set(value.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  };

  // «تحديد كل النتائج» — tick every currently-loaded candidate. (Loads more as
  // the admin scrolls; select-all covers what's fetched, matching the visible list.)
  const allLoadedSelected =
    items.length > 0 && items.every((u) => value.selectedIds.has(u.id));
  const toggleSelectAll = () => {
    const next = new Set(value.selectedIds);
    if (allLoadedSelected) {
      items.forEach((u) => next.delete(u.id));
    } else {
      items.forEach((u) => next.add(u.id));
    }
    set({ selectedIds: next });
  };

  if (!value.enabled) {
    return (
      <Pressable
        onPress={() => set({ enabled: true })}
        style={({ pressed }) => [styles.enableRow, pressed && { opacity: 0.6 }]}
      >
        <Feather name="filter" size={15} color={colors.primaryTeal} />
        <Txt size={13} weight="medium" color={colors.primaryTeal}>
          تخصيص المستقبِلين (الافتراضي: كل الدارسين)
        </Txt>
      </Pressable>
    );
  }

  const selectedCount = value.selectedIds.size;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Txt size={12.5} weight="semibold" color={colors.textSlate}>
          إرسال إلى
        </Txt>
        <Pressable
          onPress={() => onChange({ ...EMPTY_TARGETING })}
          accessibilityRole="button"
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Txt size={12} color={colors.textMuted}>
            إلغاء التخصيص
          </Txt>
        </Pressable>
      </View>

      <View style={styles.filtersRow}>
        <FilterChip
          label="بلا بريد إلكتروني"
          active={value.noEmail}
          onPress={() => set({ noEmail: !value.noEmail })}
        />
        <FilterChip
          label="غير مسجّل (ضيف)"
          active={value.notRegistered}
          onPress={() => set({ notRegistered: !value.notRegistered })}
        />
      </View>

      <TextInput
        value={value.search}
        onChangeText={(s) => set({ search: s })}
        placeholder="ابحث بالاسم أو البريد أو الهاتف…"
        placeholderTextColor={colors.textGhost}
        textAlign="right"
        style={styles.search}
      />

      <View style={styles.listHeader}>
        <Txt size={11.5} color={colors.textMuted}>
          {isFetching && !items.length
            ? 'جارٍ التحميل…'
            : `${arNum(totalCount)} دارس مطابق` +
              (selectedCount ? ` · ${arNum(selectedCount)} محدَّد` : '')}
        </Txt>
        {items.length > 0 ? (
          <Pressable
            onPress={toggleSelectAll}
            accessibilityRole="button"
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <Txt size={12} weight="medium" color={colors.primaryTeal}>
              {allLoadedSelected ? 'إلغاء تحديد المعروض' : 'تحديد كل النتائج'}
            </Txt>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.list}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {isLoading ? (
          <View style={styles.listLoading}>
            <ActivityIndicator color={colors.primaryTeal} />
          </View>
        ) : items.length === 0 ? (
          <Txt size={12} color={colors.textMuted} align="center" style={{ padding: 16 }}>
            لا دارس مطابق
          </Txt>
        ) : (
          items.map((u) => {
            const checked = value.selectedIds.has(u.id);
            const sub = u.isAnonymous ? 'حساب ضيف' : u.email || u.phone || '—';
            return (
              <Pressable
                key={u.id}
                onPress={() => toggleUser(u.id)}
                style={({ pressed }) => [styles.userRow, pressed && { opacity: 0.6 }]}
              >
                <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                  {checked ? <Feather name="check" size={13} color={colors.onTealPrimary} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Txt size={13} weight="medium" color={colors.textInk} numberOfLines={1}>
                    {u.displayName || 'طالب علم'}
                  </Txt>
                  <Txt size={11} color={colors.textMuted} numberOfLines={1}>
                    {sub}
                  </Txt>
                </View>
              </Pressable>
            );
          })
        )}
        {hasNextPage ? (
          <Pressable
            onPress={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.6 }]}
          >
            <Txt size={12.5} weight="medium" color={colors.primaryTeal}>
              {isFetchingNextPage ? 'جارٍ التحميل…' : 'عرض المزيد'}
            </Txt>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  enableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  } as ViewStyle,

  panel: {
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.sm,
    padding: 12,
    gap: 10,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as ViewStyle,

  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  } as ViewStyle,

  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,

  filterChipActive: {
    backgroundColor: colors.primaryTeal,
    borderColor: colors.primaryTeal,
  } as ViewStyle,

  search: {
    minHeight: 42,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textInk,
  },

  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as ViewStyle,

  list: {
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSand,
    maxHeight: 320,
  } as ViewStyle,

  listLoading: { padding: 20, alignItems: 'center' } as ViewStyle,

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSand,
  } as ViewStyle,

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,

  checkboxOn: {
    backgroundColor: colors.primaryTeal,
    borderColor: colors.primaryTeal,
  } as ViewStyle,

  moreBtn: {
    paddingVertical: 11,
    alignItems: 'center',
  } as ViewStyle,
});
