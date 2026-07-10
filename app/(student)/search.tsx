/**
 * بحث — search across every content type, opened from the bottom nav bar.
 *
 * Server-side full-text search (Postgres tsvector, prefix-matched) over
 * published content only (search_content RPC, migration 0068), covering
 * sections, lectures, sheikhs, attachments, lecture_benefits (فوائد), and
 * questions — same debounce pattern as buddy-search.tsx.
 *
 * Route: /(student)/search
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
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

/** One result row — same icon-chip + two-line layout for every category. */
function ResultRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
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
            <Feather name={icon} size={18} color={colors.primaryTeal} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt size={14.5} weight="medium" color={colors.textInk} numberOfLines={1}>
              {title}
            </Txt>
            <Txt size={11.5} color={colors.textMuted} style={{ marginTop: 2 }} numberOfLines={1}>
              {subtitle}
            </Txt>
          </View>
          <Feather name="chevron-left" size={18} color={colors.textGhost} />
        </View>
      </Card>
    </Pressable>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { data, isLoading, isFetching } = useContentSearch(query);
  const miniPad = useMiniPlayerPad();

  const hasQuery = query.trim() !== '';
  const lectures = data?.lectures ?? [];
  const sections = data?.sections ?? [];
  const sheikhs = data?.sheikhs ?? [];
  const attachments = data?.attachments ?? [];
  const benefits = data?.benefits ?? [];
  const questions = data?.questions ?? [];
  const noResults =
    hasQuery &&
    !isLoading &&
    lectures.length === 0 &&
    sections.length === 0 &&
    sheikhs.length === 0 &&
    attachments.length === 0 &&
    benefits.length === 0 &&
    questions.length === 0;

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
        placeholder="ابحث عن درس أو قسم أو شيخ…"
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
            ابدأ بكتابة اسم الدرس أو القسم أو الشيخ
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
            <ResultRow
              key={`section-${s.id}`}
              icon="folder"
              title={s.title}
              subtitle="قسم"
              onPress={() => router.push({ pathname: '/section/[id]', params: { id: s.id } })}
            />
          ))}

          {lectures.map((l) => (
            <ResultRow
              key={`lecture-${l.id}`}
              icon="play"
              title={l.title}
              subtitle={
                [l.sheikhName, l.sectionTitle].filter(Boolean).join(' · ') || arDuration(l.durationSec)
              }
              onPress={() => {
                // Start playback the instant the tap lands, in parallel with
                // navigation — see preloadLecture's doc comment in audioController.
                void preloadLecture(l.id);
                router.push({ pathname: '/player/[id]', params: { id: l.id } });
              }}
            />
          ))}

          {sheikhs.map((sh) => (
            <ResultRow
              key={`sheikh-${sh.id}`}
              icon="user"
              title={sh.name}
              subtitle="شيخ"
              onPress={() => router.push('/(student)/sheikh-info')}
            />
          ))}

          {benefits.map((b) => (
            <ResultRow
              key={`benefit-${b.id}`}
              icon="star"
              title={b.snippet}
              subtitle={`فائدة · ${b.lectureTitle}`}
              onPress={() =>
                router.push({ pathname: '/(student)/lecture-benefits/[id]', params: { id: b.lectureId } })
              }
            />
          ))}

          {questions.map((q) => (
            <ResultRow
              key={`question-${q.id}`}
              icon="help-circle"
              title={q.bodySnippet}
              subtitle={q.scope === 'lecture' ? `سؤال · ${q.lectureTitle}` : 'سؤال عام'}
              onPress={() =>
                q.scope === 'lecture' && q.lectureId
                  ? router.push({
                      pathname: '/(student)/lecture-questions/[id]',
                      params: { id: q.lectureId },
                    })
                  : router.push('/(student)/questions')
              }
            />
          ))}

          {attachments.map((a) => (
            <ResultRow
              key={`attachment-${a.id}`}
              icon="paperclip"
              title={a.title}
              subtitle={`مرفق · ${a.lectureTitle ?? a.sectionTitle ?? ''}`}
              onPress={() =>
                a.lectureId
                  ? router.push({ pathname: '/player/[id]', params: { id: a.lectureId } })
                  : a.sectionId
                    ? router.push({ pathname: '/section/[id]', params: { id: a.sectionId } })
                    : undefined
              }
            />
          ))}
        </>
      )}
    </Screen>
  );
}
