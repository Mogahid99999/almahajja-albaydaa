/**
 * «المجلس المباشر القادم» / «مجالس مباشرة قادمة» — scheduled sessions on Home
 * (PLAN_LIVE_V23 §1.1 item 1, prototype `DD.upcoming`): a day/time tile, the
 * title, section · sheikh, and «ذكّرني» ⇄ «سنذكّرك».
 *
 * P5 (§9.4): «ذكّرني» sets a reminder through set_live_reminder (0142) — a push
 * about 15 minutes before and again when it starts. Tapping «سنذكّرك» cancels.
 * Optimistic: the row flips at once and flips back if the server refuses.
 * Registered users only (the server refuses guests), so guests see no button.
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { LiveSessionPublic } from '@/api/live';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useSetLiveReminder } from '@/hooks/useLive';
import { LIVE_P5_COPY, arClock, arDayLabel, rpcErrorText } from './liveUi';
import { useNow } from './LiveHomeCard';

export function LiveUpcomingCard({
  sessions,
  remindedIds,
  onRemind,
}: {
  sessions: readonly LiveSessionPublic[];
  remindedIds?: Iterable<string> | null;
  /** Override (tests / other hosts). Default: set_live_reminder via useSetLiveReminder. */
  onRemind?: (sessionId: string, on: boolean) => void;
}) {
  const now = useNow(60_000);
  const { data: user } = useCurrentUser();
  const setReminder = useSetLiveReminder();
  // Tapped states not yet confirmed by `remindedIds` (the get_live_now cache).
  const [pending, setPending] = useState<Readonly<Record<string, boolean>>>({});
  const [error, setError] = useState<string | null>(null);

  // A fresh server answer supersedes the local taps.
  useEffect(() => {
    setPending({});
  }, [remindedIds]);

  if (!sessions.length) return null;
  const reminded = new Set(remindedIds ?? []);
  const many = sessions.length > 1;
  const canRemind = !!user && !user.isGuest;

  const toggle = (sessionId: string, on: boolean) => {
    setError(null);
    setPending((p) => ({ ...p, [sessionId]: on }));
    if (onRemind) {
      onRemind(sessionId, on);
      return;
    }
    setReminder.mutate(
      { sessionId, on },
      {
        onError: (e: unknown) => {
          setPending((p) => {
            const next = { ...p };
            delete next[sessionId];
            return next;
          });
          setError(rpcErrorText(e, LIVE_P5_COPY.remindFailed));
        },
      },
    );
  };

  return (
    <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 6 }}>
        <Feather name="calendar" size={16} color={colors.accentBrassMuted} />
        <Txt size={13} weight="semibold" color={colors.textFaint}>
          {many ? 'مجالس مباشرة قادمة' : 'المجلس المباشر القادم'}
        </Txt>
      </View>
      {sessions.map((s) => {
        const on = pending[s.id] ?? reminded.has(s.id);
        const sub = [s.sectionTitle, s.sheikhName].filter(Boolean).join(' · ');
        return (
          <View key={s.id}>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
              <View
                style={{
                  width: 62,
                  borderRadius: 12,
                  backgroundColor: '#eef0e9',
                  paddingVertical: 7,
                  paddingHorizontal: 4,
                  alignItems: 'center',
                }}
              >
                <Txt size={11.5} weight="semibold" color={colors.primaryTeal} align="center">
                  {arDayLabel(s.scheduledAt, now)}
                </Txt>
                <Txt size={11} color={colors.textFaint} align="center" tabular>
                  {arClock(s.scheduledAt)}
                </Txt>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt weight="display" size={15.5} style={{ lineHeight: 22 }} numberOfLines={2}>
                  {s.title}
                </Txt>
                {sub ? (
                  <Txt size={12} color={colors.textFaint} numberOfLines={1}>
                    {sub}
                  </Txt>
                ) : null}
              </View>
              {canRemind ? (
                on ? (
                  <Pressable
                    onPress={() => toggle(s.id, false)}
                    accessibilityRole="button"
                    accessibilityLabel={LIVE_P5_COPY.remindCancelA11y}
                    accessibilityState={{ selected: true }}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      paddingVertical: 6,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Feather name="check" size={14} color={colors.primaryTeal} />
                    <Txt size={12.5} weight="medium" color={colors.primaryTeal}>
                      {LIVE_P5_COPY.reminded}
                    </Txt>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => toggle(s.id, true)}
                    accessibilityRole="button"
                    accessibilityLabel={LIVE_P5_COPY.remind}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      borderWidth: 1,
                      borderColor: colors.borderSand2,
                      borderRadius: radius.input,
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Feather name="bell" size={14} color={colors.textSlate} />
                    <Txt size={12.5} weight="medium" color={colors.textSlate}>
                      {LIVE_P5_COPY.remind}
                    </Txt>
                  </Pressable>
                )
              ) : null}
            </View>
          </View>
        );
      })}
      {error ? (
        <Txt
          size={12}
          color={colors.stateDanger}
          style={{ paddingBottom: 10, lineHeight: 19, alignSelf: 'stretch' }}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Txt>
      ) : null}
    </Card>
  );
}
