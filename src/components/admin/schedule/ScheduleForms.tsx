/**
 * /admin/schedule forms (0158):
 *   ScheduleItemForm  — add / edit a weekly lesson (days, Mecca time, sheikh,
 *                       section, audience, visible).
 *   DateChangeForm    — change ONE date of a lesson alone: cancel it, postpone
 *                       it to another date (and time), or move its time that day.
 * Every moderator (admin · publisher · sheikh) may use them — RLS
 * (can_edit_schedule) is the gate; these only say why before the server refuses.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';

import type { Schedule, ScheduleAudience, ScheduleItem } from '@/api/schedule';
import { TreePicker } from '@/components/admin/TreePicker';
import { Card, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useSheikhs } from '@/hooks/useAdmin';
import { useSaveScheduleException, useSaveScheduleItem } from '@/hooks/useSchedule';
import { staffErrorText } from '@/lib/errorText';
import { arClockLine, arDate, arDaysLabel, DAY_NAMES, WEEK_ORDER } from '@/lib/schedule';

import {
  AUDIENCE_LABEL,
  changeDraft,
  draftFromItem,
  itemDates,
  normalizeHM,
  targetDates,
  validateItemDraft,
  type ChangeDraft,
  type ChangeKind,
  type ItemDraft,
} from './scheduleAdminUi';

export function ToggleChip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Txt size={13} weight={on ? 'semibold' : 'medium'} color={on ? colors.onTealPrimary : colors.textSlate}>
        {label}
      </Txt>
    </Pressable>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt weight="semibold" size={13} color={colors.textSlate}>
        {label}
      </Txt>
      {children}
      {hint ? (
        <Txt size={11.5} color={colors.textFaint}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.textGhost} textAlign="right" {...props} style={[styles.input, props.style]} />;
}

function PrimaryButton({ label, onPress, pending, icon = 'check' }: { label: string; onPress: () => void; pending?: boolean; icon?: keyof typeof Feather.glyphMap }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityRole="button"
      style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || pending ? 0.6 : 1 }]}
    >
      <Feather name={icon} size={16} color={colors.onTealPrimary} />
      <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
        {label}
      </Txt>
    </Pressable>
  );
}

function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.6 }]}>
      <Txt weight="semibold" size={14} color={colors.textSlate}>
        {label}
      </Txt>
    </Pressable>
  );
}

// ─── Lesson form ──────────────────────────────────────────────────────────────

export function ScheduleItemForm({ item, onDone }: { item: ScheduleItem | null; onDone: () => void }) {
  const save = useSaveScheduleItem();
  const { data: sheikhs = [] } = useSheikhs();
  const [d, setD] = useState<ItemDraft>(() => draftFromItem(item));
  const [freeName, setFreeName] = useState(() => !!item && !item.sheikhId && !!item.sheikhName);
  const [error, setError] = useState('');
  const set = <K extends keyof ItemDraft>(k: K, v: ItemDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const toggleDay = (day: number) =>
    set('days', d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day]);
  const preview = normalizeHM(d.time);

  function submit() {
    const check = validateItemDraft(d);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError('');
    save.mutate(check.input, {
      onSuccess: onDone,
      onError: (e) => setError(staffErrorText(e, 'تعذّر حفظ الدرس.')),
    });
  }

  return (
    <Card style={styles.formCard}>
      <Txt weight="bold" size={16} color={colors.primaryTeal} style={{ marginBottom: 14 }}>
        {item ? 'تعديل الدرس' : 'درس جديد في الجدول'}
      </Txt>
      <View style={{ gap: 14 }}>
        <Field label="عنوان الدرس">
          <Input value={d.title} onChangeText={(v) => set('title', v)} placeholder="مثال: شرح كتاب التوحيد" maxLength={150} />
        </Field>
        <Field label="وصف قصير (اختياري)">
          <Input value={d.subtitle} onChangeText={(v) => set('subtitle', v)} placeholder="مثال: للإمام محمد بن عبد الوهاب" maxLength={200} />
        </Field>
        <Field label="المادة (اختياري)">
          <Input value={d.subject} onChangeText={(v) => set('subject', v)} placeholder="العقيدة · الحديث · الفقه…" maxLength={60} />
        </Field>

        <Field label="الشيخ">
          <View style={styles.chipsWrap}>
            {sheikhs.map((s) => (
              <ToggleChip
                key={s.id}
                label={s.name}
                on={!freeName && d.sheikhId === s.id}
                onPress={() => {
                  setFreeName(false);
                  setD((p) => ({ ...p, sheikhId: p.sheikhId === s.id ? null : s.id, sheikhName: p.sheikhId === s.id ? '' : s.name }));
                }}
              />
            ))}
            <ToggleChip
              label="اسم آخر"
              on={freeName}
              onPress={() => {
                setFreeName(!freeName);
                setD((p) => ({ ...p, sheikhId: null, sheikhName: '' }));
              }}
            />
          </View>
          {freeName ? (
            <Input value={d.sheikhName} onChangeText={(v) => set('sheikhName', v)} placeholder="اسم الشيخ" maxLength={120} />
          ) : null}
        </Field>

        <Field label="القسم في التطبيق (اختياري)" hint="يظهر للطالب زرّ «دروس هذا الكتاب»، وشارة «مباشر الآن» حين يُبثّ هذا القسم.">
          <TreePicker value={d.sectionId} onChange={(id) => set('sectionId', id)} allowNull />
        </Field>

        <Field label="الأيام" hint={d.days.length ? arDaysLabel(d.days) : undefined}>
          <View style={styles.chipsWrap}>
            {WEEK_ORDER.map((day) => (
              <ToggleChip key={day} label={DAY_NAMES[day]} on={d.days.includes(day)} onPress={() => toggleDay(day)} />
            ))}
            <ToggleChip
              label="يومياً"
              on={d.days.length === 7}
              onPress={() => set('days', d.days.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6])}
            />
          </View>
        </Field>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Field label="الوقت بتوقيت مكة" hint={preview ? arClockLine(preview) : 'بنظام ٢٤ ساعة، مثل 21:30'}>
              <Input value={d.time} onChangeText={(v) => set('time', v)} placeholder="21:30" keyboardType="numbers-and-punctuation" maxLength={5} />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="المدة بالدقائق" hint="اختياري">
              <Input value={d.duration} onChangeText={(v) => set('duration', v)} placeholder="60" keyboardType="number-pad" maxLength={3} />
            </Field>
          </View>
        </View>

        <Field label="يظهر لـ">
          <View style={styles.chipsWrap}>
            {(['all', 'male', 'female'] as ScheduleAudience[]).map((a) => (
              <ToggleChip key={a} label={AUDIENCE_LABEL[a]} on={d.audience === a} onPress={() => set('audience', a)} />
            ))}
          </View>
        </Field>

        <Field label="ملاحظة ثابتة (اختياري)">
          <Input value={d.note} onChangeText={(v) => set('note', v)} placeholder="مثال: بعد صلاة العشاء" maxLength={300} />
        </Field>

        <View style={styles.switchRow}>
          <Txt size={13.5} weight="semibold" style={{ flex: 1 }}>
            ظاهر للطلاب
          </Txt>
          <Switch
            value={d.isActive}
            onValueChange={(v) => set('isActive', v)}
            accessibilityLabel="ظاهر للطلاب"
            trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
            thumbColor={colors.surfaceWhite}
          />
        </View>
      </View>

      {error ? (
        <Txt size={12.5} color={colors.stateDanger} style={{ marginTop: 12 }}>
          {error}
        </Txt>
      ) : null}
      <View style={styles.actions}>
        <PrimaryButton label={save.isPending ? 'جارٍ الحفظ…' : 'حفظ'} onPress={submit} pending={save.isPending} />
        <GhostButton label="إلغاء" onPress={onDone} />
      </View>
    </Card>
  );
}

// ─── One date of a lesson ─────────────────────────────────────────────────────

const KIND_LABEL: Record<ChangeKind, string> = {
  cancel: 'إلغاء هذا اليوم',
  postpone: 'تأجيل إلى يوم آخر',
  time: 'تغيير الوقت هذا اليوم',
};

function DateChips({ dates, value, onChange, today }: { dates: string[]; value: string | null; onChange: (d: string) => void; today: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {dates.map((date) => (
        <ToggleChip
          key={date}
          label={date === today ? `اليوم · ${arDate(date).split(' ').slice(1).join(' ')}` : arDate(date)}
          on={value === date}
          onPress={() => onChange(date)}
        />
      ))}
    </ScrollView>
  );
}

export function DateChangeForm({
  item,
  schedule,
  today,
  initialDate,
  onDone,
}: {
  item: ScheduleItem;
  schedule: Schedule;
  today: string;
  initialDate?: string | null;
  onDone: () => void;
}) {
  const save = useSaveScheduleException();
  const dates = itemDates(item, today);
  const savedOn = (dt: string | null) =>
    dt ? schedule.exceptions.find((e) => e.itemId === item.id && e.occursOn === dt) : undefined;
  const [date, setDate] = useState<string | null>(initialDate ?? dates[0] ?? null);
  const [draft, setDraft] = useState<ChangeDraft>(() => changeDraft(item, savedOn(date)));
  const [error, setError] = useState('');
  const existing = savedOn(date);
  const { kind, newDate, time, note } = draft;
  const setKind = (k: ChangeKind) => setDraft((p) => ({ ...p, kind: k }));
  const setNewDate = (v: string) => setDraft((p) => ({ ...p, newDate: v }));
  const setTime = (v: string) => setDraft((p) => ({ ...p, time: v }));
  const setNote = (v: string) => setDraft((p) => ({ ...p, note: v }));
  const pickDate = (dt: string) => {
    setDate(dt);
    setDraft(changeDraft(item, savedOn(dt)));
    setError('');
  };
  const preview = normalizeHM(time);

  function submit() {
    if (!date) {
      setError('اختر اليوم الذي تريد تغييره.');
      return;
    }
    if (note.trim().length > 300) {
      setError('الملاحظة طويلة — ٣٠٠ حرف على الأكثر.');
      return;
    }
    let input;
    if (kind === 'cancel') {
      input = { itemId: item.id, occursOn: date, kind: 'cancelled' as const, newDate: null, newTime: null, note };
    } else {
      const hm = normalizeHM(time);
      if (!hm) {
        setError('اكتب الوقت بنظام ٢٤ ساعة بتوقيت مكة، مثل 21:30.');
        return;
      }
      if (kind === 'postpone') {
        if (!newDate || newDate === date) {
          setError('اختر اليوم الذي يُؤجَّل إليه الدرس.');
          return;
        }
        input = { itemId: item.id, occursOn: date, kind: 'moved' as const, newDate, newTime: hm, note };
      } else {
        if (hm === item.startTime) {
          setError('هذا هو وقته المعتاد — اكتب الوقت الجديد.');
          return;
        }
        input = { itemId: item.id, occursOn: date, kind: 'moved' as const, newDate: date, newTime: hm, note };
      }
    }
    setError('');
    save.mutate(input, {
      onSuccess: onDone,
      onError: (e) => setError(staffErrorText(e, 'تعذّر حفظ التغيير.')),
    });
  }

  return (
    <View style={styles.changeBox}>
      <Txt weight="bold" size={14.5} color={colors.primaryTeal}>
        تغيير يوم واحد من «{item.title}»
      </Txt>
      <Txt size={12} color={colors.textFaint} style={{ marginBottom: 4 }}>
        يبقى الجدول المعتاد كما هو، ويرى الطلاب التغيير على ذلك اليوم وحده.
      </Txt>
      {dates.length === 0 ? (
        <Txt size={13} color={colors.textMuted}>
          لا مواعيد لهذا الدرس في الأسابيع القادمة.
        </Txt>
      ) : (
        <View style={{ gap: 12 }}>
          <Field label="اليوم" hint={`موعده المعتاد: ${arClockLine(item.startTime)} بتوقيت مكة`}>
            <DateChips dates={dates} value={date} onChange={pickDate} today={today} />
          </Field>
          {existing ? (
            <Txt size={12} color={colors.accentBrassMuted}>
              لهذا اليوم تغيير محفوظ — الحفظ يستبدله.
            </Txt>
          ) : null}
          <View style={styles.chipsWrap}>
            {(Object.keys(KIND_LABEL) as ChangeKind[]).map((k) => (
              <ToggleChip key={k} label={KIND_LABEL[k]} on={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
          {kind === 'postpone' ? (
            <Field label="يُؤجَّل إلى">
              <DateChips dates={targetDates(today).filter((x) => x !== date)} value={newDate} onChange={setNewDate} today={today} />
            </Field>
          ) : null}
          {kind !== 'cancel' ? (
            <Field label="الوقت بتوقيت مكة" hint={preview ? arClockLine(preview) : 'بنظام ٢٤ ساعة، مثل 21:30'}>
              <Input value={time} onChangeText={setTime} placeholder="21:30" keyboardType="numbers-and-punctuation" maxLength={5} style={{ maxWidth: 160 }} />
            </Field>
          ) : null}
          <Field label="سبب أو ملاحظة للطلاب (اختياري)">
            <Input value={note} onChangeText={setNote} placeholder="مثال: لسفر الشيخ" maxLength={300} />
          </Field>
        </View>
      )}
      {error ? (
        <Txt size={12.5} color={colors.stateDanger} style={{ marginTop: 10 }}>
          {error}
        </Txt>
      ) : null}
      <View style={styles.actions}>
        {dates.length > 0 ? (
          <PrimaryButton label={save.isPending ? 'جارٍ الحفظ…' : 'حفظ التغيير'} onPress={submit} pending={save.isPending} />
        ) : null}
        <GhostButton label="إغلاق" onPress={onDone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  formCard: { maxWidth: 760, marginBottom: 24 } as ViewStyle,
  input: {
    height: 46,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
  } as TextStyle,
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as ViewStyle,
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,
  chipOn: { backgroundColor: colors.primaryTeal, borderColor: colors.primaryTeal } as ViewStyle,
  row2: { flexDirection: 'row', gap: 12 } as ViewStyle,
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 } as ViewStyle,
  actions: { flexDirection: 'row', gap: 10, marginTop: 16, flexWrap: 'wrap' } as ViewStyle,
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,
  ghostBtn: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSand2,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  changeBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: radius.input,
    backgroundColor: colors.bgSand,
    borderWidth: 1,
    borderColor: colors.borderSand,
    gap: 6,
  } as ViewStyle,
});
