import { Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';

import { MAX_BUDDIES } from '@/api/buddy';
import type { BuddyStatus } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import {
  useMyBuddies,
  useOutgoingPending,
  usePendingBuddyRequests,
  useRespondToRequest,
} from '@/hooks/useBuddy';
import { useStreakStatus } from '@/hooks/useStreak';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * Home buddy card — رفيق الدراسة (26.2). Registered users only. Shows any
 * incoming invitation (accept/decline inline), one quiet today-state card per
 * accepted buddy (up to 3), any outgoing pending, and — while under the cap —
 * the invite CTA. Encouraging phrases only, never a ranking.
 */
export function BuddyCard() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  // Buddy matching is same-gender (0015), so a female user's buddy is female.
  const fem = user?.gender === 'female';

  const { data: buddies, isLoading: buddiesLoading } = useMyBuddies({ enabled: !isGuest });
  const { data: incoming } = usePendingBuddyRequests({ enabled: !isGuest });
  const { data: outgoing } = useOutgoingPending({ enabled: !isGuest });
  const { data: streak } = useStreakStatus({ enabled: !isGuest });
  const respond = useRespondToRequest();

  if (isGuest || buddiesLoading) return null;

  const list = buddies ?? [];
  const invitation = (incoming ?? [])[0];
  const atCap = list.length >= MAX_BUDDIES;
  const meToday = streak?.todayCounted ?? false;

  return (
    <View>
      {/* Incoming invitation — accept / decline inline (still possible under cap). */}
      {invitation && !atCap ? (
        <Card style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Chip icon="mail" />
            <View style={{ flex: 1 }}>
              <Txt weight="display" size={15} color={colors.primaryTeal}>
                {fem
                  ? `دعتك ${invitation.fromDisplayName} لتكون رفيقتك في طلب العلم`
                  : `دعاك ${invitation.fromDisplayName} ليكون رفيقك في طلب العلم`}
              </Txt>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <Pressable
                  onPress={() => respond.mutate({ requestId: invitation.id, accept: true })}
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
                  onPress={() => respond.mutate({ requestId: invitation.id, accept: false })}
                  disabled={respond.isPending}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: radius.input,
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: colors.borderSand2,
                    opacity: pressed || respond.isPending ? 0.7 : 1,
                  })}
                >
                  <Txt size={13} weight="medium" color={colors.textMuted}>
                    اعتذار
                  </Txt>
                </Pressable>
              </View>
            </View>
          </View>
        </Card>
      ) : null}

      {/* One quiet today-state card per accepted buddy. */}
      {list.map((buddy) => (
        <ActiveBuddyRow key={buddy.buddyId} buddy={buddy} fem={fem} meToday={meToday} />
      ))}

      {/* My invitation is still out. */}
      {outgoing ? (
        <Card style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Chip icon="clock" />
            <View style={{ flex: 1 }}>
              <Txt weight="display" size={15.5} color={colors.primaryTeal}>
                طلبك قيد الانتظار
              </Txt>
              <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }}>
                دعوتك لرفيق الدراسة لم يُرَدّ عليها بعد
              </Txt>
            </View>
          </View>
        </Card>
      ) : null}

      {/* Invite CTA — only while under the 3-buddy cap. */}
      {!atCap ? (
        <Card style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Chip icon="users" />
            <View style={{ flex: 1 }}>
              <Txt weight="display" size={15.5} color={colors.primaryTeal}>
                {list.length > 0 ? 'يمكنك اختيار رفيق آخر' : 'يمكنك اختيار رفيق دراسة'}
              </Txt>
              <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }}>
                تواصيان معاً على طلب العلم
              </Txt>
            </View>
            <Pressable
              onPress={() => router.push('/(student)/buddy-search')}
              accessibilityRole="button"
              accessibilityLabel="اختر رفيقاً"
              style={({ pressed }) => ({
                paddingVertical: 9,
                paddingHorizontal: 14,
                borderRadius: radius.pill,
                backgroundColor: colors.primaryTeal,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Txt size={12.5} weight="semibold" color={colors.onTealPrimary}>
                اختر رفيقاً
              </Txt>
            </Pressable>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

function ActiveBuddyRow({
  buddy,
  fem,
  meToday,
}: {
  buddy: BuddyStatus;
  fem: boolean;
  meToday: boolean;
}) {
  const them = buddy.todayCounted;
  const phrase =
    meToday && them
      ? fem
        ? 'أنت ورفيقتك واصلتما اليوم، نفعكما الله'
        : 'أنت ورفيقك واصلتما اليوم، نفعكما الله'
      : !meToday && them
        ? fem
          ? 'رفيقتك واصلت اليوم، فلعلك تلحقين بها'
          : 'رفيقك واصل اليوم، فلعلك تلحق به'
        : meToday && !them
          ? fem
            ? 'واصلت اليوم، فلعل رفيقتك تلحق بك'
            : 'واصلت اليوم، فلعل رفيقك يلحق بك'
          : 'لم تواصلا بعد · ابدأ أنت أولاً';

  return (
    <Card style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Chip icon="users" />
        <View style={{ flex: 1 }}>
          <Txt weight="display" size={15.5} color={colors.primaryTeal}>
            {`${fem ? 'رفيقتك' : 'رفيقك'}: ${buddy.displayName}`}
          </Txt>
          <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }}>
            {phrase}
          </Txt>
        </View>
      </View>
    </Card>
  );
}

function Chip({ icon }: { icon: keyof typeof Feather.glyphMap }) {
  return (
    <View
      style={{
        width: 46,
        height: 46,
        borderRadius: 23,
        borderWidth: 2,
        borderColor: colors.accentBrass,
        backgroundColor: colors.primaryTeal,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Feather name={icon} size={20} color={colors.onTealPrimary} />
    </View>
  );
}
