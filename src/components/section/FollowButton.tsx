/**
 * FollowButton (feature B) — "متابعة القسم" / "إيقاف المتابعة" in the section
 * header. Following a section (root or nested) subscribes the student to new
 * lectures/attachments anywhere in its subtree. Brass-outlined pill, no follower
 * counts, no social pressure (CLAUDE.md calm tone).
 */
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors, radius } from '@/constants/theme';
import { useSectionFollow, useToggleFollow } from '@/hooks/useNotifications';
import { Txt } from '@/components/ui/Txt';

export function FollowButton({ sectionId }: { sectionId: string }) {
  const { data: followed, isLoading } = useSectionFollow(sectionId);
  const toggle = useToggleFollow(sectionId);

  const isFollowed = !!followed;
  const pending = toggle.isPending;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isFollowed ? 'إيقاف متابعة القسم' : 'متابعة القسم'}
      disabled={isLoading || pending}
      onPress={() => toggle.mutate(isFollowed)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: colors.accentBrass,
        backgroundColor: isFollowed ? colors.accentBrass : 'transparent',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {pending ? (
        <ActivityIndicator
          size="small"
          color={isFollowed ? colors.primaryTealDeep : colors.accentBrassMuted}
        />
      ) : (
        <Feather
          name={isFollowed ? 'check' : 'bell'}
          size={15}
          color={isFollowed ? colors.primaryTealDeep : colors.accentBrassMuted}
        />
      )}
      <Txt
        size={13}
        weight="semibold"
        color={isFollowed ? colors.primaryTealDeep : colors.accentBrassMuted}
      >
        {isFollowed ? 'تتابع القسم' : 'متابعة القسم'}
      </Txt>
    </Pressable>
  );
}
