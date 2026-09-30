/**
 * «اختر القسم» for starting / scheduling a live from the staff screen (owner
 * 2026-09-29: the old dropdown filled the whole phone screen with flat rows —
 * «حسن ال ui»). A field that opens a proper bottom sheet (the live sheets'
 * LiveSheet: dim backdrop, rounded top, 20 px gutters, ≈70 % of the screen):
 * a search box, then the section tree — indented by depth, each row with its
 * parent path and its own lecture / sub-section counts so same-named sections
 * are told apart (see sectionPicker.ts), the selected one ticked.
 */
import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';

import { LiveSheet } from '@/components/live/sheets/LiveSheet';
import { Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import { useAdminLectures } from '@/hooks/useAdmin';
import { useSectionsFlat } from '@/hooks/useSections';
import { directLectureCounts, sectionPickerRows, type SectionPickerRow } from './sectionPicker';

export const SECTION_PICKER_COPY = {
  title: 'اختر القسم',
  sub: 'يُحفظ تسجيل المجلس في القسم الذي تختاره.',
  placeholder: 'اختر القسم...',
  search: 'ابحث في الأقسام',
  empty: 'لا يوجد قسم بهذا الاسم',
  none: 'لا توجد أقسام بعد',
} as const;

export function SectionPicker({
  value,
  onChange,
  placeholder = SECTION_PICKER_COPY.placeholder,
}: {
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: sections = [] } = useSectionsFlat();
  const selected = value ? (sections.find((s) => s.id === value) ?? null) : null;
  const parentPath = selected && selected.path.length > 1 ? selected.path.slice(0, -1).join(' › ') : null;

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={selected ? `القسم: ${selected.path.join(' › ')}` : placeholder}
        accessibilityHint="يفتح قائمة الأقسام"
        style={({ pressed }) => ({
          minHeight: 50,
          backgroundColor: colors.surfaceWhite,
          borderWidth: 1.5,
          borderColor: open ? colors.primaryTeal600 : colors.borderSand2,
          borderRadius: radius.input,
          paddingHorizontal: 14,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Feather name="folder" size={16} color={selected ? colors.primaryTeal600 : colors.textGhost} />
        <View style={{ flex: 1, minWidth: 0 }}>
          {selected ? (
            <>
              <Txt size={14.5} weight="semibold" color={colors.textInk} numberOfLines={1}>
                {selected.title}
              </Txt>
              {parentPath ? (
                <Txt size={11.5} color={colors.textFaint} numberOfLines={1}>
                  {parentPath}
                </Txt>
              ) : null}
            </>
          ) : (
            <Txt size={14} color={colors.textGhost} numberOfLines={1}>
              {placeholder}
            </Txt>
          )}
        </View>
        <Feather name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>

      <LiveSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={SECTION_PICKER_COPY.title}
        sub={SECTION_PICKER_COPY.sub}
        heightRatio={0.72}
      >
        <SectionPickerBody
          value={value}
          onPick={(id) => {
            setOpen(false);
            onChange(id);
          }}
        />
      </LiveSheet>
    </View>
  );
}

/** Mounted only while the sheet is open (the lecture counts load then). */
function SectionPickerBody({ value, onPick }: { value: string | null; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const { data: sections, isLoading } = useSectionsFlat();
  const { data: lectures } = useAdminLectures();
  const counts = useMemo(() => directLectureCounts(lectures), [lectures]);
  const rows = useMemo(() => sectionPickerRows(sections ?? [], counts, query), [sections, counts, query]);
  const searching = query.trim().length > 0;

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 44,
          paddingHorizontal: 12,
          backgroundColor: colors.surfaceWhite,
          borderWidth: 1,
          borderColor: colors.borderSand2,
          borderRadius: radius.input,
        }}
      >
        <Feather name="search" size={15} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`${SECTION_PICKER_COPY.search}...`}
          placeholderTextColor={colors.textGhost}
          accessibilityLabel={SECTION_PICKER_COPY.search}
          textAlign="right"
          returnKeyType="search"
          style={{
            flex: 1,
            height: 44,
            fontFamily: fonts.body,
            fontSize: 14,
            color: colors.textInk,
            writingDirection: 'rtl',
          }}
        />
        {searching ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="مسح البحث">
            <Feather name="x" size={15} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {isLoading && !sections ? (
        <View style={{ paddingVertical: 28, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          style={{
            flexGrow: 0,
            flexShrink: 1,
            backgroundColor: colors.surfaceCard,
            borderWidth: 1,
            borderColor: colors.borderSand,
            borderRadius: radius.card,
          }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.borderHair }} />}
          ListEmptyComponent={
            <Txt size={13} color={colors.textGhost} align="center" style={{ padding: 20, alignSelf: 'stretch' }}>
              {searching ? SECTION_PICKER_COPY.empty : SECTION_PICKER_COPY.none}
            </Txt>
          }
          renderItem={({ item }) => (
            <SectionRow row={item} selected={item.id === value} indent={!searching} onPress={() => onPick(item.id)} />
          )}
        />
      )}
    </View>
  );
}

function SectionRow({
  row,
  selected,
  indent,
  onPress,
}: {
  row: SectionPickerRow;
  selected: boolean;
  indent: boolean;
  onPress: () => void;
}) {
  const depth = indent ? Math.min(row.depth, 4) : 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={[row.parentPath ? `${row.parentPath} › ${row.title}` : row.title, row.meta]
        .filter(Boolean)
        .join('، ')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 54,
        paddingVertical: 10,
        paddingStart: 14 + depth * 18,
        paddingEnd: 14,
        backgroundColor: selected ? 'rgba(31,74,66,0.07)' : pressed ? colors.bgSand : 'transparent',
      })}
    >
      <View style={{ width: 12, alignItems: 'center' }}>
        {row.depth === 0 ? (
          <Rhombus size={8} color={colors.primaryTeal} filled />
        ) : (
          <Rhombus size={7} color={colors.accentBrass} filled={false} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt
          size={14.5}
          weight={selected || row.depth === 0 ? 'semibold' : 'medium'}
          color={selected ? colors.primaryTeal : colors.textInk}
          numberOfLines={1}
        >
          {row.title}
        </Txt>
        {row.parentPath ? (
          <Txt size={11.5} color={colors.textFaint} numberOfLines={1}>
            {row.parentPath}
          </Txt>
        ) : null}
        {row.meta ? (
          <Txt size={11.5} color={colors.textGhost} numberOfLines={1}>
            {row.meta}
          </Txt>
        ) : null}
      </View>
      {selected ? <Feather name="check" size={16} color={colors.primaryTeal} /> : null}
    </Pressable>
  );
}
