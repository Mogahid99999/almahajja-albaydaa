/**
 * «الجدول الأسبوعي» (0158) — the pieces the Home card and the schedule screen
 * share: one lesson row and the lesson sheet («ذكّرني», its section, «مباشر الآن»).
 * Calm by design: muted teal / sand, one brass accent for «بعد…», no animation.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import type { ScheduleItem } from '@/api/schedule';
import { LiveSheet } from '@/components/live/sheets/LiveSheet';
import { liveRoomHref } from '@/components/live/liveUi';
import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { ensurePermission } from '@/lib/notifications';
import {
  arClock,
  arClockLine,
  arDaysLabel,
  arLocalLine,
  arRelative,
  arStatusLine,
  deviceOffsetMinutes,
  isHeld,
  startMs,
  type Occurrence,
} from '@/lib/schedule';
import { useScheduleRemindersStore } from '@/stores/scheduleRemindersStore';

export const SCHEDULE_COPY = {
  title: 'الجدول الأسبوعي',
  meccaTime: 'جميع الأوقات بتوقيت مكة المكرمة',
  today: 'دروس اليوم',
  full: 'الجدول الأسبوعي كاملاً',
  live: 'مباشر الآن',
  remind: 'ذكّرني قبل الدرس',
  remindSub: 'قبله بربع ساعة، من هاتفك',
  openSection: 'دروس هذا الكتاب في التطبيق',
  openLive: 'افتح المجلس المباشر',
  byDay: 'حسب اليوم',
  bySheikh: 'حسب الشيخ',
  next: 'الدرس القادم',
  emptyDay: 'لا دروس في هذا اليوم',
  empty: 'لم يُنشر الجدول بعد',
  emptySub: 'حين تُضاف الدروس الأسبوعية تظهر هنا بمواعيدها.',
  failed: 'تعذّر تحميل الجدول',
  retry: 'إعادة المحاولة',
} as const;

/** Re-render once a minute while mounted — «بعد ٢٠ دقيقة» stays honest; no fetch. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const DANGER_BG = '#f6e3dd';
const DANGER_FG = '#8f3f30';

/** One lesson of one day. */
export function OccurrenceRow({
  o,
  nowMs,
  live,
  onPress,
}: {
  o: Occurrence;
  nowMs: number;
  /** A live session of this lesson's section is on air now. */
  live?: boolean;
  onPress?: () => void;
}) {
  const held = isHeld(o);
  const clock = arClock(o.time);
  const status = arStatusLine(o);
  const relative = held ? arRelative(startMs(o.date, o.time), o.item.durationMin, nowMs) : null;
  const local = held ? arLocalLine(o.date, o.time, deviceOffsetMinutes()) : null;
  const a11y = [o.item.title, o.item.sheikhName, `${clock.time} ${clock.period}`, status]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={a11y}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: 12,
        backgroundColor: colors.surfaceWhite,
        borderWidth: 1,
        borderColor: colors.borderSand,
        borderRadius: 14,
        padding: 12,
        opacity: pressed ? 0.85 : held ? 1 : 0.7,
      })}
    >
      <View
        style={{
          width: 62,
          alignItems: 'center',
          justifyContent: 'center',
          borderEndWidth: 1,
          borderColor: colors.borderSand,
          paddingEnd: 10,
        }}
      >
        <Txt
          size={18}
          weight="bold"
          color={colors.primaryTeal}
          tabular
          style={held ? undefined : { textDecorationLine: 'line-through' }}
        >
          {clock.time}
        </Txt>
        <Txt size={11.5} color={colors.textFaint}>
          {clock.period}
        </Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt size={14.5} weight="semibold" numberOfLines={2} style={{ flex: 1 }}>
            {o.item.title}
          </Txt>
          {live ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: DANGER_BG,
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
              <Txt size={11.5} weight="semibold" color={DANGER_FG}>
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
        {o.item.subtitle ? (
          <Txt size={12} color={colors.textMuted} numberOfLines={1}>
            {o.item.subtitle}
          </Txt>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 2,
          }}
        >
          {o.item.sheikhName ? (
            <Txt size={12.5} color={colors.textSlate}>
              {o.item.sheikhName}
            </Txt>
          ) : null}
          {o.item.subject ? (
            <View
              style={{
                backgroundColor: '#e4ece8',
                borderRadius: radius.pill,
                paddingHorizontal: 9,
                paddingVertical: 1,
              }}
            >
              <Txt size={11.5} color={colors.primaryTeal600}>
                {o.item.subject}
              </Txt>
            </View>
          ) : null}
        </View>
        {status ? (
          <View
            style={{
              alignSelf: 'flex-start',
              marginTop: 4,
              backgroundColor: held ? '#f1e6cf' : DANGER_BG,
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            <Txt size={12} weight="semibold" color={held ? '#7a5a2c' : DANGER_FG}>
              {status}
            </Txt>
          </View>
        ) : null}
        {local ? (
          <Txt size={11.5} color={colors.textFaint}>
            {local}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

/** «ذكّرني قبل الدرس» — device-local; asks the OS permission on the first switch-on. */
function ReminderRow({ itemId }: { itemId: string }) {
  const on = useScheduleRemindersStore((s) => s.ids.includes(itemId));
  const setReminder = useScheduleRemindersStore((s) => s.setReminder);
  const toggle = async (next: boolean) => {
    if (next) await ensurePermission().catch(() => undefined);
    setReminder(itemId, next);
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.surfaceWhite,
        borderWidth: 1,
        borderColor: colors.borderSand,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <Feather name="bell" size={18} color={colors.primaryTeal} />
      <View style={{ flex: 1 }}>
        <Txt size={14} weight="semibold">
          {SCHEDULE_COPY.remind}
        </Txt>
        <Txt size={12} color={colors.textFaint}>
          {SCHEDULE_COPY.remindSub}
        </Txt>
      </View>
      <Switch
        value={on}
        onValueChange={(v) => void toggle(v)}
        accessibilityLabel={SCHEDULE_COPY.remind}
        trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
        thumbColor={colors.surfaceWhite}
        ios_backgroundColor={colors.surfaceInset}
      />
    </View>
  );
}

function InfoLine({
  icon,
  label,
  value,
  sub,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <Feather name={icon} size={17} color={colors.accentBrassMuted} style={{ marginTop: 2 }} />
      <Txt size={12.5} color={colors.textFaint} style={{ width: 52, marginTop: 1 }}>
        {label}
      </Txt>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={14} weight="semibold">
          {value}
        </Txt>
        {sub ? (
          <Txt size={12} color={colors.textFaint}>
            {sub}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/** The lesson, opened from a row: when, who, «ذكّرني», its section, the live. */
export function LessonSheet({
  item,
  occurrence,
  liveSessionId,
  onClose,
}: {
  item: ScheduleItem | null;
  /** The date it was opened from (its status / note shown); null from «حسب الشيخ». */
  occurrence: Occurrence | null;
  /** A live session of its section is on air now. */
  liveSessionId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const status = occurrence ? arStatusLine(occurrence) : null;
  const time = occurrence?.time ?? item?.startTime ?? '00:00';
  const local = occurrence ? arLocalLine(occurrence.date, time, deviceOffsetMinutes()) : null;
  const duration = item?.durationMin
    ? item.durationMin === 60
      ? ' · نحو ساعة'
      : item.durationMin === 30
        ? ' · نحو نصف ساعة'
        : ''
    : '';
  return (
    <LiveSheet
      visible={!!item}
      onClose={onClose}
      title={item?.title ?? ''}
      sub={item?.subtitle ?? undefined}
    >
      {item ? (
        <View style={{ gap: 12 }}>
          {status ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: DANGER_BG,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <Feather name="alert-circle" size={16} color={DANGER_FG} />
              <Txt size={13} weight="semibold" color={DANGER_FG} style={{ flex: 1 }}>
                {status}
              </Txt>
            </View>
          ) : null}
          <View
            style={{
              backgroundColor: colors.surfaceWhite,
              borderWidth: 1,
              borderColor: colors.borderSand,
              borderRadius: 14,
            }}
          >
            {item.sheikhName ? <InfoLine icon="mic" label="الشيخ" value={item.sheikhName} /> : null}
            <InfoLine icon="calendar" label="الأيام" value={arDaysLabel(item.days)} />
            <InfoLine
              icon="clock"
              label="الوقت"
              value={`${arClockLine(time)} بتوقيت مكة${duration}`}
              sub={local}
            />
            {item.subject ? (
              <InfoLine icon="book-open" label="المادة" value={item.subject} />
            ) : null}
            {item.note ? <InfoLine icon="info" label="ملاحظة" value={item.note} /> : null}
          </View>
          <ReminderRow itemId={item.id} />
          {liveSessionId ? (
            <Pressable
              onPress={() => {
                onClose();
                router.push(liveRoomHref(liveSessionId));
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({
                height: 50,
                borderRadius: 14,
                backgroundColor: colors.stateDanger,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Txt size={14.5} weight="semibold" color={colors.surfaceWhite}>
                {SCHEDULE_COPY.openLive}
              </Txt>
            </Pressable>
          ) : null}
          {item.sectionId ? (
            <Pressable
              onPress={() => {
                onClose();
                router.push(`/(student)/section/${item.sectionId}` as Href);
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({
                height: 50,
                borderRadius: 14,
                backgroundColor: colors.primaryTeal,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Txt size={14.5} weight="semibold" color={colors.onTealPrimary}>
                {SCHEDULE_COPY.openSection}
              </Txt>
              <Feather name="chevron-left" size={17} color={colors.onTealPrimary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </LiveSheet>
  );
}
