import { useState } from 'react';
import { Platform, StatusBar, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';
import { IconButton, Logo, Txt } from '@/components/ui';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { useCurrentUser } from '@/hooks/useAuth';

/**
 * Home screen top bar — logo + full app name (with tashkeel) + subtitle, plus
 * the إرسال ملاحظة entry point on the visual left (2nd child in this RTL row,
 * see src/components/feedback/FeedbackSheet.tsx). Fixed/sticky: rendered
 * ABOVE Home's <Screen scroll> (which is passed `topInset={false}` so it
 * doesn't double-pad), so this owns the safe-area top inset itself and stays
 * pinned while the page content scrolls beneath it — same pattern as
 * Telegram/WhatsApp's chat-list header.
 *
 * The search/notifications/profile icons that used to live here have moved
 * to the bottom nav bar (see src/components/navigation/BottomNavBar.tsx).
 */
export function HomeHeader() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topInset =
    Platform.OS === 'android' ? Math.max(insets.top, StatusBar.currentHeight ?? 0) : insets.top;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;

  return (
    <View
      style={{
        backgroundColor: colors.bgSand,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSand,
        paddingTop: topInset + 2,
        paddingHorizontal: spacing.screenH,
        paddingBottom: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Right (RTL start): logo + title block */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
          <Logo size={40} />
          <View>
            {/* No custom lineHeight: Amiri's tashkeel marks (fatha/shadda/sukun)
                need more vertical room than a tight override leaves, or Android
                clips them — let the font's natural line height apply. */}
            <Txt weight="display" size={22} color={colors.primaryTeal}>
              المَحجّة البَيْضَاء
            </Txt>
            <Txt size={11} color={colors.textGhost} style={{ marginTop: -1, letterSpacing: 0.2 }}>
              مجالس الدروس الشرعية
            </Txt>
          </View>
        </View>

        {/* Left: تسجيل الدخول (guests only) + إرسال ملاحظة */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {isGuest ? (
            <IconButton
              icon="log-in"
              variant="ghost"
              onPress={() => router.push('/sign-in')}
              accessibilityLabel="تسجيل الدخول"
            />
          ) : null}
          <IconButton
            icon="message-circle"
            variant="ghost"
            onPress={() => setFeedbackOpen(true)}
            accessibilityLabel="إرسال ملاحظة"
          />
        </View>
      </View>

      <FeedbackSheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </View>
  );
}
