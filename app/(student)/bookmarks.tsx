/**
 * «المراجعة لاحقًا» — the bookmarks review page (V20 · §4).
 *
 * Every saved mark with its section · series · lesson · timestamp · note · date ·
 * status. Tapping a mark opens the lesson and seeks to the saved minute via the
 * existing `?t=` deep-link (guarded to never rewind the lesson's own progress).
 * Manage: mark reviewed / return to review, delete, filter to unreviewed only. A
 * reviewed mark shows the calm «تمت مراجعة هذه العلامة» line.
 *
 * Route: /(student)/bookmarks (linked from the profile «المراجعة لاحقًا — N» entry
 * and a shortcut on رحلتي العلمية).
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';

import type { Bookmark } from '@/api/bookmarks';
import { colors, radius } from '@/constants/theme';
import { arDuration } from '@/lib/format';
import { preloadLecture } from '@/lib/audioController';
import { useCurrentUser } from '@/hooks/useAuth';
import {
  useBookmarks,
  useDeleteBookmark,
  useSetBookmarkReviewed,
} from '@/hooks/useBookmarks';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { JourneyGate } from '@/components/journey/JourneyGate';

function BookmarkRow({ b }: { b: Bookmark }) {
  const router = useRouter();
  const setReviewed = useSetBookmarkReviewed();
  const del = useDeleteBookmark();

  const breadcrumb = b.sectionTitle ? b.sectionTitle : '';
  const reviewed = b.status === 'reviewed';

  function open() {
    const pos = Math.max(0, Math.floor(b.positionSec));
    void preloadLecture(b.lectureId, { startAtSec: pos });
    router.push(`/player/${b.lectureId}?t=${pos}`);
  }

  return (
    <Card style={{ gap: 8, opacity: reviewed ? 0.7 : 1 }}>
      <Pressable onPress={open} accessibilityRole="button" style={{ gap: 6 }}>
        {breadcrumb ? (
          <Txt size={11.5} weight="medium" color={colors.accentBrassMuted} numberOfLines={1}>
            {breadcrumb}
          </Txt>
        ) : null}
        <Txt weight="semibold" size={15} color={colors.textInk} numberOfLines={2}>
          {b.lectureTitle}
        </Txt>
        <Txt size={12.5} weight="semibold" color={colors.primaryTeal600} tabular>
          {`الدقيقة ${arDuration(b.positionSec)}`}
        </Txt>
        {b.note ? (
          <Txt size={12.5} color={colors.textMuted} numberOfLines={3} style={{ lineHeight: 20 }}>
            {b.note}
          </Txt>
        ) : null}
      </Pressable>

      {reviewed ? (
        <Txt size={11.5} color={colors.stateSuccess}>
          تمت مراجعة هذه العلامة
        </Txt>
      ) : null}

      {/* Actions row */}
      <View
        style={{
          flexDirection: 'row',
          gap: 14,
          alignItems: 'center',
          justifyContent: 'flex-start',
          marginTop: 2,
        }}
      >
        <Pressable
          onPress={() => setReviewed.mutate({ id: b.id, reviewed: !reviewed })}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={reviewed ? 'إعادة إلى المراجعة' : 'تمت مراجعتها'}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, opacity: pressed ? 0.6 : 1 })}
        >
          <Feather name={reviewed ? 'rotate-ccw' : 'check'} size={14} color={colors.primaryTeal600} />
          <Txt size={12} weight="medium" color={colors.primaryTeal600}>
            {reviewed ? 'إعادة للمراجعة' : 'تمت مراجعتها'}
          </Txt>
        </Pressable>

        <Pressable
          onPress={() => del.mutate(b.id)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="حذف العلامة"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, opacity: pressed ? 0.6 : 1 })}
        >
          <Feather name="trash-2" size={14} color={colors.stateDanger} />
          <Txt size={12} weight="medium" color={colors.stateDanger}>
            حذف
          </Txt>
        </Pressable>
      </View>
    </Card>
  );
}

export default function BookmarksScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: bookmarks, isLoading, refetch } = useBookmarks({ enabled: !isGuest });
  const miniPad = useMiniPlayerPad();
  const { refreshing, onRefresh } = usePullToRefresh([refetch]);

  const [unreviewedOnly, setUnreviewedOnly] = useState(false);

  const shown = useMemo(
    () => (bookmarks ?? []).filter((b) => !unreviewedOnly || b.status === 'pending'),
    [bookmarks, unreviewedOnly],
  );
  const pendingCount = (bookmarks ?? []).filter((b) => b.status === 'pending').length;

  return (
    <Screen
      bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}
      padded
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginBottom: 18,
        }}
      >
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
          المراجعة لاحقًا
        </Txt>
      </View>

      {isGuest ? (
        <JourneyGate />
      ) : isLoading || !bookmarks ? (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      ) : bookmarks.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
          <Feather name="bookmark" size={28} color={colors.borderSand2} />
          <Txt size={14} color={colors.textMuted} align="center">
            لا توجد علامات محفوظة بعد
          </Txt>
          <Txt size={12} color={colors.textFaint} align="center" style={{ lineHeight: 19 }}>
            أثناء الاستماع، اضغط «للمراجعة» لحفظ لحظة تعود إليها لاحقًا
          </Txt>
        </Card>
      ) : (
        <>
          {/* Filter toggle */}
          <Pressable
            onPress={() => setUnreviewedOnly((v) => !v)}
            accessibilityRole="button"
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: radius.pill,
              backgroundColor: unreviewedOnly ? colors.primaryTeal : colors.bgSandRaised,
              borderWidth: 1,
              borderColor: unreviewedOnly ? colors.primaryTeal : colors.borderSand,
              marginBottom: 14,
            }}
          >
            <Feather
              name="filter"
              size={13}
              color={unreviewedOnly ? colors.onTealPrimary : colors.textMuted}
            />
            <Txt
              size={12.5}
              weight="medium"
              color={unreviewedOnly ? colors.onTealPrimary : colors.textMuted}
              tabular
            >
              {`بانتظار المراجعة (${pendingCount})`}
            </Txt>
          </Pressable>

          <View style={{ gap: 12 }}>
            {shown.map((b) => (
              <BookmarkRow key={b.id} b={b} />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
