/**
 * Home card for an active تذكير نافع broadcast (V7). Server-windowed: only
 * broadcasts with show_on_home published within the last day are returned, so
 * the card auto-disappears after 24h. A small × dismisses it locally (the
 * dismissed ids persist in AsyncStorage). Calm brass-accented styling; tapping
 * opens the reminder detail page.
 */
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { colors } from '@/constants/theme';
import { useHomeBroadcasts } from '@/hooks/useBroadcasts';
import { Card } from '@/components/ui/Card';
import { Rhombus } from '@/components/ui/Rhombus';
import { Txt } from '@/components/ui/Txt';

const DISMISSED_KEY = 'riwaq-dismissed-broadcasts';

export function BroadcastCard() {
  const router = useRouter();
  const { data } = useHomeBroadcasts();
  const [dismissed, setDismissed] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(DISMISSED_KEY)
      .then((raw) => {
        if (!cancelled) setDismissed(raw ? (JSON.parse(raw) as string[]) : []);
      })
      .catch(() => {
        if (!cancelled) setDismissed([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data?.length || dismissed === null) return null;
  const active = data.filter((b) => !dismissed.includes(b.id));
  if (!active.length) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    void AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(next)).catch(() => {});
  };

  return (
    <>
      {active.map((b) => (
        <Pressable
          key={b.id}
          onPress={() =>
            router.push(`/(student)/reminder/${b.id}` as Parameters<typeof router.push>[0])
          }
          accessibilityRole="button"
          accessibilityLabel={`تذكير نافع: ${b.title}`}
        >
          <Card
            style={{
              marginBottom: 14,
              borderWidth: 1,
              borderColor: 'rgba(201,164,99,0.45)',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              {/* Rhombus-framed star (RTL: rightmost) */}
              <View
                style={{
                  width: 42,
                  height: 42,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Rhombus size={38} color="rgba(201,164,99,0.16)" />
                <View style={{ position: 'absolute' }}>
                  <Feather name="star" size={17} color={colors.accentBrass} />
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <Txt size={11.5} weight="semibold" color={colors.accentBrass}>
                  تذكير نافع
                </Txt>
                <Txt
                  weight="display"
                  size={15.5}
                  color={colors.primaryTeal}
                  numberOfLines={1}
                  style={{ marginTop: 2 }}
                >
                  {b.title}
                </Txt>
                <Txt size={12.5} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
                  {b.body}
                </Txt>
              </View>

              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  dismiss(b.id);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="إخفاء التذكير"
                style={{
                  width: 30,
                  height: 30,
                  alignItems: 'center',
                  justifyContent: 'center',
                  alignSelf: 'flex-start',
                  marginTop: -4,
                }}
              >
                <Feather name="x" size={15} color={colors.textGhost} />
              </Pressable>
            </View>
          </Card>
        </Pressable>
      ))}
    </>
  );
}
