/**
 * Profile — الحساب
 *
 * The account + settings hub: identity card (avatar, name/email, role, edit link),
 * link rows (رحلتي العلمية · المحاضرات المحمّلة · عن المنصة · قيّم التطبيق ·
 * شارك التطبيق · سياسة الخصوصية · إعادة عرض الجولة التعريفية), notification
 * preference toggles, playback settings, floating-bubble consent, buddy settings,
 * then sign-out and permanent account deletion (App Store 5.1.1(v) path).
 * Guests see register nudges in place of account-only rows.
 *
 * Route: /(student)/profile
 * Design tokens: manuscript-warm palette, RTL, calm tone.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, Share, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter, Link } from 'expo-router';

import { useCurrentUser, useDeleteAccount, useSignOut } from '@/hooks/useAuth';
import { useUnreviewedBookmarkCount } from '@/hooks/useBookmarks';
import { toArabicDigits } from '@/lib/format';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useRefreshAll } from '@/hooks/useRefreshAll';
import { useHome } from '@/hooks/useSections';
import { useShareContent } from '@/hooks/useAppContent';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { useTourStore } from '@/stores/tourStore';
import { hasRated } from '@/lib/ratingPrompt';
import { colors, radius, shadows } from '@/constants/theme';
import { RatingPromptModal } from '@/components/rating/RatingPromptModal';

import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { IconButton } from '@/components/ui/IconButton';
import { Logo } from '@/components/ui/Logo';
import { Rhombus } from '@/components/ui/Rhombus';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { PrefsToggles } from '@/components/notifications/PrefsToggles';
import { PlaybackSettings } from '@/components/settings/PlaybackSettings';
import { BubbleConsent } from '@/components/settings/BubbleConsent';
import { BuddySettings } from '@/components/settings/BuddySettings';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** First character of the name (falling back to the email) for the avatar. */
function avatarInitial(source: string): string {
  return source.trim().charAt(0).toUpperCase();
}

// ── Link row ─────────────────────────────────────────────────────────────────

type LinkRowProps = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  /** Show an inline spinner and ignore taps while an action is in flight. */
  busy?: boolean;
};

