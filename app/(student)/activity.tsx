/**
 * «سجل النشاط» — the monthly activity calendar (V20 · §7).
 *
 * A colour-coded month grid (dark green = full study day · light green = light ·
 * gold = a day with a completion/quiz · empty = none), month navigation, a
 * summary (current/longest streak, total active days, days this month), and a
 * calm day-detail sheet. A gap is shown as an empty cell — never a reproach.
 *
 * Route: /(student)/activity  (opened from the streak ring on رحلتي العلمية).
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';

import type { ActivityDay, ActivityLevel } from '@/api/activity';
import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import {
  WEEKDAY_HEADERS_AR,
  monthCells,
  monthLabel,
  shiftMonth,
} from '@/lib/monthGrid';
import { useCurrentUser } from '@/hooks/useAuth';
import { useActivityCalendar } from '@/hooks/useActivity';
import { useJourneySummary } from '@/hooks/useJourney';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { JourneyGate } from '@/components/journey/JourneyGate';

/** Cell fill per activity level — reuses the streak-ring palette family. */
const levelFill: Record<ActivityLevel, string> = {
  none: colors.surfaceInset,
  light: colors.primaryTeal600,
  full: colors.primaryTeal,
  gold: colors.accentBrass,
};

const AR_WEEKDAY_FULL = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function longDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${AR_WEEKDAY_FULL[d.getDay()]} ${arNum(d.getDate())} ${AR_MONTHS[d.getMonth()]}`;
}

export default function ActivityScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: summary } = useJourneySummary({ enabled: !isGuest });
  const miniPad = useMiniPlayerPad();
  const insets = useSafeAreaInsets();

  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m0: now.getMonth() });
  const anchor = `${cursor.y}-${String(cursor.m0 + 1).padStart(2, '0')}-01`;
  const { data: days } = useActivityCalendar(anchor, { enabled: !isGuest });

  const byDay = useMemo(() => {
    const m = new Map<string, ActivityDay>();
    for (const d of days ?? []) m.set(d.day, d);
    return m;
  }, [days]);

  const cells = useMemo(() => monthCells(cursor.y, cursor.m0), [cursor]);
  const activeThisMonth = (days ?? []).filter((d) => d.level !== 'none').length;

  const [selected, setSelected] = useState<ActivityDay | null>(null);

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          سجل النشاط
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      {isGuest ? (
        <JourneyGate />
      ) : (
        <>
          {/* Summary */}
          {summary ? (
            <Card style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 }}>
              <Stat value={summary.streak.current} label="المداومة الحالية" />
              <Stat value={summary.streak.longest} label="أطول مداومة" />
              <Stat value={summary.activeDays} label="أيام النشاط" />
            </Card>
          ) : null}

          {/* Month nav */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <IconButton
              icon="chevron-right"
              onPress={() => setCursor((c) => shiftMonth(c.y, c.m0, -1))}
              accessibilityLabel="الشهر السابق"
            />
            <Txt size={15} weight="semibold" color={colors.textInk}>
              {monthLabel(cursor.y, cursor.m0)}
            </Txt>
            <IconButton
              icon="chevron-left"
              onPress={() => setCursor((c) => shiftMonth(c.y, c.m0, 1))}
              accessibilityLabel="الشهر التالي"
              // Don't navigate into the future.
              disabled={cursor.y > now.getFullYear() || (cursor.y === now.getFullYear() && cursor.m0 >= now.getMonth())}
            />
          </View>

          {/* Weekday headers */}
          <View style={{ flexDirection: 'row-reverse', marginBottom: 6 }}>
            {WEEKDAY_HEADERS_AR.map((h) => (
              <View key={h} style={{ flex: 1, alignItems: 'center' }}>
                <Txt size={10} color={colors.textFaint}>
                  {h.slice(0, 3)}
                </Txt>
              </View>
            ))}
          </View>

          {/* Grid — RTL rows (Saturday first on the right) */}
          <View style={{ gap: 6 }}>
            {chunk(cells, 7).map((week, wi) => (
              <View key={wi} style={{ flexDirection: 'row-reverse', gap: 6 }}>
                {week.map((iso, di) => {
                  if (!iso) return <View key={di} style={{ flex: 1, aspectRatio: 1 }} />;
                  const rec = byDay.get(iso);
                  const level = rec?.level ?? 'none';
                  const dayNum = Number(iso.slice(8, 10));
                  return (
                    <Pressable
                      key={di}
                      onPress={() => rec && rec.level !== 'none' && setSelected(rec)}
                      style={{
                        flex: 1,
                        aspectRatio: 1,
                        borderRadius: radius.sm,
                        backgroundColor: levelFill[level],
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: level === 'none' ? 1 : 0,
                        borderColor: colors.borderSand,
                      }}
                    >
                      <Txt
                        size={11}
                        color={level === 'none' ? colors.textFaint : colors.onTealPrimary}
                        tabular
                      >
                        {arNum(dayNum)}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          <Txt size={12} color={colors.textMuted} align="center" style={{ marginTop: 14 }} tabular>
            {`${arNum(activeThisMonth)} يوم نشاط في ${monthLabel(cursor.y, cursor.m0)}`}
          </Txt>
        </>
      )}

      {/* Day detail sheet */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable
          onPress={() => setSelected(null)}
          style={{ flex: 1, backgroundColor: 'rgba(22,53,47,0.35)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.bgSandRaised,
              borderTopLeftRadius: radius.artwork,
              borderTopRightRadius: radius.artwork,
              paddingHorizontal: 22,
              paddingTop: 18,
              // Clear the system nav bar (gesture pill / 3-button) so the last
              // detail line isn't hidden behind it.
              paddingBottom: 24 + insets.bottom,
              gap: 10,
            }}
          >
            <View style={{ alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderSand2 }} />
            {selected ? (
              <>
                <Txt weight="display" size={17} color={colors.primaryTeal} align="center">
                  {longDate(selected.day)}
                </Txt>
                {selected.secondsListened > 0 ? (
                  <DetailLine text={`استمعت ${arNum(Math.round(selected.secondsListened / 60))} دقيقة`} />
                ) : null}
                {selected.lessonsCompleted > 0 ? (
                  <DetailLine text={`أكملت ${arNum(selected.lessonsCompleted)} ${selected.lessonsCompleted === 1 ? 'درساً' : 'دروس'}`} />
                ) : null}
                {selected.quizzesPassed > 0 ? (
                  <DetailLine text={`اجتزت ${arNum(selected.quizzesPassed)} ${selected.quizzesPassed === 1 ? 'اختباراً' : 'اختبارات'}`} />
                ) : null}
                {selected.benefitsWritten > 0 ? (
                  <DetailLine text={`كتبت ${arNum(selected.benefitsWritten)} ${selected.benefitsWritten === 1 ? 'فائدة' : 'فوائد'}`} />
                ) : null}
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Txt weight="display" size={20} color={colors.primaryTeal} tabular>
        {arNum(value)}
      </Txt>
      <Txt size={11} color={colors.textMuted} style={{ marginTop: 2 }}>
        {label}
      </Txt>
    </View>
  );
}

function DetailLine({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
      <Feather name="check" size={14} color={colors.stateSuccess} />
      <Txt size={13.5} color={colors.textInk} tabular>
        {text}
      </Txt>
    </View>
  );
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
