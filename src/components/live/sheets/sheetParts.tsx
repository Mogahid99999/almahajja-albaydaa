/**
 * Small shared parts of the P4 live sheets (Request / Person / Manage / End /
 * Create): the sheet buttons, a person header, the short error line and the
 * moderation runner. Same look as GuestSpeakSheet / IdentitySheet.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useLiveStore } from '@/stores/liveStore';
import { LiveAvatar, SheikhAvatar } from '../LiveAvatar';
import { controlErrorText, type ModerationAction, type Sex } from '../liveUi';

export function SheetButton({
  label,
  tone = 'secondary',
  onPress,
  disabled = false,
  busy = false,
  grow,
  accessibilityLabel,
}: {
  label: string;
  tone?: 'primary' | 'secondary' | 'danger';
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** flex: 1 (defaults to on for primary/danger). */
  grow?: boolean;
  accessibilityLabel?: string;
}) {
  const bg =
    tone === 'primary' ? colors.primaryTeal : tone === 'danger' ? colors.stateDanger : colors.surfaceInset;
  const fg = tone === 'secondary' ? colors.textSlate : colors.onTealPrimary;
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flex: (grow ?? tone !== 'secondary') ? 1 : undefined,
        minHeight: 48,
        paddingHorizontal: 18,
        borderRadius: radius.input + 4,
        backgroundColor: bg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        opacity: disabled ? 0.45 : pressed || busy ? 0.8 : 1,
      })}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      <Txt size={15} weight={tone === 'secondary' ? 'medium' : 'semibold'} color={fg} align="center">
        {label}
      </Txt>
    </Pressable>
  );
}

/** A short failure line under the actions. */
export function SheetError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Txt
      size={12.5}
      color={colors.stateDanger}
      style={{ marginTop: 10, lineHeight: 20, alignSelf: 'stretch' }}
      accessibilityLiveRegion="polite"
    >
      {text}
    </Txt>
  );
}

/** Avatar + name + a quiet sub-line (a PeopleSheet row, standalone). */
export function PersonHeader({
  name,
  sub,
  gender,
  host = false,
  moderator = false,
}: {
  /** Omit when the sheet title already names them. */
  name?: string;
  sub?: string | null;
  gender: Sex;
  host?: boolean;
  moderator?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      {host ? (
        <SheikhAvatar name={name ?? ''} size={48} />
      ) : (
        <LiveAvatar gender={gender} size={48} moderator={moderator} />
      )}
      <View style={{ flex: 1 }}>
        {name ? (
          <Txt size={16} weight="semibold" numberOfLines={1}>
            {name}
          </Txt>
        ) : null}
        {sub ? (
          <Txt size={name ? 12.5 : 14} color={name ? colors.textFaint : colors.textSlate} numberOfLines={2} style={{ lineHeight: 22 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Runs one moderator action through the store (live-control): which action is
 * in flight, and the Arabic line of the last failure. `run` resolves true on success.
 */
export function useModeration(gender: Sex) {
  const moderate = useLiveStore((s) => s.moderate);
  const [busy, setBusy] = useState<ModerationAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // The sheet instance is reused for the next person: an action still in
  // flight keeps `busy` (no second action meanwhile), and its result must not
  // close / error the sheet that is now showing someone else (`gen`).
  const inFlight = useRef(false);
  const gen = useRef(0);
  const run = useCallback(
    async (action: ModerationAction, identity: string): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      const g = gen.current;
      setBusy(action);
      setError(null);
      try {
        await moderate(action, identity);
        return gen.current === g;
      } catch (e) {
        if (alive.current && gen.current === g) setError(controlErrorText(e, gender));
        return false;
      } finally {
        inFlight.current = false;
        if (alive.current) setBusy(null);
      }
    },
    [moderate, gender],
  );

  const reset = useCallback(() => {
    gen.current++;
    if (!inFlight.current) setBusy(null);
    setError(null);
  }, []);

  return { run, busy, error, reset };
}
