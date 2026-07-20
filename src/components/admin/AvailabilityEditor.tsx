/**
 * AvailabilityEditor — admin control for WHEN a quiz is available to students
 * (migration 0118). Three modes:
 *   'open'      → always available
 *   'closed'    → manually shut
 *   'scheduled' → available inside a [from, until] datetime window
 *
 * The admin web dashboard is used from desktop and phone browsers alike
 * (CLAUDE.md: "the responsive admin web is used from phones"), so the datetime
 * inputs are the platform-native <input type="datetime-local"> on web — the
 * real usage path. A plain ISO TextInput is the native (Expo app) fallback.
 *
 * Values are stored/emitted as ISO-8601 strings (UTC via toISOString) so they
 * round-trip cleanly through Postgres timestamptz; the <input> shows and edits
 * them in the browser's local time.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';

import type { QuizAvailabilityMode } from '@/api/types';
import { Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';

interface Props {
  mode: QuizAvailabilityMode;
  from: string | null;
  until: string | null;
  onChangeMode: (m: QuizAvailabilityMode) => void;
  onChangeFrom: (v: string | null) => void;
  onChangeUntil: (v: string | null) => void;
}

const MODES: { key: QuizAvailabilityMode; label: string }[] = [
  { key: 'open', label: 'مفتوح دائمًا' },
  { key: 'scheduled', label: 'مجدوَل بمدة' },
  { key: 'closed', label: 'مغلق' },
];

/** ISO (UTC) → value the browser datetime-local input expects (local, no tz). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local, no tz) → ISO (UTC), or null when cleared. */
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v); // parsed as local time
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <View style={{ flex: 1, minWidth: 180 }}>
      <Txt weight="semibold" size={12.5} color={colors.textSlate} style={{ marginBottom: 6 }}>
        {label}
      </Txt>
      {Platform.OS === 'web'
        ? // react-native-web renders this DOM node directly; styled to match inputs.
          React.createElement('input', {
            type: 'datetime-local',
            value: isoToLocalInput(value),
            onChange: (e: any) => onChange(localInputToIso(e.target.value)),
            style: {
              height: 44,
              width: '100%',
              boxSizing: 'border-box',
              backgroundColor: colors.surfaceWhite,
              border: `1.5px solid ${colors.borderSand2}`,
              borderRadius: 10,
              padding: '0 12px',
              fontFamily: fonts.body,
              fontSize: 14,
              color: colors.textInk,
              direction: 'ltr',
            },
          })
        : // Native fallback: ISO string entry (admin native path is not primary).
          <TextInput
            value={value ?? ''}
            onChangeText={(t) => onChange(t.trim() || null)}
            placeholder="2026-08-01T20:00:00.000Z"
            placeholderTextColor={colors.textGhost}
            autoCapitalize="none"
            style={styles.textInput}
          />}
    </View>
  );
}

export function AvailabilityEditor({
  mode,
  from,
  until,
  onChangeMode,
  onChangeFrom,
  onChangeUntil,
}: Props) {
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.track}>
        {MODES.map((m) => {
          const active = mode === m.key;
          return (
            <Pressable
              key={m.key}
              onPress={() => onChangeMode(m.key)}
              style={[styles.segment, active && styles.segmentActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Txt
                size={12.5}
                weight={active ? 'semibold' : 'regular'}
                color={active ? colors.textInk : colors.textMuted}
              >
                {m.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {mode === 'scheduled' ? (
        <View style={styles.windowRow}>
          <DateTimeField label="يبدأ التوفّر" value={from} onChange={onChangeFrom} />
          <DateTimeField label="ينتهي التوفّر" value={until} onChange={onChangeUntil} />
        </View>
      ) : null}

      <View style={styles.noteRow}>
        <View
          style={[
            styles.dot,
            {
              backgroundColor:
                mode === 'open'
                  ? colors.stateSuccess
                  : mode === 'closed'
                    ? colors.textMuted
                    : colors.accentBrassMuted,
            },
          ]}
        />
        <Txt size={12} color={colors.textMuted} style={{ flex: 1, lineHeight: 19 }}>
          {mode === 'open'
            ? 'متاح لكل الطلاب فور النشر، دون قيد زمني.'
            : mode === 'closed'
              ? 'مغلق يدويًا — لا يستطيع أي طالب بدء محاولة جديدة.'
              : 'يُفتح ويُغلق تلقائيًا حسب المدة المحددة. اترك حقلاً فارغًا ليبقى مفتوحًا من تلك الجهة. لا تتأثر المحاولات التي بدأها الطلاب قبل الإغلاق.'}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceTrack,
    borderRadius: radius.sm,
    padding: 3,
    gap: 2,
  } as ViewStyle,

  segment: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  } as ViewStyle,

  segmentActive: {
    backgroundColor: colors.surfaceWhite,
    ...shadows.button,
  } as ViewStyle,

  windowRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  } as ViewStyle,

  textInput: {
    height: 44,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textInk,
    textAlign: 'left',
  },

  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 2,
  } as ViewStyle,

  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginTop: 6,
  } as ViewStyle,
});
