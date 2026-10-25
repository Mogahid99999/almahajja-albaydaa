/**
 * «الجدول الأسبوعي» (0158) — the weekly lessons, by Mecca time.
 *   حسب اليوم: a rolling week from today (اليوم · غداً · …), that day's lessons
 *              with their single-date changes (أُلغي / أُجّل / تغيّر الموعد).
 *   حسب الشيخ: each sheikh's lessons, one row per lesson.
 * A row opens the lesson sheet: «ذكّرني» (local notification), its section,
 * the live when it is on air. Moderators edit it in /admin/schedule (staff never
 * land in the student app — AuthGate steers them to /admin · /sheikh).
 *
 * Load: ONE persisted get_schedule read (useSchedule) — app_open refetches it
 * only when the server's schedule_version moves; pull-to-refresh refetches it.
 */
import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import type { ScheduleItem } from '@/api/schedule';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { LessonSheet, OccurrenceRow, SCHEDULE_COPY, useMinuteClock } from '@/components/schedule/ScheduleParts';
import { Screen, ScreenHeader, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useLiveNow } from '@/hooks/useLive';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useSchedule, useScheduleReminderSync } from '@/hooks/useSchedule';
import { toArabicDigits } from '@/lib/format';
import {
  addDays,
  arClockLine,
  arDayTitle,
  DAY_SHORT,
  dowOf,
  groupBySheikh,
  isHeld,
  meccaToday,
  nextOccurrence,
  occurrencesOn,
  type Occurrence,
} from '@/lib/schedule';

type Mode = 'day' | 'sheikh';

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opt = (m: Mode, label: string) => {
    const on = mode === m;
    return (
      <Pressable
        key={m}
        onPress={() => onChange(m)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        style={{
          flex: 1,
          height: 38,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: on ? colors.primaryTeal : 'transparent',
        }}
      >
        <Txt size={13.5} weight="semibold" color={on ? colors.onTealPrimary : colors.textSlate}>
          {label}
        </Txt>
      </Pressable>
    );
  };
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: colors.surfaceInset, borderRadius: radius.pill, padding: 4 }}
    >
      {opt('day', SCHEDULE_COPY.byDay)}
      {opt('sheikh', SCHEDULE_COPY.bySheikh)}
    </View>
  );
}

