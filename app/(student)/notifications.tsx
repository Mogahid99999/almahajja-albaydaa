/**
 * الإشعارات — the in-app notifications inbox (Phase 2 · feature B).
 *
 * Calm list: each row shows a rhombus-framed type icon, title, body, and a
 * relative time. Unread rows carry a SINGLE quiet brass dot — no counts, no loud
 * badges (CLAUDE.md calm tone). Tapping a row marks it read and deep-links to its
 * target (lecture → player, section → section page). "تعليم الكل كمقروء" clears
 * all unread.
 *
 * Route: /(student)/notifications  (opened from the Home header bell)
 */
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { memo, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NotificationItem } from '@/api/types';
import { colors } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from '@/hooks/useNotifications';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { cardRowStyle } from '@/components/ui/cardRowStyle';
import { Divider } from '@/components/ui/Divider';
import { IconButton } from '@/components/ui/IconButton';
import { Rhombus } from '@/components/ui/Rhombus';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { notificationTypeIcon } from '@/components/notifications/labels';

/** Calm relative time: "الآن" / "منذ ٣ ساعات" / "منذ ٢ يوم". */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${arNum(mins)} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${arNum(hours)} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${arNum(days)} يوم`;
}

const NotificationRow = memo(function NotificationRow({
  item,
  onPress,
}: {
  item: NotificationItem;
  onPress: () => void;
}) {
  // التذكيرات النافعة read apart from activity rows: brass icon + a quiet tag.
  const isBeneficial = item.type === 'beneficial_reminder';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        opacity: pressed ? 0.7 : 1,
        backgroundColor: item.read ? 'transparent' : colors.bgSandRaised,
      })}
    >
      {/* Type icon */}
      <View style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
        <Feather
          name={notificationTypeIcon[item.type]}
          size={16}
          color={isBeneficial ? colors.accentBrass : colors.primaryTeal}
        />
      </View>

      <View style={{ flex: 1 }}>
        {isBeneficial ? (
          <Txt size={10.5} weight="semibold" color={colors.accentBrass}>
            تذكير نافع
          </Txt>
        ) : null}
        <Txt size={14} weight="semibold" color={colors.textInk} numberOfLines={1}>
          {item.title}
        </Txt>
        <Txt size={12.5} color={colors.textMuted} numberOfLines={2} style={{ marginTop: 2 }}>
          {item.body}
        </Txt>
        <Txt size={11} color={colors.textGhost} style={{ marginTop: 4 }}>
          {relativeTime(item.createdAt)}
        </Txt>
      </View>

      {/* Single quiet brass unread dot — no count */}
      {!item.read ? (
        <View
          style={{
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: colors.accentBrass,
          }}
        />
      ) : null}
    </Pressable>
  );
});

export default function NotificationsScreen() {
  const router = useRouter();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = useNotifications();
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const insets = useSafeAreaInsets();
  const miniPad = useMiniPlayerPad();
  const { refreshing, onRefresh } = usePullToRefresh([refetch]);

  const onOpen = useCallback(
    (item: NotificationItem) => {
      if (!item.read) markRead.mutate(item.id);
      if (item.data.lectureId) {
        const t =
          typeof item.data.positionSec === 'number' && item.data.positionSec > 0
            ? `?t=${Math.round(item.data.positionSec)}`
            : '';
        router.push(`/player/${item.data.lectureId}${t}`);
      } else if (item.data.sectionId) {
        router.push(`/(student)/section/${item.data.sectionId}`);
      } else if (item.data.route) {
        router.push(item.data.route as Parameters<typeof router.push>[0]);
      }
    },
    [markRead, router],
  );

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const renderItem = useCallback(
    ({ item, index }: { item: NotificationItem; index: number }) => (
      <View style={cardRowStyle(index === 0, index === items.length - 1)}>
        <NotificationRow item={item} onPress={() => onOpen(item)} />
      </View>
    ),
    [items.length, onOpen],
  );

  const header = (
    <>
      {/* ── Nav row ───────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 22,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          الإشعارات
        </Txt>
        <IconButton
          icon="chevron-right"
          onPress={() => router.back()}
          accessibilityLabel="رجوع"
        />
      </View>

      {/* ── تعليم الكل كمقروء ──────────────────────────────────────────────── */}
      {unread > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تعليم الكل كمقروء"
          onPress={() => markAllRead.mutate()}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            marginBottom: 14,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Txt size={13} weight="medium" color={colors.primaryTeal600}>
            تعليم الكل كمقروء
          </Txt>
        </Pressable>
      ) : null}
    </>
  );

  if (isLoading) {
    return (
      <Screen scroll={false} bottomPad={118 + BOTTOM_NAV_CLEARANCE} padded>
        {header}
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} bottomPad={0} padded>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: miniPad + insets.bottom + 24 + BOTTOM_NAV_CLEARANCE }}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Divider}
        initialNumToRender={10}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ paddingVertical: 72, alignItems: 'center', gap: 8 }}>
            <Rhombus size={40} color={colors.borderSand2} />
            <Txt size={14} weight="semibold" color={colors.textMuted} align="center" style={{ marginTop: 8 }}>
              لا توجد إشعارات
            </Txt>
            <Txt size={12} color={colors.textGhost} align="center">
              تابع أقسامك ليصلك جديدها
            </Txt>
          </View>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primaryTeal} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}
