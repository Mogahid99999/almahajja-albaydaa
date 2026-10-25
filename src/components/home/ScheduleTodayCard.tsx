/**
 * «دروس اليوم» on Home (0158) — today's lessons from the weekly schedule, by
 * Mecca time; «مباشر الآن» on the lesson whose section is live, «بعد ساعتين» on
 * the next. When today has nothing left it shows the next lesson instead, and
 * it hides itself when the schedule is empty.
 *
 * No extra load: the schedule is ONE persisted read (useSchedule), refetched
 * only when app_open reports a new schedule_version — the card never polls.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter, type Href } from 'expo-router';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Schedule } from '@/api/schedule';
import { SCHEDULE_COPY, useMinuteClock } from '@/components/schedule/ScheduleParts';
import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useSchedule, useScheduleReminderSync } from '@/hooks/useSchedule';
import {
  arClock,
  arDayTitle,
  arRelative,
  isHeld,
  meccaToday,
  nextOccurrence,
  occurrencesOn,
  startMs,
  type Occurrence,
} from '@/lib/schedule';

export const SCHEDULE_HREF = '/(student)/schedule' as Href;

/** What the card shows at `nowMs`: today's lessons still ahead (changes too), else the next one. */
export function homeScheduleRows(
  s: Schedule,
  nowMs: number,
): { title: string; rows: Occurrence[] } | null {
  if (s.items.length === 0) return null;
  const today = meccaToday(nowMs).date;
  // A cancelled / postponed one stays until its own slot would have ended.
  const rows = occurrencesOn(s, today).filter(
    (o) => startMs(o.date, o.time) + (o.item.durationMin ?? 60) * 60_000 > nowMs,
  );
  if (rows.some(isHeld)) return { title: SCHEDULE_COPY.today, rows };
  const next = nextOccurrence(s, nowMs);
  if (!next) return rows.length > 0 ? { title: SCHEDULE_COPY.today, rows } : null;
  return {
    title: `الدرس القادم · ${arDayTitle(next.date, today)}`,
    rows: [...rows, next],
  };
}

function Row({
  o,
  nowMs,
  live,
  first,
}: {
  o: Occurrence;
  nowMs: number;
  live: boolean;
  first: boolean;
}) {
  const held = isHeld(o);
  const clock = arClock(o.time);
  const relative =
    held && !live ? arRelative(startMs(o.date, o.time), o.item.durationMin, nowMs) : null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderColor: colors.borderSand,
        opacity: held ? 1 : 0.65,
      }}
    >
      <View style={{ width: 52, alignItems: 'center' }}>
        <Txt
          size={16}
          weight="bold"
          color={colors.primaryTeal}
          tabular
          style={held ? undefined : { textDecorationLine: 'line-through' }}
        >
          {clock.time}
        </Txt>
        <Txt size={11} color={colors.textFaint}>
          {clock.period}
        </Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={14} weight="semibold" numberOfLines={1}>
          {o.item.title}
        </Txt>
        <Txt size={12} color={held ? colors.textMuted : colors.stateDanger} numberOfLines={1}>
          {held
            ? (o.item.sheikhName ?? o.item.subtitle ?? '')
            : o.status === 'cancelled'
              ? 'لا درس اليوم'
              : 'أُجّل'}
        </Txt>
      </View>
      {live ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            backgroundColor: '#f6e3dd',
            borderRadius: radius.pill,
            paddingHorizontal: 9,
            paddingVertical: 3,
          }}
        >
          <View
            style={{
              width: 6,
              height: 6,
              backgroundColor: colors.stateDanger,
              transform: [{ rotate: '45deg' }],
            }}
          />
          <Txt size={11.5} weight="semibold" color="#8f3f30">
            {SCHEDULE_COPY.live}
          </Txt>
        </View>
      ) : relative ? (
        <View
          style={{
            backgroundColor: '#f1e6cf',
            borderRadius: radius.pill,
            paddingHorizontal: 9,
            paddingVertical: 3,
          }}
        >
          <Txt size={11.5} weight="semibold" color="#7a5a2c">
            {relative}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

export function ScheduleTodayCard({
  liveSectionId,
  containerStyle,
}: {
  liveSectionId?: string | null;
  /** Spacing around the card — applied only when it shows, so a hidden card leaves no gap. */
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  const { data } = useSchedule();
  useScheduleReminderSync(data);
  const now = useMinuteClock();
  if (!data) return null;
  const view = homeScheduleRows(data, now);
  if (!view) return null;
  const today = meccaToday(now).date;
  return (
    <View style={containerStyle}>
      <Pressable
        onPress={() => router.push(SCHEDULE_HREF)}
        accessibilityRole="button"
        accessibilityLabel={`${view.title} — ${SCHEDULE_COPY.full}`}
        style={({ pressed }) => ({
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor: colors.borderSand,
          borderRadius: 18,
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 12,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <Feather name="calendar" size={16} color={colors.accentBrassMuted} />
          <Txt size={15} weight="bold" color={colors.primaryTeal} style={{ flex: 1 }}>
            {view.title}
          </Txt>
          <Txt size={11.5} color={colors.textFaint}>
            بتوقيت مكة المكرمة
          </Txt>
        </View>
        {view.rows.map((o, i) => (
          <Row
            key={o.key}
            o={o}
            nowMs={now}
            first={i === 0}
            live={
              !!liveSectionId && o.date === today && isHeld(o) && o.item.sectionId === liveSectionId
            }
          />
        ))}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 6,
            alignSelf: 'flex-start',
          }}
        >
          <Txt size={13} weight="semibold" color={colors.primaryTeal600}>
            {SCHEDULE_COPY.full}
          </Txt>
          <Feather name="chevron-left" size={15} color={colors.primaryTeal600} />
        </View>
      </Pressable>
    </View>
  );
}
