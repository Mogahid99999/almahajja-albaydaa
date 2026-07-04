import { Amiri_400Regular, Amiri_700Bold } from '@expo-google-fonts/amiri';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, I18nManager, Platform, View } from 'react-native';
import RNRestart from 'react-native-restart';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getNotificationPrefs, registerPushToken, touchLastOpened } from '@/api/notifications';
import { getResumeTarget, hasResumableLesson } from '@/api/progress';
import { useCurrentUser, useEnsureSession } from '@/hooks/useAuth';
import { Logo } from '@/components/ui/Logo';
import { UpdateGate } from '@/components/UpdateGate';
import { colors } from '@/constants/theme';
import {
  addResponseListener,
  cancelDailyReminder,
  clearBadge,
  configureNotificationHandler,
  ensurePermission,
  getInitialDeepLink,
  getToken,
  NEAR_COMPLETION_PCT,
  RESUME_LONGGAP_HOURS,
  scheduleDailyReminder,
} from '@/lib/notifications';
import { pickPhrase } from '@/lib/notificationPhrases';
import { recordAppOpen } from '@/lib/notificationState';
import { addBubbleListeners, bubbleEligibleNow, maybeShowResumeBubble } from '@/lib/bubble';
import { NOTIF_TEST_MODE } from '@/config';
import { useSettingsStore } from '@/stores/settingsStore';
import { queryClient } from '@/lib/queryClient';
import { useNotificationsStore } from '@/stores/notificationsStore';

// Arabic-first: force RTL across the whole app — even when the phone's language
// is English (Task 6). `forceRTL` only takes effect after a reload, so on the
// FIRST launch where the layout isn't RTL yet (a fresh install on a non-RTL
// locale) we restart ONCE to apply it. `isRTL` is true on every launch afterwards
// (the pref persists natively), so this never loops. Web can't restart and is LTR
// admin-only, so it's skipped there.
// On Android this is also enforced natively in MainApplication.kt (before the
// first frame), so the restart below never fires there; it remains as the iOS
// fallback. swapLeftAndRightInRTL(false) keeps left/right styles PHYSICAL in
// RTL (textAlign 'right' means the right edge, absolute right:0 means the right
// edge) — without it RN mirrors them and every text lands on the left.
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);
I18nManager.swapLeftAndRightInRTL(false);
if (Platform.OS !== 'web' && !I18nManager.isRTL) {
  RNRestart.restart();
}

/** Calm branded opening screen — the logo over the sand background, with a quiet
 *  spinner beneath. Shown while fonts load and while the session is established,
 *  so the app opens on the brand (Task 8). */
function BootLoader() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bgSand,
        gap: 28,
      }}
    >
      <Logo size={88} />
      <ActivityIndicator color={colors.primaryTeal} />
    </View>
  );
}

/**
 * Guest-first boot gate (Task 1). Every install has a session — a silent
 * anonymous one is created on boot when none exists. We hold the app behind a
 * calm loader until that session is ready, so screens mount WITH an
 * authenticated session; otherwise their first data reads race ahead of the anon
 * sign-in and RLS (policies are `to authenticated`) returns empty — Home would
 * flash blank until the next launch. There is NO login-first gate: once ready,
 * Home is the entry point for everyone.
 */
function SessionGate({
  fontsLoaded,
  children,
}: {
  fontsLoaded: boolean;
  children: ReactNode;
}) {
  const { data: user, isLoading } = useCurrentUser();
  const ensure = useEnsureSession();
  const bootedRef = useRef(false);

  useEffect(() => {
    // Web is the admin dashboard, not the guest student app — never create a
    // silent anonymous session there; admins sign in explicitly (AuthGate routes
    // an unauthenticated web visitor to /sign-in).
    if (Platform.OS === 'web') return;
    if (isLoading || user || bootedRef.current) return;
    bootedRef.current = true;
    ensure.mutate();
  }, [isLoading, user, ensure]);

  // Ready once we have a session; if the anon sign-in fails (e.g. offline on a
  // brand-new install) fall through anyway so the app is never stuck on a loader.
  // On web there's no silent session, so readiness is just "auth check finished".
  // Combined with fontsLoaded (not gated separately beforehand) so the anon
  // sign-in network round-trip and the font load happen in PARALLEL — total
  // boot time is max(fonts, session), not fonts-then-session (P5 perf plan).
  const sessionReady = Platform.OS === 'web' ? !isLoading : !!user || ensure.isError;
  if (!fontsLoaded || !sessionReady) return <BootLoader />;
  return <>{children}</>;
}

