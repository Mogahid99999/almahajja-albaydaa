/**
 * «ابدأ مجلساً مباشراً» (PLAN_LIVE_V23 §7.3/§7.6) — staff who can host (admin /
 * publisher / sheikh), from a section page or the staff «البث المباشر» screen.
 * Title (prefilled with the section title, 3–200 chars) + «متى يبدأ المجلس؟»
 * + «إشعار للجميع عند البدء» + «استقبال طلبات التحدث» (both on).
 *
 *  - «الآن» (default) → create_live_session → `onCreated(id)`: the caller opens
 *    the green room, as before.
 *  - «في موعد لاحق» (owner 2026-09-29) → day chips + a 12-hour time in
 *    15-minute steps (no native picker), 10 minutes … 30 days ahead →
 *    create_live_session(p_scheduled_at) → `onScheduled(id, iso)`: NO green
 *    room; the caller closes the sheet and shows «جُدول المجلس: …». Students
 *    see it in «المجالس القادمة» with «ذكّرني».
 *
 * The RPC's own Arabic message shows on failure (e.g. another live running).
 */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';

import { Divider, Txt, cardRowStyle } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import { useCreateLiveSession } from '@/hooks/useLive';
import { arNum } from '@/lib/format';
import { useNow } from '../LiveHomeCard';
import {
  SCHEDULE_COPY,
  SCHEDULE_MINUTES,
  defaultScheduleChoice,
  scheduleDate,
  scheduleDays,
  scheduleProblem,
  scheduleProblemText,
  scheduleSummary,
  type ScheduleChoice,
} from '../liveSchedule';
import { LIVE_P4_COPY, isValidLiveTitle, rpcErrorText } from '../liveUi';
import { LiveSheet } from './LiveSheet';
import { SheetButton, SheetError } from './sheetParts';

