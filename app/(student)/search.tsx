/**
 * بحث — lecture/section search, opened from the bottom nav bar.
 *
 * Server-side ilike search over published content only (search_content RPC,
 * migration 0058) — same debounce pattern as buddy-search.tsx.
 *
 * Route: /(student)/search
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { colors, fonts, radius } from '@/constants/theme';
import { arDuration } from '@/lib/format';
import { preloadLecture } from '@/lib/audioController';
import { useContentSearch } from '@/hooks/useSearch';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { data, isLoading, isFetching } = useContentSearch(query);
  const miniPad = useMiniPlayerPad();

  const hasQuery = query.trim() !== '';
  const lectures = data?.lectures ?? [];
  const sections = data?.sections ?? [];
  const noResults = hasQuery && !isLoading && lectures.length === 0 && sections.length === 0;

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded>
      {/* ── Nav row ─────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 22,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          بحث
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      {/* Search input */}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="ابحث عن درس أو قسم…"
        placeholderTextColor={colors.textGhost}
        autoFocus
        style={{
          height: 46,
          borderWidth: 1,
          borderColor: colors.borderSand2,
          borderRadius: radius.input,
          backgroundColor: colors.surfaceWhite,
          paddingHorizontal: 14,
          textAlign: 'right' as const,
          writingDirection: 'rtl' as const,
          fontFamily: fonts.body,
          fontSize: 14,
          color: colors.textInk,
          marginBottom: 16,
        }}
      />

      {!hasQuery ? (
        <View style={{ paddingVertical: 40, alignItems: 'center', gap: 8 }}>
          <Feather name="search" size={24} color={colors.textGhost} />
          <Txt size={13} color={colors.textMuted} align="center">
            ابدأ بكتابة اسم الدرس أو القسم
          </Txt>
        </View>
      ) : isLoading && isFetching ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
      ) : noResults ? (
        <View style={{ paddingVertical: 40, alignItems: 'center', gap: 8 }}>
          <Feather name="search" size={24} color={colors.textGhost} />
          <Txt size={13} color={colors.textMuted} align="center">
            لا نتائج — جرّب كلمة أخرى
          </Txt>
        </View>
      ) : (
        <>
          {sections.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => router.push({ pathname: '/section/[id]', params: { id: s.id } })}
              accessibilityRole="button"
            >
              <Card style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: colors.surfaceInset,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Feather name="folder" size={18} color={colors.primaryTeal} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt size={14.5} weight="medium" color={colors.textInk}>
                      {s.title}
                    </Txt>
                    <Txt size={11.5} color={colors.textMuted} style={{ marginTop: 2 }}>
                      قسم
                    </Txt>
                  </View>
                  <Feather name="chevron-left" size={18} color={colors.textGhost} />
                </View>
              </Card>
            </Pressable>
          ))}

          {lectures.map((l) => (
            <Pressable
              key={l.id}
              onPress={() => {
                // Start playback the instant the tap lands, in parallel with
                // navigation — see preloadLecture's doc comment in audioController.
                void preloadLecture(l.id);
                router.push({ pathname: '/player/[id]', params: { id: l.id } });
              }}
              accessibilityRole="button"
            >
              <Card style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: colors.surfaceInset,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Feather name="play" size={16} color={colors.primaryTeal} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt size={14.5} weight="medium" color={colors.textInk} numberOfLines={1}>
                      {l.title}
                    </Txt>
                    <Txt size={11.5} color={colors.textMuted} style={{ marginTop: 2 }} numberOfLines={1}>
                      {[l.sheikhName, l.sectionTitle].filter(Boolean).join(' · ') || arDuration(l.durationSec)}
                    </Txt>
                  </View>
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      )}
    </Screen>
  );
}