/**
 * Role routing. By the time this renders a session always exists (SessionGate).
 * Steers admins into /admin and keeps non-admins out of it; the (auth) screens
 * stay reachable so a guest can register and a returning user can sign in. The
 * modal player / attachment routes are left alone.
 */
function AuthGate() {
  const { data: user } = useCurrentUser();
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();

  useEffect(() => {
    // Wait until the root navigator is mounted before redirecting, otherwise
    // expo-router warns about updating navigation state too early.
    if (!navState?.key) return;
    const inAdmin = segments[0] === 'admin';
    const inAuth = segments[0] === '(auth)';
    const inSheikh = segments[0] === 'sheikh';

    // A publisher (ناشر) is content staff — routed into the admin panel like an
    // admin, but their landing is /admin/lectures (no dashboard) and the shell
    // hides admin-only sections. A sheikh (شيخ) lives in /sheikh (the questions
    // inbox) — never in /admin and never in the student tabs.
    const isStaff = user?.role === 'admin' || user?.role === 'publisher';
    const isSheikh = user?.role === 'sheikh';
    const staffHome = user?.role === 'publisher' ? '/admin/lectures' : '/admin';

    // Web is the admin dashboard (CLAUDE.md): require a real (non-guest) staff
    // session, otherwise steer to sign-in. There is no silent guest on web.
    // A real sheikh login may reach /sheikh on web too.
    if (Platform.OS === 'web') {
      if (isSheikh && !user!.isGuest) {
        if (!inSheikh) router.replace('/sheikh' as Parameters<typeof router.replace>[0]);
      } else if (isStaff && !user!.isGuest) {
        if (!inAdmin) router.replace(staffHome);
      } else if (!inAuth) {
        router.replace('/sign-in');
      }
      return;
    }

    // Native: guest-first student app. Steer staff into /admin, sheikhs into
    // /sheikh, others out of both; the (auth) screens stay reachable so a guest
    // can register / sign in.
    if (!user) return;
    if (isSheikh) {
      if (!inSheikh) router.replace('/sheikh' as Parameters<typeof router.replace>[0]);
    } else if (isStaff) {
      if (!inAdmin) router.replace(staffHome);
    } else if (inAdmin || inSheikh) {
      router.replace('/');
    }
  }, [user, segments, router, navState?.key]);

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
  // Handles BOTH a warm tap (listener) and the cold-start tap that launched the
  // app from a killed state (getInitialDeepLink, consumed once on mount).
  useEffect(() => {
    const deepLink = (data: {
      lectureId?: string;
      sectionId?: string;
      positionSec?: number;
      route?: string;
    }) => {
      if (data.lectureId) {
        // Carry the paused second so the player opens at the exact position (§8).
        const t =
          typeof data.positionSec === 'number' && data.positionSec > 0
            ? `?t=${Math.round(data.positionSec)}`
            : '';
        router.push(`/player/${data.lectureId}${t}`);
      } else if (data.sectionId) {
        router.push(`/(student)/section/${data.sectionId}`);
      } else if (data.route) {
        // e.g. weekly-goal nudge → رحلتي العلمية.
        router.push(data.route as Parameters<typeof router.push>[0]);
      }
    };
    let handled = false;
    void getInitialDeepLink().then((data) => {
      if (data && !handled) {
        handled = true;
        deepLink(data);
      }
    });
    return addResponseListener((data) => {
      handled = true;
      deepLink(data);
    });
  }, [router]);

  // App-open hook: record the open (resets the daily dead-man's-switch) and
  // re-arm/cancel the daily reminder per its pref on every foreground. Runs once
  // on mount (cold start counts as an open) and on each AppState → active.
  useEffect(() => {
    if (!user) return;
    const onActive = () => {
      void recordAppOpen();
      void clearBadge(); // reset the launcher "new lessons" count on open (Issue 8)
      void touchLastOpened(); // server stamp for the weekly-goal cron
      void (async () => {
        try {
          // §7 priority dispatcher (resume > weekly-goal > daily): the daily
          // remembrance is lowest priority, so it defers whenever a resume nudge
          // is the relevant one (an in-progress lesson exists). The weekly-goal
          // midweek/2-days nudges are cron-push with their own once-per-week
          // dedup, so they're coordinated server-side.
          const [prefs, hasResume] = await Promise.all([
            getNotificationPrefs(),
            hasResumableLesson(),
          ]);
          if (prefs.daily_reminder && !hasResume) await scheduleDailyReminder();
          else await cancelDailyReminder();
        } catch {
          // Non-fatal — a missed re-arm never blocks the app.
        }
      })();
    };
    onActive();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') onActive();
    });
    return () => sub.remove();
  }, [user]);

  // Floating bubble (Phase 9, experimental, flag-gated): on the native unlock
  // trigger, surface a resume bubble over other apps if eligible; a tap opens
  // the player at the paused second. No-ops entirely until the native module is
  // linked + consent given (bubbleEligibleNow gates everything).
  useEffect(() => {
    if (!user) return;
    const tryShow = () => {
      void (async () => {
        const consentOn =
          useSettingsStore.getState().bubbleConsent || NOTIF_TEST_MODE;
        if (!(await bubbleEligibleNow(consentOn))) return;
        const target = await getResumeTarget();
        if (!target) return;
        // Show a calm resume PHRASE (not the lesson title), picked by the same
        // variant logic as the reminder ladder: long-gap (>3 days idle) wins,
        // else near-completion (>70% listened) vs general. Reuses the shared
        // phrase banks so wording has one home.
        const daysIdle =
          (Date.now() - new Date(target.updatedAt).getTime()) / (24 * 60 * 60 * 1000);
        const fraction =
          target.durationSec > 0 ? target.positionSec / target.durationSec : 0;
        const variant =
          daysIdle > RESUME_LONGGAP_HOURS / 24
            ? 'resume_longgap'
            : fraction > NEAR_COMPLETION_PCT
              ? 'resume_near'
              : 'resume_general';
        await maybeShowResumeBubble({
          consentOn,
          lessonId: target.lectureId,
          positionSec: target.positionSec,
          text: await pickPhrase(variant),
        });
      })();
    };
    const removeNative = addBubbleListeners({
      onUserPresent: tryShow,
      onBubbleTap: (data) => {
        if (!data.lessonId) return;
        const t =
          typeof data.positionSec === 'number' && data.positionSec > 0
            ? `?t=${Math.round(data.positionSec)}`
            : '';
        router.push(`/player/${data.lessonId}${t}`);
      },
    });
    // Usage moments: the unlock (onUserPresent) AND app→background (the student
    // left the app to use the phone) both try to surface the bubble. The latter
    // is the reliable trigger (ACTION_USER_PRESENT needs a keyguard); the ≤3/day
    // cap + ≥2h gap keep it calm. eligibility no-ops everything when off.
    const bgSub = AppState.addEventListener('change', (s) => {
      if (s === 'background') tryShow();
    });
    return () => {
      removeNative();
      bgSub.remove();
    };
  }, [user, router]);

  return null;
}

export default function RootLayout() {
  // Not an early return before the provider tree (P5 perf plan): mounting
  // QueryClientProvider unconditionally lets SessionGate's anon sign-in kick
  // off immediately, in parallel with the font load, instead of waiting for
  // fonts to resolve first.
  const [fontsLoaded] = useFonts({
    Amiri_400Regular,
    Amiri_700Bold,
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <SessionGate fontsLoaded={fontsLoaded}>
          <UpdateGate>
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
          </UpdateGate>
        </SessionGate>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
