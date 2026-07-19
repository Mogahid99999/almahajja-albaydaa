import { View, Pressable } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { useCurrentUser } from '@/hooks/useAuth';
import { useIncomingBuddyGoals, useRespondBuddyGoal } from '@/hooks/useBuddyGoals';
import { formatBuddyGoalTarget } from '@/components/journey/labels';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * Home card for incoming «أهداف الرفقة» invitations (V20 · §10/§12). Registered
 * users only. Shows each pending shared-goal invitation with inline accept /
 * decline, right on the Home screen so it's never missed. Renders nothing when
 * there are no pending goal invitations.
 */
export function BuddyGoalInvitesCard() {
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: invites } = useIncomingBuddyGoals({ enabled: !isGuest });
  const respond = useRespondBuddyGoal();

  if (isGuest || !invites || invites.length === 0) return null;

  return (
    <View style={{ gap: 10, marginBottom: 12 }}>
      {invites.map((g) => (
        <Card key={g.id} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: colors.surfaceInset,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather name="target" size={18} color={colors.accentBrassMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="display" size={15} color={colors.primaryTeal}>
                {`دعاك ${g.fromName} إلى هدف مشترك`}
              </Txt>
              <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }} tabular>
                {`${formatBuddyGoalTarget(g.target, g.metric)} خلال ${arNum(g.days)} يوماً`}
              </Txt>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
            <Pressable
              onPress={() => respond.mutate({ goalId: g.id, accept: true })}
              disabled={respond.isPending}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 10,
                borderRadius: radius.input,
                alignItems: 'center',
                backgroundColor: colors.primaryTeal,
                opacity: pressed || respond.isPending ? 0.7 : 1,
              })}
            >
              <Txt size={13} weight="semibold" color={colors.onTealPrimary}>
                قبول
              </Txt>
            </Pressable>
            <Pressable
              onPress={() => respond.mutate({ goalId: g.id, accept: false })}
              disabled={respond.isPending}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 10,
                borderRadius: radius.input,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.borderSand2,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Txt size={13} weight="semibold" color={colors.textMuted}>
                اعتذار
              </Txt>
            </Pressable>
          </View>
        </Card>
      ))}
    </View>
  );
}
