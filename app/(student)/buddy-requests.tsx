/**
 * Buddy requests — طلبات رفيق الدراسة (item 1).
 *
 * A dedicated management page for رفيق الدراسة invitations, reachable from the
 * buddy-request notification tap (send_buddy_request / respond_buddy_request now
 * carry `data.route = '/(student)/buddy-requests'`) and from the Home BuddyCard.
 * Shows every INCOMING invitation with accept/decline (قبول/اعتذار) and every
 * pending OUTGOING invitation with withdraw (سحب الدعوة) — the same server
 * actions the Home card uses, reusing the same hooks so the two stay in sync.
 *
 * Guests are nudged to register (buddy pairing needs a real account). Under the
 * cap, an «اختر رفيقاً» CTA leads to buddy-search. Calm, non-competitive tone.
 *
 * Route: /(student)/buddy-requests
 */
import { Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';

import { MAX_BUDDIES } from '@/api/buddy';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { colors, radius, shadows } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import {
  useCancelBuddyRequest,
  useMyBuddies,
  useOutgoingRequests,
  usePendingBuddyRequests,
  useRespondToRequest,
} from '@/hooks/useBuddy';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

export default function BuddyRequestsScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  // Buddy matching is same-gender (0015): a female user's invitations are female.
  const fem = user?.gender === 'female';
  const miniPad = useMiniPlayerPad();

  const { data: buddies } = useMyBuddies({ enabled: !isGuest });
  const { data: incoming } = usePendingBuddyRequests({ enabled: !isGuest });
  const { data: outgoing } = useOutgoingRequests({ enabled: !isGuest });
  const respond = useRespondToRequest();
  const cancelReq = useCancelBuddyRequest();

  const list = buddies ?? [];
  const incomingList = incoming ?? [];
  const outgoingList = outgoing ?? [];
  const atCap = list.length >= MAX_BUDDIES;
  const remaining = Math.max(0, MAX_BUDDIES - list.length - outgoingList.length);
  const nothing = incomingList.length === 0 && outgoingList.length === 0;

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded>
      {/* ── Nav row ─────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 22,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          طلبات رفيق الدراسة
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      {isGuest ? (
        <Card style={{ alignItems: 'center', paddingVertical: 26, gap: 12 }}>
          <Feather name="user-plus" size={26} color={colors.accentBrassMuted} />
          <Txt size={14} color={colors.textSlate} align="center" style={{ lineHeight: 22 }}>
            رفيق الدراسة يتطلب حسابًا — حتى تبقى الرفقة معك
          </Txt>
          <Pressable
            onPress={() => router.push('/(auth)/register')}
            accessibilityRole="button"
            style={({ pressed }) => [
              {
                backgroundColor: colors.primaryTeal,
                borderRadius: radius.input,
                paddingVertical: 12,
                paddingHorizontal: 26,
                opacity: pressed ? 0.85 : 1,
              },
              shadows.button,
            ]}
          >
            <Txt size={14} weight="semibold" color={colors.onTealPrimary}>
              إنشاء حساب
            </Txt>
          </Pressable>
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          {/* ── Incoming invitations — accept / decline ─────────────────────── */}
          {incomingList.map((invitation) => (
            <Card key={invitation.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Chip icon="mail" />
                <View style={{ flex: 1 }}>
                  <Txt weight="display" size={15} color={colors.primaryTeal}>
                    {fem
                      ? `دعتك ${invitation.fromDisplayName} لتكوني رفيقتها في طلب العلم`
                      : `دعاك ${invitation.fromDisplayName} ليكون رفيقك في طلب العلم`}
                  </Txt>
                  {atCap ? (
                    <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 6 }}>
                      {`لديك بالفعل ${arCap()} رفقاء — اعتذر عن أحد الطلبات أو أنهِ رفقة لقبول هذه الدعوة`}
                    </Txt>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                      <Pressable
                        onPress={() =>
                          respond.mutate({ requestId: invitation.id, accept: true })
                        }
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
                        onPress={() =>
                          respond.mutate({ requestId: invitation.id, accept: false })
                        }
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
                  )}
                </View>
              </View>
            </Card>
          ))}

          {/* ── My pending outgoing invitations — each withdrawable ─────────── */}
          {outgoingList.map((req) => (
            <Card key={req.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Chip icon="clock" />
                <View style={{ flex: 1 }}>
                  <Txt weight="display" size={15} color={colors.primaryTeal}>
                    {`دعوتك إلى ${req.toDisplayName} قيد الانتظار`}
                  </Txt>
                  <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }}>
                    لم يُرَدّ عليها بعد
                  </Txt>
                </View>
                <Pressable
                  onPress={() => cancelReq.mutate(req.id)}
                  disabled={cancelReq.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`سحب الدعوة إلى ${req.toDisplayName}`}
                  style={({ pressed }) => ({
                    paddingVertical: 9,
                    paddingHorizontal: 14,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: colors.borderSand2,
                    opacity: pressed || cancelReq.isPending ? 0.6 : 1,
                  })}
                >
                  <Txt size={12.5} weight="semibold" color={colors.textMuted}>
                    سحب الدعوة
                  </Txt>
                </Pressable>
              </View>
            </Card>
          ))}

          {/* ── Empty state ─────────────────────────────────────────────────── */}
          {nothing ? (
            <Card style={{ alignItems: 'center', paddingVertical: 26, gap: 10 }}>
              <Feather name="users" size={26} color={colors.accentBrassMuted} />
              <Txt size={14} color={colors.textSlate} align="center" style={{ lineHeight: 22 }}>
                لا توجد طلبات حاليًا
              </Txt>
            </Card>
          ) : null}

          {/* ── Invite CTA — only while under the cap ───────────────────────── */}
          {!atCap && remaining > 0 ? (
            <Pressable
              onPress={() => router.push('/(student)/buddy-search')}
              accessibilityRole="button"
              accessibilityLabel="اختر رفيقاً"
              style={({ pressed }) => [
                {
                  backgroundColor: colors.primaryTeal,
                  borderRadius: radius.input,
                  paddingVertical: 13,
                  alignItems: 'center',
                  opacity: pressed ? 0.85 : 1,
                },
                shadows.button,
              ]}
            >
              <Txt size={14} weight="semibold" color={colors.onTealPrimary}>
                اختر رفيقاً
              </Txt>
            </Pressable>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

/** Localised cap count for the at-cap notice. */
function arCap(): string {
  return String(MAX_BUDDIES).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
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
