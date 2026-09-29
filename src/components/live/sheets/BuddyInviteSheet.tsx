/**
 * «ادعُ رفيقك إلى الحلقة» (PLAN_LIVE_V23 §9.2, §15 buddy) — a registered
 * listener invites an accepted buddy who is not in the room.
 *
 * One row per buddy (get_buddies_status, up to 3):
 *   - in the room now (get_live_buddies_present, 0142 — only MY buddies, never a
 *     sister who chose «بدون اسم»)  → highlighted «رفيقك · حسن» · «في الحلقة»;
 *   - already invited to THIS session → «أُرسلت الدعوة إلى حسن», disabled;
 *   - otherwise → «رفيقك حسن ليس في الحلقة» + «ادعُه» (invite_buddy_to_live).
 * Once per buddy per session is enforced by the server (live_buddy_invites PK);
 * a repeat comes back 'already' and is shown as sent. Buddies are same-gender,
 * so the viewer's gender words everything (رفيقك/رفيقتك, ادعُه/ادعيها).
 * Guests never get here (no buddies; the entry is hidden for them).
 * The body only mounts while the sheet is open.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import type { BuddyStatus } from '@/api/types';
import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useMyBuddies } from '@/hooks/useBuddy';
import { useInviteBuddyToLive, useLiveBuddiesPresent, useLiveInvited } from '@/hooks/useLive';
import { LiveAvatar } from '../LiveAvatar';
import {
  LIVE_P5_COPY,
  buddyAbsentLine,
  buddyPresentLine,
  inviteSentLine,
  inviteSheetSub,
  inviteSheetTitle,
  inviteVerb,
  rpcErrorText,
  type Sex,
} from '../liveUi';
import { LiveSheet } from './LiveSheet';
import { SheetError } from './sheetParts';

export function BuddyInviteSheet({
  visible,
  onClose,
  sessionId,
  gender,
  presentIdentities,
}: {
  visible: boolean;
  onClose: () => void;
  sessionId: string | null;
  /** The viewer's gender — their buddies share it. */
  gender: Sex;
  /**
   * LiveKit identities in the room right now (liveStore `people` keys). When
   * given, a buddy the server still lists as present but who already left the
   * room reads as absent.
   */
  presentIdentities?: ReadonlySet<string> | null;
}) {
  return (
    <LiveSheet
      visible={visible}
      onClose={onClose}
      title={inviteSheetTitle(gender)}
      sub={inviteSheetSub(gender)}
      maxHeightRatio={0.82}
    >
      {sessionId ? (
        <InviteBody sessionId={sessionId} gender={gender} presentIdentities={presentIdentities ?? null} />
      ) : null}
    </LiveSheet>
  );
}

function InviteBody({
  sessionId,
  gender,
  presentIdentities,
}: {
  sessionId: string;
  gender: Sex;
  presentIdentities: ReadonlySet<string> | null;
}) {
  const buddiesQ = useMyBuddies();
  const presentQ = useLiveBuddiesPresent(sessionId, true);
  const invitedQ = useLiveInvited(sessionId, true);
  const invite = useInviteBuddyToLive(sessionId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const buddies: readonly BuddyStatus[] = buddiesQ.data ?? [];
  const present = new Set(
    (presentQ.data ?? [])
      .filter((b) => !presentIdentities || presentIdentities.has(b.identity))
      .map((b) => b.buddyId),
  );
  const invited = new Set([...(invitedQ.data ?? []), ...sent]);

  const onInvite = (buddyId: string) => {
    if (busyId) return;
    setBusyId(buddyId);
    setError(null);
    invite.mutate(buddyId, {
      onSuccess: () => setSent((s) => new Set(s).add(buddyId)),
      onError: (e: unknown) => setError(rpcErrorText(e, LIVE_P5_COPY.inviteFailed)),
      onSettled: () => setBusyId(null),
    });
  };

  if (buddiesQ.isLoading && !buddiesQ.data) {
    return (
      <View style={{ paddingVertical: 24, alignItems: 'center' }}>
        <ActivityIndicator color={colors.primaryTeal} />
      </View>
    );
  }

  if (!buddies.length) {
    return (
      <Txt size={13.5} color={colors.textMuted} style={{ lineHeight: 24, paddingVertical: 8 }}>
        {gender === 'f' ? 'لم تتخذي رفيقة في طلب العلم بعد.' : 'لم تتخذ رفيقاً في طلب العلم بعد.'}
      </Txt>
    );
  }

  return (
    <View>
      {buddies.map((b, i) => {
        const name = b.displayName;
        const isHere = present.has(b.buddyId);
        const wasInvited = invited.has(b.buddyId);
        const busy = busyId === b.buddyId;
        return (
          <View
            key={b.buddyId}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 12,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.borderSand,
            }}
          >
            <LiveAvatar gender={gender} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              {isHere ? (
                <>
                  <Txt size={14.5} weight="semibold" color={colors.primaryTeal} numberOfLines={1}>
                    {buddyPresentLine(name, gender)}
                  </Txt>
                  <Txt size={12} color={colors.textFaint}>
                    في الحلقة
                  </Txt>
                </>
              ) : wasInvited ? (
                <Txt size={13.5} weight="medium" color={colors.primaryTeal} numberOfLines={2} style={{ lineHeight: 22 }}>
                  {inviteSentLine(name)}
                </Txt>
              ) : (
                <Txt size={13.5} color={colors.textSlate} numberOfLines={2} style={{ lineHeight: 22 }}>
                  {buddyAbsentLine(name, gender)}
                </Txt>
              )}
            </View>
            {isHere ? (
              <Feather name="check-circle" size={18} color={colors.primaryTeal} />
            ) : (
              <Pressable
                onPress={wasInvited || busy ? undefined : () => onInvite(b.buddyId)}
                disabled={wasInvited || busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: wasInvited || busy, busy }}
                accessibilityLabel={
                  wasInvited ? inviteSentLine(name) : `${buddyAbsentLine(name, gender)} · ${inviteVerb(gender)}`
                }
                style={({ pressed }) => ({
                  minWidth: 76,
                  height: 38,
                  paddingHorizontal: 14,
                  borderRadius: radius.pill,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: wasInvited ? colors.surfaceInset : colors.primaryTeal,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.onTealPrimary} />
                ) : wasInvited ? (
                  <Feather name="check" size={15} color={colors.textFaint} />
                ) : (
                  <Txt size={13.5} weight="semibold" color={colors.onTealPrimary}>
                    {inviteVerb(gender)}
                  </Txt>
                )}
              </Pressable>
            )}
          </View>
        );
      })}
      <SheetError text={error} />
    </View>
  );
}