function LinkRow({ icon, label, onPress, destructive = false, busy = false }: LinkRowProps) {
  const tint = destructive ? colors.stateDanger : colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        opacity: busy ? 0.6 : pressed ? 0.7 : 1,
        gap: 12,
      })}
    >
      {/* Icon on the right (RTL: first child appears rightmost) */}
      <Feather name={icon} size={18} color={tint} />

      {/* Label stretches to fill centre */}
      <Txt size={14} weight="medium" color={destructive ? colors.stateDanger : colors.textInk} style={{ flex: 1 }}>
        {label}
      </Txt>

      {/* Spinner while busy; otherwise the RTL nav chevron for non-destructive rows */}
      {busy ? (
        <ActivityIndicator size="small" color={tint} />
      ) : !destructive ? (
        <Feather name="chevron-left" size={16} color={colors.textGhost} />
      ) : null}
    </Pressable>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const { data: user, refetch: refetchUser } = useCurrentUser();
  const signOut = useSignOut();
  const deleteAccount = useDeleteAccount();

  // In-app account deletion (App Store 5.1.1(v)): a clear destructive confirm,
  // then the server-side delete; the app falls back to the device guest session
  // and lands on Home. Errors stay calm — nothing is deleted locally on failure.
  const confirmDeleteAccount = () => {
    Alert.alert(
      'حذف الحساب نهائيًا',
      'سيُحذف حسابك وجميع بياناتك — التقدم والملاحظات والأسئلة والإشعارات — حذفًا نهائيًا لا رجعة فيه. هل تريد المتابعة؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف الحساب',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount.mutateAsync();
              router.replace('/');
            } catch {
              Alert.alert('تعذّر حذف الحساب', 'حدث خطأ أثناء الحذف — حاول مرة أخرى لاحقًا.');
            }
          },
        },
      ],
    );
  };
  const { data: home, refetch: refetchHome } = useHome();
  const startTour = useTourStore((s) => s.start);
  const { data: shareContent } = useShareContent();

  const onShare = () => {
    const message = shareContent?.message || 'جرّب تطبيق المحجة البيضاء لدروس العلم الشرعي';
    const url = shareContent?.url || 'https://almahajja.app';
    void Share.share({ message: `${message}\n${url}` });
  };

  const miniPad = useMiniPlayerPad();
  const refreshAll = useRefreshAll();
  const { refreshing, onRefresh } = usePullToRefresh([refetchUser, refetchHome, refreshAll]);
  const [rated, setRated] = useState(true);
  const [ratingOpen, setRatingOpen] = useState(false);
  useEffect(() => {
    void hasRated().then(setRated);
  }, []);
  const isGuest = user?.isGuest ?? true;
  const unreviewedBookmarks = useUnreviewedBookmarkCount({ enabled: !isGuest });
  const email = user?.email ?? '';
  const name = user?.displayName?.trim() || '';
  const studentLabel = user?.gender === 'female' ? 'طالبة علم' : 'طالب علم';
  // The heading shows the NAME (not the email). Guests are simply "ضيف".
  const heading = name || (isGuest ? 'ضيف' : email || studentLabel);
  const roleLabel = user?.role === 'admin' ? 'مدير' : isGuest ? 'ضيف' : studentLabel;
  const avatarChar = name ? avatarInitial(name) : email ? avatarInitial(email) : '';

  return (
    <Screen
      bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}
      padded
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* ── Nav row ────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          الحساب
        </Txt>
        <IconButton
          icon="chevron-right"
          onPress={() => router.back()}
          accessibilityLabel="رجوع"
        />
      </View>

      {/* ── User identity card ───────────────────────────────────────────────── */}
      <Card style={[{ marginBottom: 16 }, shadows.feature]}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          {/* Avatar: brass-ring teal circle with the name initial overlaid */}
          <View
            style={{
              width: 68,
              height: 68,
              borderRadius: 34,
              borderWidth: 2,
              borderColor: colors.accentBrass,
              backgroundColor: colors.primaryTeal,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {avatarChar ? (
              <Txt size={26} weight="display" color={colors.onTealPrimary} align="center" centerGlyph>
                {avatarChar}
              </Txt>
            ) : (
              /* Guest with no name yet → calm rhombus, not an initial */
              <Rhombus size={22} color={colors.accentBrass} />
            )}
          </View>

          {/* Name (never the email) — guests have no name yet, so skip this line */}
          {!isGuest ? (
            <Txt size={18} weight="display" color={colors.primaryTeal} align="center">
              {heading}
            </Txt>
          ) : null}

          {/* Email only for registered users, quietly under the name */}
          {!isGuest && email ? (
            <Txt size={12.5} color={colors.textMuted} align="center" numberOfLines={1}>
              {email}
            </Txt>
          ) : null}

          {/* Role / guest pill */}
          <View
            style={{
              paddingHorizontal: 14,
              paddingVertical: 4,
              borderRadius: radius.pill,
              backgroundColor: 'rgba(31,74,66,0.09)',
              borderWidth: 1,
              borderColor: 'rgba(31,74,66,0.15)',
            }}
          >
            <Txt size={12} weight="semibold" color={colors.primaryTeal} align="center">
              {isGuest ? 'مرحبا بك يا طالب العلم' : roleLabel}
            </Txt>
          </View>

          {isGuest ? (
            /* Guests: a calm register CTA — the only thing gated is رحلتي العلمية */
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إنشاء حساب"
              onPress={() => router.push('/(auth)/register')}
              style={({ pressed }) => [
                {
                  marginTop: 6,
                  alignSelf: 'stretch',
                  backgroundColor: colors.primaryTeal,
                  borderRadius: radius.input,
                  paddingVertical: 12,
                  alignItems: 'center',
                  opacity: pressed ? 0.85 : 1,
                },
                shadows.button,
              ]}
            >
              <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
                سجّل لتتبّع رحلتك العلمية
              </Txt>
            </Pressable>
          ) : (
            /* Registered: edit name / email */
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تعديل الملف الشخصي"
              onPress={() => router.push('/(student)/edit-profile')}
              style={({ pressed }) => ({
                marginTop: 4,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Feather name="edit-2" size={13} color={colors.accentBrassMuted} />
              <Txt size={12.5} weight="medium" color={colors.accentBrassMuted}>
                تعديل الملف الشخصي
              </Txt>
            </Pressable>
          )}
        </View>
      </Card>

      {/* ── Links card ───────────────────────────────────────────────────────── */}
      <Card padded={false} style={{ overflow: 'hidden', marginBottom: 16 }}>
        <LinkRow
          icon="compass"
          label="رحلتي العلمية"
          onPress={() => router.push('/(student)/journey')}
        />
        {!isGuest ? (
          <>
            <Divider />
            <LinkRow
              icon="bookmark"
              label={
                unreviewedBookmarks > 0
                  ? `المراجعة لاحقًا — ${toArabicDigits(String(unreviewedBookmarks))}`
                  : 'المراجعة لاحقًا'
              }
              onPress={() => router.push('/(student)/bookmarks' as Parameters<typeof router.push>[0])}
            />
            <Divider />
            <LinkRow
              icon="users"
              label="رفقاء الرحلة"
              onPress={() =>
                router.push('/(student)/buddy-requests' as Parameters<typeof router.push>[0])
              }
            />
          </>
        ) : null}
        <Divider />
        <LinkRow
          icon="download"
          label="المحاضرات المحمّلة"
          onPress={() => router.push('/(student)/downloads')}
        />
        <Divider />
        <LinkRow
          icon="message-circle"
          label="تذاكري"
          onPress={() => router.push('/(student)/tickets' as Parameters<typeof router.push>[0])}
        />
        <Divider />
        <LinkRow
          icon="info"
          label="عن المنصة"
          onPress={() => router.push('/(student)/about')}
        />
        {!rated ? (
          <>
            <Divider />
            <LinkRow icon="star" label="قيّم التطبيق" onPress={() => setRatingOpen(true)} />
          </>
        ) : null}
        <Divider />
        <LinkRow icon="share-2" label="شارك التطبيق" onPress={onShare} />
        <Divider />
        <LinkRow
          icon="shield"
          label="سياسة الخصوصية"
          onPress={() => Linking.openURL('https://www.almahajja.app/Privacy')}
        />
        {!isGuest ? (
          <>
            <Divider />
            <LinkRow
              icon="navigation"
              label="إعادة عرض الجولة التعريفية"
              onPress={() => {
                startTour({
                  sectionId: home?.sections[0]?.id ?? null,
                  lectureId:
                    home?.continueListening?.id ??
                    home?.newlyAdded[0]?.id ??
                    home?.featured[0]?.id ??
                    null,
                });
                router.replace('/');
              }}
            />
          </>
        ) : null}
      </Card>

      {/* ── Playback settings (auto-advance) ─────────────────────────────────── */}
      <View style={{ marginBottom: 16 }}>
        <PlaybackSettings />
      </View>

      {/* ── Notification preferences (feature B) ─────────────────────────────── */}
      <View style={{ marginBottom: 16 }}>
        <PrefsToggles />
      </View>

      {/* ── Floating-bubble consent (Phase 9, hidden until linked) ───────────── */}
      <View style={{ marginBottom: 16 }}>
        <BubbleConsent />
      </View>

      {/* ── Study buddy (26.2) — cancel action, shown only while paired ──────── */}
      <View style={{ marginBottom: 16 }}>
        <BuddySettings />
      </View>

      {/* ── Sign-out card ────────────────────────────────────────────────────── */}
      {/* Guests have nothing to sign out of — doing so would orphan their (still
          unregistered) progress under a new anon account. Only registered users
          see it; after sign-out a fresh guest session boots automatically. */}
      {!isGuest ? (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          <LinkRow
            icon="log-out"
            label="تسجيل الخروج"
            busy={signOut.isPending}
            onPress={async () => {
              // Guard against a double-tap kicking off a second sign-out.
              if (signOut.isPending || deleteAccount.isPending) return;
              // Drop the registered session, then land on the login page (a fresh
              // guest session boots behind it). mutateAsync so navigation waits for
              // the session flip; errors still clear the session locally.
              try {
                await signOut.mutateAsync();
              } catch {
                // Session is cleared locally even on server errors.
              }
              router.replace('/sign-in');
            }}
            destructive
          />
          <Divider />
          <LinkRow
            icon="trash-2"
            label="حذف الحساب نهائيًا"
            busy={deleteAccount.isPending}
            onPress={confirmDeleteAccount}
            destructive
          />
        </Card>
      ) : null}

      {/* Blocking overlay while signing out / deleting: a spinner covers the whole
          screen so the user can't tap anything (or trigger it twice) until the
          session flip completes — the auth calls are now time-bounded, so this
          can never wedge (see withAuthTimeout in src/api/auth.ts). */}
      <Modal visible={signOut.isPending || deleteAccount.isPending} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: colors.surfaceWhite,
              borderRadius: radius.card,
              paddingVertical: 24,
              paddingHorizontal: 32,
              alignItems: 'center',
              gap: 14,
              ...shadows.feature,
            }}
          >
            <ActivityIndicator size="large" color={colors.primaryTeal} />
            <Txt size={13.5} weight="medium" color={colors.textInk}>
              {deleteAccount.isPending ? 'جارٍ حذف الحساب…' : 'جارٍ تسجيل الخروج…'}
            </Txt>
          </View>
        </View>
      </Modal>

      <RatingPromptModal
        visible={ratingOpen}
        onClose={() => {
          setRatingOpen(false);
          void hasRated().then(setRated);
        }}
      />
    </Screen>
  );
}
