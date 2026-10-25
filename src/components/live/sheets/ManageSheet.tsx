/**
 * «إدارة المجلس» — the moderators' sheet (PLAN_LIVE_V23 §7.6):
 *  - «استقبال طلبات التحدث» switch (room metadata, live-control set_allow_requests)
 *  - who is on the floor now (speakers + moderators) → PersonSheet, with a
 *    one-tap «كتم» on every open microphone (owner 2026-10-05)
 *  - pending requests, oldest first → RequestSheet, with one-tap «قبول» /
 *    «رفض» on the row itself
 * Names come resolved from the room (staff see real names — D2).
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from 'react-native';

import { Divider, Txt, cardRowStyle } from '@/components/ui';
import { colors } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { useLiveStore } from '@/stores/liveStore';
import { HandGlyph, LiveAvatar } from '../LiveAvatar';
import { useNow } from '../LiveHomeCard';
import type { LivePerson } from '../liveTypes';
import { LIVE_P4_COPY, controlErrorText, handLine, roleKind, sexOf } from '../liveUi';
import { LiveSheet } from './LiveSheet';
import { SheetError } from './sheetParts';

export type ManageRow = { identity: string; person: LivePerson; name: string };

export function ManageSheet({
  visible,
  onClose,
  allowRequests,
  speakers,
  requests,
  onOpenPerson,
  onOpenRequest,
}: {
  visible: boolean;
  onClose: () => void;
  allowRequests: boolean;
  speakers: readonly ManageRow[];
  /** Oldest first. */
  requests: readonly ManageRow[];
  onOpenPerson: (identity: string) => void;
  onOpenRequest: (identity: string) => void;
}) {
  const setAllowRequests = useLiveStore((s) => s.setAllowRequests);
  const moderate = useLiveStore((s) => s.moderate);
  const now = useNow(30_000);
  // One-tap row actions: "<action>:<identity>" in flight.
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const quick = async (action: 'mute' | 'approve' | 'reject', row: ManageRow) => {
    if (busy) return;
    setBusy(`${action}:${row.identity}`);
    setError(null);
    try {
      await moderate(action, row.identity);
    } catch (e) {
      if (alive.current) setError(controlErrorText(e, sexOf(row.person.gender)));
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  // Optimistic switch; the room metadata confirms (or the error reverts it).
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);
  useEffect(() => {
    if (pending === null) return;
    if (pending === allowRequests) {
      setPending(null);
      return;
    }
    // Never stuck: if the room metadata doesn't echo back, show the store's value again.
    const t = setTimeout(() => setPending(null), 5000);
    return () => clearTimeout(t);
  }, [pending, allowRequests]);

  const value = pending ?? allowRequests;
  const toggle = async (next: boolean) => {
    setPending(next);
    setError(null);
    try {
      await setAllowRequests(next);
    } catch (e) {
      setPending(null);
      setError(controlErrorText(e));
    }
  };

  return (
    <LiveSheet visible={visible} onClose={onClose} title={LIVE_P4_COPY.manage} maxHeightRatio={0.85}>
      <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
        <View
          style={[
            cardRowStyle(true, true),
            { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Txt size={14} weight="semibold">
              {LIVE_P4_COPY.allowRequests}
            </Txt>
            <Txt size={12} color={colors.textFaint} style={{ lineHeight: 19 }}>
              {value ? 'يرفع المستمعون أيديهم وتصلكم طلباتهم' : LIVE_P4_COPY.requestsClosed}
            </Txt>
          </View>
          <Switch
            value={value}
            onValueChange={(v) => void toggle(v)}
            disabled={pending !== null}
            accessibilityLabel={LIVE_P4_COPY.allowRequests}
            trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
            thumbColor={colors.surfaceWhite}
            ios_backgroundColor={colors.surfaceInset}
          />
        </View>
        <SheetError text={error} />

        <GroupTitle text={`المتحدثون الآن · ${arNum(speakers.length)}`} />
        {speakers.length ? (
          speakers.map((r, i) => (
            <Row
              key={r.identity}
              row={r}
              first={i === 0}
              last={i === speakers.length - 1}
              sub={floorLine(r.person)}
              onPress={() => onOpenPerson(r.identity)}
              actions={
                r.person.micOn && roleKind(r.person.role) !== 'host' && !r.person.isMe
                  ? [
                      {
                        label: LIVE_P4_COPY.muteShort,
                        tone: 'danger',
                        busy: busy === `mute:${r.identity}`,
                        disabled: !!busy,
                        onPress: () => void quick('mute', r),
                      },
                    ]
                  : undefined
              }
            />
          ))
        ) : (
          <Empty text="لا يتحدث الآن غير الشيخ" />
        )}

        <GroupTitle text={`${LIVE_P4_COPY.requests} · ${arNum(requests.length)}`} />
        {requests.length ? (
          requests.map((r, i) => (
            <Row
              key={r.identity}
              row={r}
              first={i === 0}
              last={i === requests.length - 1}
              sub={handLine(sexOf(r.person.gender), r.person.handAt, now)}
              hand
              onPress={() => onOpenRequest(r.identity)}
              actions={[
                {
                  label: LIVE_P4_COPY.approveShort,
                  tone: 'primary',
                  busy: busy === `approve:${r.identity}`,
                  disabled: !!busy,
                  onPress: () => void quick('approve', r),
                },
                {
                  label: LIVE_P4_COPY.rejectShort,
                  tone: 'danger',
                  busy: busy === `reject:${r.identity}`,
                  disabled: !!busy,
                  onPress: () => void quick('reject', r),
                },
              ]}
            />
          ))
        ) : (
          <Empty text="لا طلبات الآن" />
        )}
      </ScrollView>
    </LiveSheet>
  );
}

/** «مشرف · الميكروفون مفتوح» / «متحدثة · الميكروفون مغلق». */
function floorLine(p: LivePerson): string {
  const f = sexOf(p.gender) === 'f';
  const who = roleKind(p.role) === 'moderator' ? (f ? 'مشرفة' : 'مشرف') : f ? 'متحدثة' : 'متحدث';
  return `${who} · ${p.micOn ? 'الميكروفون مفتوح' : 'الميكروفون مغلق'}`;
}

function GroupTitle({ text }: { text: string }) {
  return (
    <Txt size={12} weight="semibold" color={colors.textFaint} style={{ marginTop: 16, marginBottom: 6 }}>
      {text}
    </Txt>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Txt size={12.5} color={colors.textGhost} style={{ paddingVertical: 6 }}>
      {text}
    </Txt>
  );
}

type RowAction = {
  label: string;
  tone: 'primary' | 'danger';
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
};

function Row({
  row,
  sub,
  first,
  last,
  hand = false,
  onPress,
  actions,
}: {
  row: ManageRow;
  sub: string;
  first: boolean;
  last: boolean;
  hand?: boolean;
  onPress: () => void;
  /** One-tap buttons at the row's end (mute / approve / reject). */
  actions?: readonly RowAction[];
}) {
  const g = sexOf(row.person.gender);
  return (
    <>
      {!first ? (
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
      ) : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [
          cardRowStyle(first, last),
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <LiveAvatar gender={g} size={36} moderator={roleKind(row.person.role) === 'moderator'} />
        <View style={{ flex: 1 }}>
          <Txt size={14} weight="semibold" numberOfLines={1}>
            {row.name}
          </Txt>
          <Txt size={12} color={colors.textFaint} numberOfLines={1}>
            {sub}
          </Txt>
        </View>
        {hand && !actions?.length ? <HandGlyph size={16} color={colors.accentBrassMuted} /> : null}
        {actions?.map((a) => <RowButton key={a.label} action={a} />)}
      </Pressable>
    </>
  );
}

function RowButton({ action }: { action: RowAction }) {
  const fg = action.tone === 'primary' ? colors.onTealPrimary : '#9e3d2f';
  return (
    <Pressable
      onPress={action.onPress}
      disabled={action.disabled}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled: action.disabled, busy: action.busy }}
      hitSlop={4}
      style={({ pressed }) => ({
        minWidth: 52,
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: action.tone === 'primary' ? colors.primaryTeal : 'rgba(158,61,47,0.10)',
        opacity: action.disabled && !action.busy ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {action.busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Txt size={12.5} weight="semibold" color={fg}>
          {action.label}
        </Txt>
      )}
    </Pressable>
  );
}
