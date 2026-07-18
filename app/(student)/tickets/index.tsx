/**
 * تذاكري — the student's support tickets (item 10).
 *
 * Every ملاحظة a student submits becomes a trackable ticket: this lists them
 * with their status (مفتوحة / قيد المراجعة / بانتظار ردّك / مغلقة) and last
 * activity, newest first. Tapping one opens the thread. Registered + guest
 * sessions alike can have tickets (feedback allows anon), so no register gate.
 *
 * RTL throughout: right-aligned text, chevrons pointing the RTL way.
 *
 * Route: /(student)/tickets
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { TICKET_STATUS_META } from '@/constants/ticketStatus';
import { colors, radius, shadows } from '@/constants/theme';
import { useMyTickets } from '@/hooks/useFeedback';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useRefreshAll } from '@/hooks/useRefreshAll';
import { arSince } from '@/lib/format';

export default function TicketsScreen() {
  const router = useRouter();
  const miniPad = useMiniPlayerPad();
  const { data: tickets, isLoading, refetch } = useMyTickets();
  const refreshAll = useRefreshAll();
  const { refreshing, onRefresh } = usePullToRefresh([() => refetch(), refreshAll]);
  // «إنشاء تذكرة» reuses the same guided sheet as إرسال ملاحظة — submitting it
  // creates a ticket (0097 submit_feedback seeds the thread). Refetch on close
  // so a just-created ticket appears at the top without a manual pull.
  const [composing, setComposing] = useState(false);

  const list = tickets ?? [];

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded refreshing={refreshing} onRefresh={onRefresh}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 22,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          تذاكري
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      {/* Create a new ticket */}
      <Pressable
        onPress={() => setComposing(true)}
        accessibilityRole="button"
        accessibilityLabel="إنشاء تذكرة"
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingVertical: 13,
            borderRadius: radius.input,
            backgroundColor: colors.primaryTeal,
            marginBottom: 16,
            opacity: pressed ? 0.85 : 1,
          },
          shadows.button,
        ]}
      >
        <Feather name="plus" size={17} color={colors.onTealPrimary} />
        <Txt size={14} weight="semibold" color={colors.onTealPrimary}>
          إنشاء تذكرة جديدة
        </Txt>
      </Pressable>

      <FeedbackSheet
        visible={composing}
        onClose={() => {
          setComposing(false);
          void refetch();
        }}
      />

      {isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
      ) : list.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
          <Feather name="inbox" size={26} color={colors.accentBrassMuted} />
          <Txt size={14} color={colors.textSlate} align="center" style={{ lineHeight: 22 }}>
            لا توجد تذاكر بعد — أنشئ تذكرة جديدة وستتابعها هنا
          </Txt>
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          {list.map((t) => {
            const meta = TICKET_STATUS_META[t.status];
            return (
              <Pressable
                key={t.id}
                onPress={() =>
                  router.push(
                    `/(student)/tickets/${t.id}` as Parameters<typeof router.push>[0],
                  )
                }
                accessibilityRole="button"
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              >
                <Card>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[styles_badge, { backgroundColor: meta.bg }]}>
                          <Txt size={10.5} weight="semibold" color={meta.fg}>
                            {meta.label}
                          </Txt>
                        </View>
                        {t.adminReplied ? (
                          <Txt size={10.5} color={colors.stateSuccess}>
                            ثمّة ردّ
                          </Txt>
                        ) : null}
                      </View>
                      <Txt
                        size={14}
                        weight="medium"
                        color={colors.textInk}
                        numberOfLines={2}
                        align="right"
                        style={{ marginTop: 6, lineHeight: 21 }}
                      >
                        {t.message}
                      </Txt>
                      <Txt size={11.5} color={colors.textGhost} align="right" style={{ marginTop: 4 }}>
                        {arSince(t.lastActivity)}
                      </Txt>
                    </View>
                    {/* RTL: chevron points left (into the row) */}
                    <Feather name="chevron-left" size={18} color={colors.textGhost} />
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles_badge = {
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: radius.pill,
} as const;