function DayStrip({ today, selected, onSelect }: { today: string; selected: string; onSelect: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {days.map((d, i) => {
        const on = d === selected;
        const label = i === 0 ? 'اليوم' : i === 1 ? 'غداً' : DAY_SHORT[dowOf(d)];
        return (
          <Pressable
            key={d}
            onPress={() => onSelect(d)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={arDayTitle(d, today)}
            style={{
              minWidth: 58,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 14,
              alignItems: 'center',
              backgroundColor: on ? colors.primaryTeal : colors.surfaceWhite,
              borderWidth: 1,
              borderColor: on ? colors.primaryTeal : colors.borderSand,
            }}
          >
            <Txt size={12.5} weight="semibold" color={on ? colors.onTealPrimary : colors.textSlate}>
              {label}
            </Txt>
            <Txt size={15} weight="bold" tabular color={on ? colors.onTealPrimary : colors.primaryTeal}>
              {toArabicDigits(Number(d.slice(8)))}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function NextBanner({ o, today }: { o: Occurrence; today: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.surfaceCard,
        borderWidth: 1,
        borderColor: colors.borderSand,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <Feather name="clock" size={17} color={colors.accentBrassMuted} />
      <View style={{ flex: 1 }}>
        <Txt size={12.5} color={colors.textFaint}>
          {`${SCHEDULE_COPY.next}: ${arDayTitle(o.date, today)} ${arClockLine(o.time)}`}
        </Txt>
        <Txt size={14.5} weight="semibold" numberOfLines={1}>
          {o.item.title}
        </Txt>
      </View>
    </View>
  );
}

function SheikhView({ items, onOpen }: { items: ScheduleItem[]; onOpen: (item: ScheduleItem) => void }) {
  const groups = useMemo(() => groupBySheikh(items), [items]);
  return (
    <View style={{ gap: 12 }}>
      {groups.map((g) => (
        <View
          key={g.sheikh}
          style={{ backgroundColor: colors.surfaceWhite, borderWidth: 1, borderColor: colors.borderSand, borderRadius: 16, overflow: 'hidden' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.surfaceCard }}>
            <Feather name="mic" size={15} color={colors.accentBrassMuted} />
            <Txt size={14.5} weight="bold" color={colors.primaryTeal}>
              {g.sheikh}
            </Txt>
          </View>
          {g.lessons.map((l) => (
            <Pressable
              key={l.title}
              onPress={() => onOpen(l.items[0])}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderTopWidth: 1,
                borderColor: colors.borderSand,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size={14} weight="semibold">
                  {l.title}
                </Txt>
                <Txt size={12.5} color={colors.textMuted}>
                  {l.when}
                </Txt>
              </View>
              {l.time ? (
                <Txt size={13} weight="semibold" color={colors.primaryTeal600}>
                  {arClockLine(l.time)}
                </Txt>
              ) : l.countLabel ? (
                <View style={{ backgroundColor: '#f1e6cf', borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 }}>
                  <Txt size={11.5} weight="semibold" color="#7a5a2c">
                    {l.countLabel}
                  </Txt>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

export default function ScheduleScreen() {
  const miniPad = useMiniPlayerPad();
  const { data, isLoading, isError, refetch } = useSchedule();
  useScheduleReminderSync(data);
  const { data: liveNow } = useLiveNow();
  const now = useMinuteClock();
  const today = meccaToday(now).date;
  const [mode, setMode] = useState<Mode>('day');
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState<{ item: ScheduleItem; occurrence: Occurrence | null } | null>(null);
  const { refreshing, onRefresh } = usePullToRefresh([() => refetch()]);

  // Past midnight in Mecca while the screen is open: keep the strip honest.
  const selected = day < today ? today : day;
  const live = liveNow?.live ?? null;
  const liveSectionId = live?.sectionId ?? null;
  const rows = data ? occurrencesOn(data, selected) : [];
  const next = data ? nextOccurrence(data, now) : null;
  const liveFor = (item: ScheduleItem) => (live && item.sectionId && item.sectionId === liveSectionId ? live.id : null);

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded refreshing={refreshing} onRefresh={onRefresh}>
      <ScreenHeader title={SCHEDULE_COPY.title} />
      <Txt size={12.5} color={colors.textFaint} style={{ marginTop: 2, marginBottom: 14 }}>
        {SCHEDULE_COPY.meccaTime}
      </Txt>

      {!data && isLoading ? (
        <ActivityIndicator color={colors.primaryTeal} style={{ marginTop: 40 }} />
      ) : !data && isError ? (
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 40 }}>
          <Txt size={14} color={colors.textMuted}>
            {SCHEDULE_COPY.failed}
          </Txt>
          <Pressable onPress={() => void refetch()} accessibilityRole="button" style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            <Txt size={13.5} weight="semibold" color={colors.primaryTeal600}>
              {SCHEDULE_COPY.retry}
            </Txt>
          </Pressable>
        </View>
      ) : !data || data.items.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingTop: 48, paddingHorizontal: 12 }}>
          <Feather name="calendar" size={30} color={colors.accentBrassMuted} />
          <Txt size={15} weight="semibold" color={colors.primaryTeal}>
            {SCHEDULE_COPY.empty}
          </Txt>
          <Txt size={13} color={colors.textFaint} style={{ textAlign: 'center' }}>
            {SCHEDULE_COPY.emptySub}
          </Txt>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <ModeToggle mode={mode} onChange={setMode} />
          {next ? <NextBanner o={next} today={today} /> : null}
          {mode === 'day' ? (
            <>
              <DayStrip today={today} selected={selected} onSelect={setDay} />
              <Txt size={15} weight="bold" color={colors.primaryTeal} style={{ marginTop: 4 }}>
                {arDayTitle(selected, today)}
              </Txt>
              {rows.length === 0 ? (
                <Txt size={13.5} color={colors.textFaint} style={{ paddingVertical: 18, textAlign: 'center' }}>
                  {SCHEDULE_COPY.emptyDay}
                </Txt>
              ) : (
                rows.map((o) => (
                  <OccurrenceRow
                    key={o.key}
                    o={o}
                    nowMs={now}
                    live={selected === today && isHeld(o) && !!liveFor(o.item)}
                    onPress={() => setOpen({ item: o.item, occurrence: o })}
                  />
                ))
              )}
            </>
          ) : (
            <SheikhView items={data.items} onOpen={(item) => setOpen({ item, occurrence: null })} />
          )}
        </View>
      )}

      <LessonSheet
        item={open?.item ?? null}
        occurrence={open?.occurrence ?? null}
        liveSessionId={open ? liveFor(open.item) : null}
        onClose={() => setOpen(null)}
      />
    </Screen>
  );
}
