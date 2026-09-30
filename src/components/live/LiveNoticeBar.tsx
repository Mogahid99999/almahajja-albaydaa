/**
 * Quiet one-line room messages (PLAN_LIVE_V23 §15 room.*):
 *  - `LiveNoticeBar` shows the store's one-shot `notice` (the du'a on entering,
 *    «رفعت يدك…», «صرت من المتحدثين…», «أغلق المشرف ميكروفونك…») for ~6 s, then
 *    clearNotice(); a new notice (new id) restarts the timer. Tap to dismiss.
 *    The text wraps and is never cut (no line limit).
 *  - `LiveNoticePill` the same look for the room's own lines (a failed action).
 *  - `LiveUndoBar` «ينتهي البث خلال ثوانٍ · تراجع» (§7.6 end undo).
 * Calm: no animation, sand card, a small icon — announced politely to screen readers.
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, shadows } from '@/constants/theme';
import { useLiveStore } from '@/stores/liveStore';
import { LIVE_P4_COPY, NOTICE_MS, noticeText, type NoticeKind } from './liveUi';

const GOOD: ReadonlySet<NoticeKind> = new Set<NoticeKind>(['joined', 'hand_raised', 'accepted']);

const ICON: Record<NoticeKind, keyof typeof Feather.glyphMap> = {
  joined: 'heart',
  hand_raised: 'check-circle',
  accepted: 'mic',
  rejected: 'info',
  muted: 'mic-off',
  demoted: 'headphones',
  requests_closed: 'pause-circle',
  rate_limited: 'clock',
  mic_denied: 'mic-off',
  failed: 'alert-circle',
};

export function LiveNoticeBar() {
  const notice = useLiveStore((s) => s.notice);
  const clearNotice = useLiveStore((s) => s.clearNotice);
  const id = notice?.id ?? null;

  useEffect(() => {
    if (id == null) return;
    const t = setTimeout(() => clearNotice?.(), NOTICE_MS);
    return () => clearTimeout(t);
  }, [id, clearNotice]);

  const text = notice ? noticeText(notice.kind) : null;
  if (!notice || !text) return null;
  const kind = notice.kind as NoticeKind;
  return (
    <LiveNoticePill
      text={text}
      icon={ICON[kind] ?? 'info'}
      tone={GOOD.has(kind) ? 'good' : 'warn'}
      onPress={() => clearNotice?.()}
    />
  );
}

export function LiveNoticePill({
  text,
  icon = 'info',
  tone = 'warn',
  onPress,
}: {
  text: string;
  icon?: keyof typeof Feather.glyphMap;
  tone?: 'good' | 'warn';
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityLiveRegion="polite"
      accessibilityLabel={text}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor: colors.borderSand,
          borderRadius: 14,
          paddingVertical: 10,
          paddingHorizontal: 14,
          alignSelf: 'stretch',
        },
        shadows.raised,
      ]}
    >
      <Feather
        name={icon}
        size={16}
        color={tone === 'good' ? colors.primaryTeal : colors.accentBrassMuted}
      />
      <Txt size={12.5} color={colors.textSlate} style={{ flex: 1, lineHeight: 20 }}>
        {text}
      </Txt>
    </Pressable>
  );
}

/** «ينتهي البث خلال ثوانٍ · تراجع» — the whole bar undoes. */
export function LiveUndoBar({ onUndo }: { onUndo: () => void }) {
  return (
    <Pressable
      onPress={onUndo}
      accessibilityRole="button"
      accessibilityLiveRegion="polite"
      accessibilityHint="يلغي إنهاء البث"
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: colors.primaryTeal,
          borderRadius: 14,
          paddingVertical: 12,
          paddingHorizontal: 16,
          alignSelf: 'stretch',
          opacity: pressed ? 0.9 : 1,
        },
        shadows.raised,
      ]}
    >
      <Feather name="clock" size={16} color={colors.accentBrass} />
      <View style={{ flex: 1 }}>
        <Txt size={13.5} color={colors.onTealPrimary}>
          {`${LIVE_P4_COPY.endUndo} · `}
          <Txt size={13.5} weight="semibold" color={colors.accentBrass} style={{ textDecorationLine: 'underline' }}>
            {LIVE_P4_COPY.undo}
          </Txt>
        </Txt>
      </View>
    </Pressable>
  );
}
