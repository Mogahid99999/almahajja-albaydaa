/**
 * 0183 «تعليق مثبّت» (owner 2026-11-22): the one comment a moderator pinned for
 * everyone in the majlis.
 *  - `room`: under «يتحدث الآن…» in the room — two lines, the whole card opens
 *    the comments (where it is read in full);
 *  - `sheet`: atop the comments list — the full text; a moderator's
 *    «إلغاء التثبيت» rides in `action`.
 * The author line follows the comment rules («بدون اسم» → «طالب» / «طالبة»).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import type { LiveComment } from '@/api/liveComments';
import { Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { LIVE_COMMENTS_COPY as COPY, commentAuthorLabel, sexOf } from './liveUi';

export function PinnedCommentCard({
  c,
  variant,
  onPress,
  action,
}: {
  c: LiveComment;
  variant: 'room' | 'sheet';
  onPress?: () => void;
  action?: ReactNode;
}) {
  const room = variant === 'room';
  const f = sexOf(c.gender) === 'f';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${COPY.pinnedOpenA11y}: ${c.text}` : undefined}
      style={({ pressed }) => ({
        alignSelf: 'stretch',
        paddingVertical: room ? 8 : 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: colors.surfaceCard,
        borderWidth: 1,
        borderColor: 'rgba(176,137,79,0.45)',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <MaterialCommunityIcons name="pin" size={14} color={colors.accentBrassMuted} />
        <Txt size={12} weight="semibold" color={colors.accentBrassMuted} textBreakStrategy="simple">
          {COPY.pinned}
        </Txt>
        <Txt
          size={12}
          weight="medium"
          color={f ? colors.accentBrassMuted : colors.primaryTeal600}
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {`· ${commentAuthorLabel(c)}`}
        </Txt>
        <View style={{ flex: 1 }} />
        {room ? <MaterialCommunityIcons name="chevron-left" size={16} color={colors.textGhost} /> : null}
      </View>
      <Txt
        size={room ? 13 : 14}
        color={colors.textInk}
        numberOfLines={room ? 2 : undefined}
        selectable={!room}
        style={{ lineHeight: room ? 21 : 23, marginTop: 3, alignSelf: 'stretch' }}
      >
        {c.text}
      </Txt>
      {action ? <View style={{ flexDirection: 'row', marginTop: 8 }}>{action}</View> : null}
    </Pressable>
  );
}
