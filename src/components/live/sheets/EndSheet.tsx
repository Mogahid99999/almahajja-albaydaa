/**
 * «مغادرة الحلقة» for the host and moderators (PLAN_LIVE_V23 §7.6, §15 end):
 *
 *   choice  «أغادر ويستمر البث» — the host: only when another moderator is
 *           present (hands the session over: one → at once, several → pick);
 *           a moderator: a plain leave.
 *           «إنهاء البث للجميع» — the host, or a content manager (admin/publisher).
 *   pick    «من يدير البث بعدك؟» (the host, several moderators)
 *   confirm «إنهاء البث للجميع؟» + where the recording goes → `onEnd()`; the
 *           room then runs the 5-second undo («ينتهي البث خلال ثوانٍ · تراجع»)
 *           before live-control `end` — the timer lives in the room, not here,
 *           so it survives this sheet closing.
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { LIVE_COPY, LIVE_P4_COPY, controlErrorText } from '../liveUi';
import { LiveSheet } from './LiveSheet';
import { SheetButton, SheetError } from './sheetParts';

type Step = 'choice' | 'pick' | 'confirm';

export function EndSheet({
  visible,
  onClose,
  sectionTitle,
  isHost,
  canEndAll,
  moderators,
  onLeave,
  onHandOver,
  onEnd,
}: {
  visible: boolean;
  onClose: () => void;
  /** Where the recording is saved (session.sectionTitle). */
  sectionTitle: string | null;
  /** My live role is host. */
  isHost: boolean;
  /** Host or content manager. */
  canEndAll: boolean;
  /** Other moderators present, with the names the room resolved. */
  moderators: readonly { identity: string; name: string }[];
  /** A non-host moderator leaves; the broadcast goes on. */
  onLeave: () => void;
  /** Host: host_leave to this moderator, then leave (throws LiveControlError). */
  onHandOver: (identity: string) => Promise<void>;
  /** Confirmed «إنهاء البث للجميع» → the room starts the undo window. */
  onEnd: () => void;
}) {
  const [step, setStep] = useState<Step>('choice');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStep('choice');
      setBusy(null);
      setError(null);
    }
  }, [visible]);

  const canKeep = !isHost || moderators.length > 0;

  const handOver = async (identity: string) => {
    setBusy(identity);
    setError(null);
    try {
      await onHandOver(identity);
    } catch (e) {
      setError(controlErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  const onKeep = () => {
    if (!isHost) {
      onLeave();
      return;
    }
    if (moderators.length === 1) void handOver(moderators[0].identity);
    else setStep('pick');
  };

  if (step === 'confirm') {
    return (
      <LiveSheet visible={visible} onClose={onClose} title={LIVE_P4_COPY.endConfirm}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            backgroundColor: colors.surfaceCard,
            borderWidth: 1,
            borderColor: colors.borderSand,
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 14,
            marginBottom: 12,
          }}
        >
          <Feather name="folder" size={16} color={colors.accentBrassMuted} style={{ marginTop: 3 }} />
          <Txt size={13.5} color={colors.textSlate} style={{ flex: 1, lineHeight: 22 }}>
            {sectionTitle ? `يُحفظ التسجيل في قسم ${sectionTitle}` : 'يُحفظ التسجيل في قسم المجلس'}
          </Txt>
        </View>
        <Txt size={12.5} color={colors.textFaint} style={{ lineHeight: 20, marginBottom: 14 }}>
          ينتهي المجلس عند جميع الحاضرين، ولك خمس ثوانٍ للتراجع.
        </Txt>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <SheetButton label={LIVE_P4_COPY.endAll} tone="danger" onPress={onEnd} />
          <SheetButton label="رجوع" onPress={() => setStep('choice')} />
        </View>
      </LiveSheet>
    );
  }

  if (step === 'pick') {
    return (
      <LiveSheet
        visible={visible}
        onClose={onClose}
        title="من يدير البث بعدك؟"
        sub="يتولّى المشرف الذي تختاره إدارة المجلس، ويستمر البث والتسجيل."
      >
        <View style={{ gap: 8 }}>
          {moderators.map((m) => (
            <SheetButton
              key={m.identity}
              label={m.name}
              grow={false}
              busy={busy === m.identity}
              disabled={!!busy && busy !== m.identity}
              onPress={() => void handOver(m.identity)}
            />
          ))}
        </View>
        <SheetError text={error} />
        <View style={{ marginTop: 12 }}>
          <SheetButton label="رجوع" grow={false} onPress={() => setStep('choice')} />
        </View>
      </LiveSheet>
    );
  }

  return (
    <LiveSheet visible={visible} onClose={onClose} title={LIVE_COPY.leave}>
      <View style={{ gap: 10 }}>
        {canKeep ? (
          <Choice
            icon="log-out"
            title={LIVE_P4_COPY.leaveKeep}
            sub={
              !isHost
                ? 'يبقى البث قائماً ويستمر التسجيل'
                : moderators.length === 1
                  ? `يتولّى ${moderators[0].name} إدارة المجلس`
                  : 'تختار من يدير المجلس بعدك'
            }
            busy={!!busy}
            onPress={onKeep}
          />
        ) : null}
        {canEndAll ? (
          <Choice
            icon="square"
            title={LIVE_P4_COPY.endAll}
            sub="ينتهي المجلس عند الجميع ويُحفظ تسجيله"
            tone="end"
            busy={!!busy}
            onPress={() => setStep('confirm')}
          />
        ) : null}
        {isHost && !canKeep ? (
          <Txt size={12.5} color={colors.textFaint} style={{ lineHeight: 20 }}>
            لا يوجد مشرف آخر في الحلقة ليستمر البث بعدك.
          </Txt>
        ) : null}
      </View>
      <SheetError text={error} />
      <View style={{ marginTop: 14 }}>
        <SheetButton label="البقاء في الحلقة" grow={false} onPress={onClose} />
      </View>
    </LiveSheet>
  );
}

function Choice({
  icon,
  title,
  sub,
  tone = 'plain',
  busy,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  sub: string;
  tone?: 'plain' | 'end';
  busy: boolean;
  onPress: () => void;
}) {
  const ink = tone === 'end' ? colors.stateDanger : colors.primaryTeal;
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.surfaceCard,
        borderWidth: 1,
        borderColor: colors.borderSand,
        borderRadius: radius.card - 4,
        paddingVertical: 12,
        paddingHorizontal: 14,
        opacity: busy ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: colors.surfaceInset,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name={icon} size={17} color={ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt size={15} weight="semibold" color={ink}>
          {title}
        </Txt>
        <Txt size={12} color={colors.textFaint} style={{ lineHeight: 19 }}>
          {sub}
        </Txt>
      </View>
    </Pressable>
  );
}
