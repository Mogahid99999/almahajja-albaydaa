import { Amiri_400Regular, Amiri_700Bold } from '@expo-google-fonts/amiri';
import {
  IBMPlexSansArabic_300Light,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, I18nManager, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { registerPushToken } from '@/api/notifications';
import { useCurrentUser } from '@/hooks/useAuth';
import { colors } from '@/constants/theme';
import {
  addResponseListener,
  configureNotificationHandler,
  ensurePermission,
  getToken,
} from '@/lib/notifications';
import { queryClient } from '@/lib/queryClient';
import { useNotificationsStore } from '@/stores/notificationsStore';

// Arabic-first: force RTL across the whole app.
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

/** Redirects between the auth flow and the app based on session + role. */
function AuthGate() {
  const { data: user, isLoading } = useCurrentUser();
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();

  useEffect(() => {
    // Wait until the root navigator is mounted before redirecting, otherwise
    // expo-router warns about updating navigation state too early.
    if (!navState?.key || isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!user) {
      if (!inAuth) router.replace('/sign-in');
      return;
    }
    if (inAuth) router.replace(user.role === 'admin' ? '/admin' : '/');
  }, [user, isLoading, segments, router, navState?.key]);

  return null;
}

/**
 * Notifications bootstrap (Phase 2 · feature B): set the foreground handler,
 * resolve permission + the Expo push token (registering it once), and deep-link
 * notification taps via Expo Router. Everything here no-ops on web / simulator /
 * mock so emulator testing never blocks. Renders nothing.
 */
function NotificationsBootstrap() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const setPermission = useNotificationsStore((s) => s.setPermission);
  const setToken = useNotificationsStore((s) => s.setToken);
  const setRegistered = useNotificationsStore((s) => s.setRegistered);
  const registered = useNotificationsStore((s) => s.registered);

  // Foreground presentation handler — set once, independent of auth.
  useEffect(() => {
    configureNotificationHandler();
  }, []);

  // Permission + token registration, once we have a signed-in user.
  useEffect(() => {
    if (!user || registered) return;
    let cancelled = false;
    (async () => {
      const status = await ensurePermission();
      if (cancelled) return;
      setPermission(status as 'granted' | 'denied' | 'undetermined');
      if (status !== 'granted') return;
      const token = await getToken();
      if (cancelled || !token) return;
      setToken(token);
      try {
        await registerPushToken(token, 'android');
        if (!cancelled) setRegistered(true);
      } catch {
        // Registration failure is non-fatal — the inbox still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, registered, setPermission, setToken, setRegistered]);

  // Deep-link notification taps (lecture → player, section → section page).
  useEffect(() => {
    return addResponseListener((data) => {
      if (data.lectureId) router.push(`/player/${data.lectureId}`);
      else if (data.sectionId) router.push(`/(student)/section/${data.sectionId}`);
    });
  }, [router]);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Amiri_400Regular,
    Amiri_700Bold,
    IBMPlexSansArabic_300Light,
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bgSand,
        }}
      >
        <ActivityIndicator color={colors.primaryTeal} />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthGate />
        <NotificationsBootstrap />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bgSand },
          }}
        >
          {/* Full-screen player presented modally over the student app. */}
          <Stack.Screen name="player/[id]" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
