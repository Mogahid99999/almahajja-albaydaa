/**
 * «التفاعل» in the live room (owner 2026-10-05, 0157): a calm Google-Meet-style
 * float — a tapped sign (👍 ❤️ 🤲 …) rises gently over the halaqa and fades.
 *
 *  - ReactionsOverlay: draws everyone's reactions (store onLiveReaction), at
 *    most MAX_FLYING at once (extra ones are skipped, never queued), native-
 *    driver animations only, never touchable (pointerEvents none). Under each
 *    sign, the sender's name as THIS viewer sees it on the halaqa (owner
 *    2026-10-25) — `senderName`, so the hijab / «بدون اسم» rules stay in one place.
 *  - ReactionPill + ReactionTray: the sender's button beside «التعليقات» and
 *    its row of six signs. Guests are asked to register (they listen only); a
 *    person whose reactions a moderator stopped sees why, and nothing is sent.
 *
 * Nothing here touches the database: reactions ride the LiveKit data channel.
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import {
  MAX_FLYING,
  REACTION_FLIGHT_MS,
  REACTIONS,
  reactionEmoji,
  type ReactionKey,
} from '@/lib/liveReactions';
import { onLiveReaction } from '@/stores/liveStore';

export const LIVE_REACT_COPY = {
  open: 'تفاعل',
  close: 'إغلاق التفاعل',
  blocked: 'أوقف المشرف تفاعلك في هذا المجلس',
  guestTitle: 'سجّل لتتفاعل مع المجلس',
  guestBody: 'التفاعل متاح للمسجّلين. سجّل دخولك، وتبقى في الحلقة تستمع حتى تعود.',
} as const;

type Flying = { id: number; emoji: string; who: string; x: number; drift: number; anim: Animated.Value };

/** Everyone's reactions, floating up from the foot of the halaqa board. */
export function ReactionsOverlay({
  width,
  height,
  senderName,
}: {
  width: number;
  height: number;
  /** The label under a sign, from the sender's LiveKit identity. */
  senderName: (identity: string) => string;
}) {
  const [items, setItems] = useState<Flying[]>([]);
  // Read at receive time: the listener below subscribes once.
  const nameRef = useRef(senderName);
  nameRef.current = senderName;
  const flying = useRef(0);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const off = onLiveReaction((e) => {
      if (flying.current >= MAX_FLYING) return; // a burst: skip, never queue
      flying.current++;
      const id = ++seq.current;
      const anim = new Animated.Value(0);
      const item: Flying = {
        id,
        emoji: reactionEmoji(e.key),
        who: nameRef.current(e.identity),
        x: 0.12 + Math.random() * 0.7,
        drift: (Math.random() - 0.5) * 36,
        anim,
      };
      setItems((prev) => [...prev, item]);
      Animated.timing(anim, {
        toValue: 1,
        duration: REACTION_FLIGHT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        flying.current = Math.max(0, flying.current - 1);
        if (alive.current) setItems((prev) => prev.filter((i) => i.id !== id));
      });
    });
    return () => {
      alive.current = false;
      off();
    };
  }, []);

  if (!items.length || width <= 0 || height <= 0) return null;
  const rise = Math.max(120, height * 0.72);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height, zIndex: 5 }}>
      {items.map((i) => (
        <Animated.View
          key={i.id}
          accessible={false}
          style={{
            position: 'absolute',
            bottom: 6,
            left: i.x * width,
            alignItems: 'center',
            opacity: i.anim.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateY: i.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) },
              { translateX: i.anim.interpolate({ inputRange: [0, 1], outputRange: [0, i.drift] }) },
              { scale: i.anim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.1, 1] }) },
            ],
          }}
        >
          <Txt style={{ fontSize: 28, lineHeight: 36 }}>{i.emoji}</Txt>
          {i.who ? (
            <Txt
              numberOfLines={1}
              style={{
                maxWidth: 96,
                marginTop: 1,
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: radius.pill,
                overflow: 'hidden',
                backgroundColor: 'rgba(0,0,0,0.35)',
                color: '#fff',
                fontSize: 11,
                lineHeight: 16,
              }}
            >
              {i.who}
            </Txt>
          ) : null}
        </Animated.View>
      ))}
    </View>
  );
}

/** The sender's button, beside «التعليقات». */
export function ReactionPill({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={open ? LIVE_REACT_COPY.close : LIVE_REACT_COPY.open}
      accessibilityState={{ expanded: open }}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: open ? colors.primaryTeal : colors.surfaceCard,
        borderWidth: 1,
        borderColor: open ? colors.primaryTeal : colors.borderSand,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Feather name="smile" size={16} color={open ? colors.onTealPrimary : colors.primaryTeal} />
    </Pressable>
  );
}

/** The six signs. `blocked`: a moderator stopped mine — say so, send nothing. */
export function ReactionTray({ blocked, onPick }: { blocked: boolean; onPick: (key: ReactionKey) => void }) {
  if (blocked) {
    return (
      <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
        <Txt size={12} color={colors.textMuted} align="center" style={{ alignSelf: 'stretch' }}>
          {LIVE_REACT_COPY.blocked}
        </Txt>
      </View>
    );
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 6,
      }}
    >
      {REACTIONS.map((r) => (
        <Pressable
          key={r.key}
          onPress={() => onPick(r.key)}
          accessibilityRole="button"
          accessibilityLabel={r.label}
          hitSlop={2}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceCard,
            borderWidth: 1,
            borderColor: colors.borderSand,
            transform: [{ scale: pressed ? 0.9 : 1 }],
          })}
        >
          <Txt size={22} centerGlyph>
            {r.emoji}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}
