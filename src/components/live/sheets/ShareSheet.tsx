/**
 * «مشاركة رابط البث» (PLAN_LIVE_V23 §9.3, §15 share, D8) — opened from the
 * room's top bar. Shows the public link https://go.almahajja.app/live/{code}
 * and hands the §9.3 message to the system share sheet: whoever has the app
 * enters the room (App Links / Universal Links), whoever doesn't lands on the
 * go.almahajja.app fallback page and is sent to their store.
 *
 * For a registered listener with buddies it also offers «ادعُ رفيقك إلى الحلقة»
 * (→ BuddyInviteSheet, §9.2). The body only mounts while the sheet is open, so
 * the room itself never runs the buddy query.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useMyBuddies } from '@/hooks/useBuddy';
import {
  LIVE_P5_COPY,
  inviteSheetTitle,
  liveShareLink,
  liveShareMessage,
  type Sex,
} from '../liveUi';
import { LiveSheet } from './LiveSheet';
import { SheetButton } from './sheetParts';

export type ShareSession = {
  title: string;
  sectionTitle?: string | null;
  sheikhName?: string | null;
  shareCode: string;
};

export function ShareSheet({
  visible,
  onClose,
  session,
  canInvite = false,
  gender = 'm',
  onInvite,
}: {
  visible: boolean;
  onClose: () => void;
  session: ShareSession | null;
  /** A registered (non-guest) user — guests have no buddies. */
  canInvite?: boolean;
  /** The viewer's gender (buddies are same-gender): «ادعُ رفيقك» / «ادعي رفيقتك». */
  gender?: Sex;
  /** Opens BuddyInviteSheet (the caller swaps the sheets). */
  onInvite?: () => void;
}) {
  return (
    <LiveSheet visible={visible} onClose={onClose} title={LIVE_P5_COPY.share} sub={LIVE_P5_COPY.shareExplain}>
      {session ? (
        <ShareBody
          session={session}
          onClose={onClose}
          canInvite={canInvite && !!onInvite}
          gender={gender}
          onInvite={onInvite}
        />
      ) : null}
    </LiveSheet>
  );
}

function ShareBody({
  session,
  onClose,
  canInvite,
  gender,
  onInvite,
}: {
  session: ShareSession;
  onClose: () => void;
  canInvite: boolean;
  gender: Sex;
  onInvite?: () => void;
}) {
  const link = liveShareLink(session.shareCode);
  const { data: buddies } = useMyBuddies({ enabled: canInvite });
  const hasBuddies = canInvite && (buddies?.length ?? 0) > 0;
  const [busy, setBusy] = useState(false);

  const share = () => {
    setBusy(true);
    Share.share(
      { message: liveShareMessage(session, link) },
      { dialogTitle: LIVE_P5_COPY.share, subject: session.title },
    )
      .then((r) => {
        if (r?.action === Share.sharedAction) onClose();
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <View>
      {/* The link itself — LTR, selectable, so it can be copied by long-press. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: radius.input + 4,
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor: colors.borderSand,
        }}
      >
        <Feather name="link-2" size={16} color={colors.accentBrassMuted} />
        <Txt
          size={13.5}
          color={colors.textSlate}
          selectable
          numberOfLines={1}
          accessibilityLabel={link}
          style={{ flex: 1, writingDirection: 'ltr' }}
        >
          {link.replace(/^https:\/\//, '')}
        </Txt>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <SheetButton label={LIVE_P5_COPY.shareAction} tone="primary" onPress={share} busy={busy} />
      </View>

      {hasBuddies ? (
        <Pressable
          onPress={onInvite}
          accessibilityRole="button"
          accessibilityLabel={inviteSheetTitle(gender)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            marginTop: 14,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: radius.input + 4,
            backgroundColor: colors.surfaceInset,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Feather name="user-plus" size={17} color={colors.primaryTeal} />
          <Txt size={14} weight="medium" color={colors.primaryTeal} style={{ flex: 1 }}>
            {inviteSheetTitle(gender)}
          </Txt>
          <Feather name="chevron-left" size={17} color={colors.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}
