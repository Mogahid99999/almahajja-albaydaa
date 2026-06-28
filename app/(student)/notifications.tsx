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
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { NotificationItem } from '@/api/types';
import { colors } from '@/constants/theme';
import { arNum } from '@/lib/format';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from '@/hooks/useNotifications';

import { Card } from '@/components/ui/Card';
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

function NotificationRow({
  item,
  onPress,
}: {
  item: NotificationItem;
  onPress: () => void;
}) {
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
      {/* Rhombus-framed type icon */}
      <View style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
        <Rhombus size={34} color="rgba(31,74,66,0.08)" />
        <View style={{ position: 'absolute' }}>
          <Feather name={notificationTypeIcon[item.type]} size={16} color={colors.primaryTeal} />
        </View>
      </View>

      <View style={{ flex: 1 }}>
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
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { data, isLoading } = useNotifications();
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const onOpen = (item: NotificationItem) => {
    if (!item.read) markRead.mutate(item.id);
    if (item.data.lectureId) {
      router.push(`/player/${item.data.lectureId}`);
    } else if (item.data.sectionId) {
      router.push(`/(student)/section/${item.data.sectionId}`);
    }
  };

  const items = data ?? [];

  return (
    <Screen bottomPad={118} padded>
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
          الإشعارات
        </Txt>
        <IconButton
          icon="chevron-right"
          onPress={() => router.back()}
          accessibilityLabel="رجوع"
        />
      </View>

      {/* ── تعليم الكل كمقروء ────────────────────────────────────────────────── */}
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

      {isLoading ? (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ paddingVertical: 72, alignItems: 'center', gap: 8 }}>
          <Rhombus size={40} color={colors.borderSand2} />
          <Txt size={14} weight="semibold" color={colors.textMuted} align="center" style={{ marginTop: 8 }}>
            لا توجد إشعارات
          </Txt>
          <Txt size={12} color={colors.textGhost} align="center">
            تابع أقسامك ليصلك جديدها
          </Txt>
        </View>
      ) : (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider /> : null}
              <NotificationRow item={item} onPress={() => onOpen(item)} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