type When = 'now' | 'later';

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export function CreateLiveSheet({
  visible,
  onClose,
  sectionId,
  initialTitle,
  onCreated,
  onScheduled,
}: {
  visible: boolean;
  onClose: () => void;
  sectionId: string;
  initialTitle: string;
  /** Started now → the caller opens the green room. */
  onCreated: (sessionId: string) => void;
  /** Scheduled → the caller closes the sheet and confirms (default: just close). */
  onScheduled?: (sessionId: string, scheduledAt: string) => void;
}) {
  const create = useCreateLiveSession();
  const now = useNow(30_000);
  const [title, setTitle] = useState(initialTitle);
  const [notify, setNotify] = useState(true);
  const [allowRequests, setAllowRequests] = useState(true);
  const [when, setWhen] = useState<When>('now');
  const [choice, setChoice] = useState<ScheduleChoice>(() => defaultScheduleChoice(Date.now()));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(initialTitle);
    setNotify(true);
    setAllowRequests(true);
    setWhen('now');
    setChoice(defaultScheduleChoice(Date.now()));
    setError(null);
  }, [visible, initialTitle]);

  const valid = isValidLiveTitle(title);
  const busy = create.isPending;
  const later = when === 'later';
  const at = later ? scheduleDate(choice, now) : null;
  const problem = at ? scheduleProblem(at.getTime(), now) : null;
  const pick = (patch: Partial<ScheduleChoice>) => {
    setError(null);
    setChoice((c) => ({ ...c, ...patch }));
  };

  const submit = () => {
    if (!valid || busy) return;
    setError(null);
    let scheduledAt: string | null = null;
    if (later) {
      // Re-checked against the clock at the tap (the chooser's clock ticks every 30 s).
      const t = Date.now();
      const d = scheduleDate(choice, t);
      const p = scheduleProblem(d.getTime(), t);
      if (p) {
        setError(scheduleProblemText(p));
        return;
      }
      scheduledAt = d.toISOString();
    }
    create.mutate(
      { sectionId, title: title.trim(), notify, allowRequests, ...(scheduledAt ? { scheduledAt } : {}) },
      {
        onSuccess: (id) => {
          if (!scheduledAt) onCreated(id);
          else if (onScheduled) onScheduled(id, scheduledAt);
          else onClose();
        },
        onError: (e) =>
          setError(
            rpcErrorText(e, later ? 'تعذّرت جدولة المجلس. حاول مرة أخرى' : 'تعذّر بدء المجلس. حاول مرة أخرى'),
          ),
      },
    );
  };

  return (
    <LiveSheet
      visible={visible}
      onClose={onClose}
      title={LIVE_P4_COPY.startLive}
      sub={
        later
          ? SCHEDULE_COPY.sub
          : 'يُسجَّل المجلس ويُحفظ في هذا القسم. تبدأ بغرفة التجهيز لتختبر الميكروفون قبل البث.'
      }
      maxHeightRatio={0.92}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flexShrink: 1 }}>
        <ScrollView
          style={{ flexGrow: 0 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Txt size={12.5} weight="semibold" color={colors.textSlate} style={{ marginBottom: 6 }}>
            عنوان المجلس
          </Txt>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="مثال: شرح كتاب التوحيد · الدرس الأول"
            placeholderTextColor={colors.textGhost}
            maxLength={200}
            textAlign="right"
            accessibilityLabel="عنوان المجلس"
            style={{
              backgroundColor: colors.surfaceWhite,
              borderWidth: 1.5,
              borderColor: valid || !title ? colors.borderSand2 : colors.accentBrassMuted,
              borderRadius: radius.input,
              paddingHorizontal: 14,
              paddingVertical: 11,
              fontFamily: fonts.body,
              fontSize: 15,
              color: colors.textInk,
              writingDirection: 'rtl',
            }}
          />
          {!valid ? (
            <Txt size={12} color={colors.textFaint} style={{ marginTop: 6 }}>
              العنوان من ٣ إلى ٢٠٠ حرف
            </Txt>
          ) : null}

          {/* «متى يبدأ المجلس؟» — الآن / في موعد لاحق */}
          <Txt size={12.5} weight="semibold" color={colors.textSlate} style={{ marginTop: 16, marginBottom: 6 }}>
            {SCHEDULE_COPY.question}
          </Txt>
          <View
            accessibilityRole="radiogroup"
            style={{
              flexDirection: 'row',
              backgroundColor: colors.surfaceInset,
              borderRadius: radius.input,
              padding: 3,
              gap: 3,
            }}
          >
            {(['now', 'later'] as const).map((w) => {
              const on = when === w;
              return (
                <Pressable
                  key={w}
                  onPress={() => {
                    setError(null);
                    if (w === 'later' && when !== 'later') setChoice(defaultScheduleChoice(Date.now()));
                    setWhen(w);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
                  style={{
                    flex: 1,
                    minHeight: 40,
                    borderRadius: radius.input - 3,
                    backgroundColor: on ? colors.surfaceWhite : 'transparent',
                    borderWidth: on ? 1 : 0,
                    borderColor: colors.borderSand,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Txt size={14} weight={on ? 'semibold' : 'medium'} color={on ? colors.primaryTeal : colors.textMuted}>
                    {w === 'now' ? SCHEDULE_COPY.now : SCHEDULE_COPY.later}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          {later ? (
            <ScheduleChooser choice={choice} nowMs={now} onPick={pick} />
          ) : null}
          {later && at ? (
            <Txt
              size={12.5}
              weight={problem ? 'regular' : 'semibold'}
              color={problem ? colors.accentBrassMuted : colors.primaryTeal}
              style={{ marginTop: 10, lineHeight: 20 }}
              accessibilityLiveRegion="polite"
            >
              {problem ? scheduleProblemText(problem) : `الموعد: ${scheduleSummary(at.toISOString(), now)}`}
            </Txt>
          ) : null}

          <View style={{ marginTop: 14 }}>
            <ToggleRow first label={LIVE_P4_COPY.notifyAll} value={notify} onChange={setNotify} />
            <View
              style={{
                backgroundColor: colors.surfaceCard,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderColor: colors.borderSand,
              }}
            >
              <Divider />
            </View>
            <ToggleRow last label={LIVE_P4_COPY.allowRequests} value={allowRequests} onChange={setAllowRequests} />
          </View>

          <SheetError text={error} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <SheetButton
              label={later ? SCHEDULE_COPY.submit : 'إلى غرفة التجهيز'}
              tone="primary"
              busy={busy}
              disabled={!valid || !!problem}
              onPress={submit}
            />
            <SheetButton label={LIVE_P4_COPY.cancel} onPress={onClose} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LiveSheet>
  );
}

/** Day chips + hour chips + minutes + ص/م. */
function ScheduleChooser({
  choice,
  nowMs,
  onPick,
}: {
  choice: ScheduleChoice;
  nowMs: number;
  onPick: (patch: Partial<ScheduleChoice>) => void;
}) {
  const days = scheduleDays(nowMs);
  return (
    <View style={{ marginTop: 12, gap: 12 }}>
      <View style={{ gap: 6 }}>
        <Txt size={12} color={colors.textFaint}>
          {SCHEDULE_COPY.day}
        </Txt>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
          keyboardShouldPersistTaps="handled"
        >
          {days.map((d) => (
            <Chip
              key={d.offset}
              selected={choice.dayOffset === d.offset}
              onPress={() => onPick({ dayOffset: d.offset })}
              label={`${d.label} ${d.date}`}
              minWidth={74}
            >
              <ChipText selected={choice.dayOffset === d.offset} size={13.5} weight="semibold">
                {d.label}
              </ChipText>
              <ChipText selected={choice.dayOffset === d.offset} size={11} faint>
                {d.date}
              </ChipText>
            </Chip>
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: 6 }}>
        <Txt size={12} color={colors.textFaint}>
          {SCHEDULE_COPY.hour}
        </Txt>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingVertical: 2 }}
          keyboardShouldPersistTaps="handled"
        >
          {HOURS_12.map((h) => (
            <Chip
              key={h}
              selected={choice.hour12 === h}
              onPress={() => onPick({ hour12: h })}
              label={`الساعة ${arNum(h)}`}
              minWidth={44}
            >
              <ChipText selected={choice.hour12 === h} size={14} weight="semibold" tabular>
                {arNum(h)}
              </ChipText>
            </Chip>
          ))}
        </ScrollView>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ gap: 6 }}>
          <Txt size={12} color={colors.textFaint}>
            {SCHEDULE_COPY.minute}
          </Txt>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {SCHEDULE_MINUTES.map((m) => (
              <Chip
                key={m}
                selected={choice.minute === m}
                onPress={() => onPick({ minute: m })}
                label={`الدقيقة ${arNum(m)}`}
                minWidth={44}
              >
                <ChipText selected={choice.minute === m} size={14} weight="semibold" tabular>
                  {m === 0 ? '٠٠' : arNum(m)}
                </ChipText>
              </Chip>
            ))}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(['am', 'pm'] as const).map((p) => (
            <Chip
              key={p}
              selected={choice.period === p}
              onPress={() => onPick({ period: p })}
              label={p === 'am' ? 'صباحاً' : 'مساءً'}
              minWidth={58}
            >
              <ChipText selected={choice.period === p} size={13.5} weight="semibold">
                {p === 'am' ? 'صباحاً' : 'مساءً'}
              </ChipText>
            </Chip>
          ))}
        </View>
      </View>
    </View>
  );
}

function Chip({
  selected,
  onPress,
  label,
  minWidth,
  children,
}: {
  selected: boolean;
  onPress: () => void;
  label: string;
  minWidth: number;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={4}
      style={({ pressed }) => ({
        minWidth,
        minHeight: 40,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: selected ? colors.primaryTeal : colors.borderSand2,
        backgroundColor: selected ? colors.primaryTeal : colors.surfaceWhite,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

function ChipText({
  selected,
  size,
  weight = 'medium',
  faint = false,
  tabular = false,
  children,
}: {
  selected: boolean;
  size: number;
  weight?: 'medium' | 'semibold';
  faint?: boolean;
  tabular?: boolean;
  children: React.ReactNode;
}) {
  const color = selected
    ? faint
      ? colors.onTealSecondary
      : colors.onTealPrimary
    : faint
      ? colors.textFaint
      : colors.textSlate;
  return (
    <Txt size={size} weight={weight} color={color} align="center" tabular={tabular}>
      {children}
    </Txt>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  first = false,
  last = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <View
      style={[
        cardRowStyle(first, last),
        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
      ]}
    >
      <Txt size={14} weight="medium" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
        thumbColor={colors.surfaceWhite}
        ios_backgroundColor={colors.surfaceInset}
      />
    </View>
  );
}
