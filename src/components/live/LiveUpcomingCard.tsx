/**
 * «المجلس المباشر القادم» / «مجالس مباشرة قادمة» — scheduled sessions on Home
 * (PLAN_LIVE_V23 §1.1 item 1, prototype `DD.upcoming`): a day/time tile, the
 * title, section · sheikh, and the «ذكّرني» / «سنذكّرك» state.
 */
import Feather from '@expo/vector-icons/Feather';
import { Pressable, View } from 'react-native';

import type { LiveSessionPublic } from '@/api/live';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { arClock, arDayLabel } from './liveUi';
import { useNow } from './LiveHomeCard';

export function LiveUpcomingCard({
  sessions,
  remindedIds,
  onRemind,
}: {
  sessions: readonly LiveSessionPublic[];
  remindedIds?: Iterable<string> | null;
  /**
   * «ذكّرني». TODO(P5): wire to the reminders mutation (§9.4) — until then the
   * button is hidden and only an existing «سنذكّرك» state shows.
   */
  onRemind?: (sessionId: string) => void;
}) {
  const now = useNow(60_000);
  if (!sessions.length) return null;
  const reminded = new Set(remindedIds ?? []);
  const many = sessions.length > 1;

  return (
    <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 6 }}>
        <Feather name="calendar" size={16} color={colors.accentBrassMuted} />
        <Txt size={13} weight="semibold" color={colors.textFaint}>
          {many ? 'مجالس مباشرة قادمة' : 'المجلس المباشر القادم'}
        </Txt>
      </View>
      {sessions.map((s) => {
        const on = reminded.has(s.id);
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
              {on ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Feather name="check" size={14} color={colors.primaryTeal} />
                  <Txt size={12.5} weight="medium" color={colors.primaryTeal}>
                    سنذكّرك
                  </Txt>
                </View>
              ) : onRemind ? (
                <Pressable
                  onPress={() => onRemind(s.id)}
                  accessibilityRole="button"
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
                    ذكّرني
                  </Txt>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
}
