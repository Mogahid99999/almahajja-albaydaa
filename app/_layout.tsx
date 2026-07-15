// Import each weight from its direct submodule, NOT the package index. Each
// index does `export const X = require('./X.ttf')` for EVERY weight, and Metro
// can't tree-shake those CommonJS side-effect requires — so importing from the
// index bundles all 4 Amiri + all 7 IBM Plex weights (~1.5MB of unused fonts).
// Direct submodule paths pull only the weights this app registers below.
import { Amiri_400Regular } from '@expo-google-fonts/amiri/400Regular';
import { Amiri_700Bold } from '@expo-google-fonts/amiri/700Bold';
import { IBMPlexSansArabic_400Regular } from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular';
import { IBMPlexSansArabic_500Medium } from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold';
import { IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic/700Bold';
import type { Query } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFonts } from 'expo-font';
import {
  Stack,
  useRootNavigationState,
  useRouter,
  useSegments,
  type ErrorBoundaryProps,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  I18nManager,
  LogBox,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import RNRestart from 'react-native-restart';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { checkBannedAndSignOut } from '@/api/auth';
import { isLectureVisibleToViewer } from '@/api/lectures';
import { getNotificationPrefs, registerPushToken, touchLastOpened } from '@/api/notifications';
import { getResumeTarget, hasResumableLesson } from '@/api/progress';
import { useCurrentUser, useEnsureSession } from '@/hooks/useAuth';
import { Logo } from '@/components/ui/Logo';
import { StartHereCard } from '@/components/onboarding/StartHereCard';
import { TourCard } from '@/components/onboarding/TourCard';
import { UpdateGate } from '@/components/UpdateGate';
import { colors, radius } from '@/constants/theme';
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
import { addForegroundSeconds, shouldShowRatingPrompt } from '@/lib/ratingPrompt';
import { RatingPromptModal } from '@/components/rating/RatingPromptModal';
import { NOTIF_TEST_MODE } from '@/config';
import { useSettingsStore } from '@/stores/settingsStore';
import { queryClient, reconcileContentListsAfterHydration } from '@/lib/queryClient';
import { initConnectivity, onReconnect } from '@/lib/connectivity';
import { flushOutbox, startOutbox } from '@/lib/outbox';
import { getMostRecentlyActiveLectureId } from '@/lib/resumeCache';
import { APP_VERSION } from '@/lib/version';
import { queryKeys } from '@/constants/queryKeys';
import { useNotificationsStore } from '@/stores/notificationsStore';

// Benign dev-only warning: expo-notifications flags 'default' as an unknown
// custom sound even though it's the built-in system sound name.
LogBox.ignoreLogs(["Custom sound 'default' not found in native app."]);

// ── Offline-first query persistence (V10 Feature D) ──────────────────────────
// Persist the query cache to async-storage so a cold OFFLINE launch renders Home
// + sections + lecture lists + notes from disk (no spinner, no network). Only
// stable, non-private content is persisted; volatile/private caches
// (notifications, admin, questions, quiz attempts, buddy, broadcasts, auth,
// signed-URL playback) are never written to disk.
const persister = createAsyncStoragePersister({ storage: AsyncStorage });

/** First key element of the query caches that are safe + useful to persist. */
const PERSISTED_QUERY_ROOTS = new Set<string>([
  'home', // Home data (resume + rails + sections grid)
  'section', // section pages (titles, lecture list, progress, quiz cards)
  'sections', // section flat/edit metadata
  'lecture', // single-lecture playback metadata (title/eyebrow for offline open;
  //            a cached signed URL may be served to the player, but only within a
  //            45-min staleTime (useLecture.ts) that stays under its 3600s TTL)
  'lectures', // recent / featured / by-ids lecture-card lists
  'notes', // private per-lesson notes («حتى الملاحظات»)
  'journey', // journey summary / weekly goal / badges / streak snapshots
  'benefits', // shared lesson benefits (read-only)
  'appContent', // «عن المنصة» + support contact (static)
  'notifications', // the user's own inbox/prefs on the user's own device (V11 · E —
  //                 server stays the source of truth on the next online refetch)
]);

function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false; // never persist errors/pending
  const key = query.queryKey;
  if (!Array.isArray(key)) return false;
  if (key.some((part) => part === 'admin')) return false; // defence-in-depth
  // Quizzes (V11 · E): persist ONLY the quiet «اختباراتك» stats line so it renders
  // offline on رحلتي العلمية — never the attempt/intro/result payloads (server-graded,
  // answer-key sensitive, volatile).
  if (key[0] === 'quizzes') return key[1] === 'myStats';
  return PERSISTED_QUERY_ROOTS.has(String(key[0]));
}

/**
 * Fired once, right after the persisted query cache finishes restoring from
 * disk — same hook as reconcileContentListsAfterHydration, but also targets
 * the one thing that set deliberately excludes: the single-lecture playback
 * cache entry (`queryKeys.lecture`) for whichever lecture was most recently
 * active per the local resume cache (src/lib/resumeCache.ts). Forces that
 * entry to be treated as invalidated so the very next `playLecture()` call
 * re-fetches a fresh signed URL + server position instead of trusting
 * whatever was serialized to disk right before a possible force-kill (see
 * queryClient.ts's `'lecture'` exclusion comment). `invalidateQueries` here
 * only flags staleness — it doesn't itself force a network call for an
 * inactive (not-yet-mounted) query, so this is safe to run offline too.
 */
function onPersistedCacheHydrated() {
  reconcileContentListsAfterHydration();
  const lastLectureId = getMostRecentlyActiveLectureId();
  if (lastLectureId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lecture(lastLectureId) });
  }
}

// Arabic-first: force RTL across the whole app — even when the phone's language
// is English (Task 6). `forceRTL` only takes effect after a reload, so on the
// FIRST launch where the layout isn't RTL yet (a fresh install on a non-RTL
// locale) we restart ONCE to apply it. `isRTL` is true on every launch afterwards
// (the pref persists natively), so this never loops. Web can't restart and is LTR
// admin-only, so it's skipped there.
// iOS also enforces this natively in AppDelegate.swift (RCTI18nUtil, before
// the first frame), so the restart below never fires there in a real build;
// it remains as a fallback for a Debug build running an older native binary
// that predates that change. Android has NO equivalent native enforcement in
// MainApplication.kt — it currently relies entirely on the restart below to
// apply forceRTL, which happens to work but isn't guaranteed the way the iOS
// path now is. (TODO: mirror the AppDelegate.swift fix in MainApplication.kt.)
// Expo Go ignores this project's native Android/iOS code (it runs its own
// generic host), so isRTL can still read false there — skip the restart in
// Expo Go since `react-native-restart` has no native module to call in that
// environment (RNRestart is null → throws).
// swapLeftAndRightInRTL(false) keeps left/right styles PHYSICAL in RTL
// (textAlign 'right' means the right edge, absolute right:0 means the right
// edge) — without it RN mirrors them and every text lands on the left.
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);
I18nManager.swapLeftAndRightInRTL(false);

// Web (the admin dashboard) already gets `<html dir="rtl">` from `app/+html.tsx`,
// but that file only applies to the static/export build — the Metro dev server
// serves its own default HTML shell, which defaults to `dir="ltr"`. Set it here
// too, at module scope, so a plain browser element (scrollbar placement, text
// selection, an input missing an explicit `dir`) is never LTR-by-default, in
// dev or in prod.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'ar';
}

// Connectivity → TanStack onlineManager (V11 · A): paused offlineFirst queries
// resume the instant the network returns, and the offline outbox gets its
// reconnect signal. Module scope, no render coupling.
initConnectivity();
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
if (Platform.OS !== 'web' && !I18nManager.isRTL && !isExpoGo) {
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

  // Recovery for the fall-through below: the boot anon sign-in failed (a fresh
  // install opened offline / server unreachable) and the app rendered
  // session-less — every RLS-gated read (`to authenticated`) is returning
  // empty rows, so Home looks blank and STAYS blank even after the network
  // returns (the failed mutation is never retried, and the empty results are
  // cached as successes). Retry the silent sign-in on each offline→online
  // transition; once it lands, refetch everything that was fetched without a
  // session so the app converges without needing a force-restart.
  const ensureFailed = ensure.isError;
  const ensureMutate = ensure.mutate; // stable identity — the effect must not churn per render
  useEffect(() => {
    if (Platform.OS === 'web' || user || !ensureFailed) return;
    return onReconnect(() => {
      // Re-check against the live cache, not this effect's captured `user`: a
      // sign-in/register completed on the (auth) screens while this listener
      // was armed must win — never mint an anon session over a real one.
      if (queryClient.getQueryData(queryKeys.currentUser)) return;
      ensureMutate(undefined, {
        onSuccess: () => void queryClient.invalidateQueries(),
      });
    });
  }, [user, ensureFailed, ensureMutate]);

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
        // A sheikh lives in /sheikh (their inbox) AND the shared staff screens
        // under /admin (dashboard · quizzes · contributions · analytics) — allow
        // both; only steer them there from elsewhere. Their landing is /sheikh.
        if (!inSheikh && !inAdmin) router.replace('/sheikh' as Parameters<typeof router.replace>[0]);
      } else if (isStaff && !user!.isGuest) {
        if (!inAdmin) router.replace(staffHome);
      } else if (!inAuth) {
        router.replace('/sign-in');
      }
      return;
    }

    // Native: guest-first student app. Steer staff into /admin, sheikhs into
    // /sheikh, others out of both; the (auth) screens stay reachable so a guest
    // can register / sign in. A sheikh may also open the /admin staff screens.
    if (!user) return;
    if (isSheikh) {
      if (!inSheikh && !inAdmin) router.replace('/sheikh' as Parameters<typeof router.replace>[0]);
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
  const [ratingPromptVisible, setRatingPromptVisible] = useState(false);

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
        await registerPushToken(token, Platform.OS);
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
      // Any notification tap is a fresh chance to reconcile state the push was
      // about — most importantly buddy invites/accepts (route '/'), whose card
      // otherwise stays stale (refetchOnWindowFocus is off) until a full restart.
      // refetchType 'all' so even a not-yet-mounted buddy query refetches now,
      // rather than serving cache when the Home card mounts after navigation.
      void queryClient.invalidateQueries({ queryKey: ['buddy'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      if (data.lectureId) {
        // Carry the paused second so the player opens at the exact position (§8).
        const t =
          typeof data.positionSec === 'number' && data.positionSec > 0
            ? `?t=${Math.round(data.positionSec)}`
            : '';
        const lectureId = data.lectureId;
        // Notification-open gender guard (0072): the push broadcasts to
        // everyone, so this single check runs only here, right before
        // opening from a notification — never on normal browsing.
        void isLectureVisibleToViewer(lectureId).then((visible) => {
          if (visible) {
            router.push(`/player/${lectureId}${t}`);
          } else {
            Alert.alert('هذا الدرس ضمن قسم النساء', 'هذا المحتوى مخصص لقسم النساء.');
          }
        });
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
    // Offline outbox (V11 · B): wire reconnect + post-boot triggers once the
    // session is ready, then drain on every foreground below.
    startOutbox();
    const onActive = () => {
      void recordAppOpen();
      void clearBadge(); // reset the launcher "new lessons" count on open (Issue 8)
      void touchLastOpened(); // server stamp for the weekly-goal cron
      void flushOutbox(); // replay any queued offline activity/note/goal writes
      // Ban enforcement: if the admin banned this account, drop the session NOW
      // (server-validated; a network failure never signs anyone out). The
      // currentUser cache flip makes AuthGate reroute immediately.
      void checkBannedAndSignOut().then((res) => {
        if (res.banned) queryClient.setQueryData(queryKeys.currentUser, res.user);
      });
      // Refresh buddy + inbox state on every foreground — tapping a buddy
      // invitation/accept push brings the app forward, and refetchOnWindowFocus
      // is off, so without this the buddy card stays stale until a full restart.
      void queryClient.invalidateQueries({ queryKey: ['buddy'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
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

  // Star-rating prompt: track cumulative foreground time (not one continuous
  // session — summed across app opens) and offer the prompt once the running
  // total crosses the next threshold (src/lib/ratingPrompt.ts). Native only —
  // web is the admin dashboard, not the student app.
  useEffect(() => {
    if (!user || Platform.OS === 'web') return;
    let sessionStart = Date.now();
    const flushElapsed = () => {
      const elapsedSec = (Date.now() - sessionStart) / 1000;
      void addForegroundSeconds(elapsedSec);
    };
    const maybePrompt = () => {
      void shouldShowRatingPrompt().then((show) => {
        if (show) setRatingPromptVisible(true);
      });
    };
    maybePrompt();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sessionStart = Date.now();
        maybePrompt();
      } else if (state === 'background') {
        flushElapsed();
      }
    });
    return () => {
      flushElapsed();
      sub.remove();
    };
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

  return (
    <RatingPromptModal
      visible={ratingPromptVisible}
      onClose={() => setRatingPromptVisible(false)}
    />
  );
}

/**
 * Root crash screen (expo-router's route-level ErrorBoundary export). Catches
 * any unhandled render/lifecycle throw anywhere in the route tree — without
 * this, a release build hard-crashes to the launcher on native and blanks the
 * page on web, with no way back in. The Try wrapper replaces the ENTIRE root
 * layout when it trips, so this must stay self-contained: plain views + theme
 * constants only — no query client, no safe-area provider, no router, no
 * custom fonts (the crash may pre-date the font load).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bgSand,
        padding: 32,
        gap: 20,
      }}
    >
      <Logo size={84} />
      <Text
        style={{
          color: colors.primaryTeal,
          fontSize: 20,
          fontWeight: '700',
          textAlign: 'center',
          writingDirection: 'rtl',
        }}
      >
        حدث خللٌ غير متوقع
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 14,
          lineHeight: 24,
          textAlign: 'center',
          writingDirection: 'rtl',
        }}
      >
        نعتذر عن هذا العارض، جرّب المحاولة مرة أخرى.
      </Text>
      {__DEV__ ? (
        <Text style={{ color: colors.textGhost, fontSize: 11, textAlign: 'center' }}>
          {error.message}
        </Text>
      ) : null}
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        style={({ pressed }) => ({
          backgroundColor: colors.primaryTeal,
          paddingHorizontal: 28,
          paddingVertical: 14,
          borderRadius: radius.input,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ color: colors.onTealPrimary, fontSize: 15, fontWeight: '600' }}>
          إعادة المحاولة
        </Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  // Not an early return before the provider tree (P5 perf plan): mounting
  // QueryClientProvider unconditionally lets SessionGate's anon sign-in kick
  // off immediately, in parallel with the font load, instead of waiting for
  // fonts to resolve first.
  // `fontError` counts as "loaded": a failed font fetch (a flaky network
  // loading the web dashboard is the realistic case — native assets are
  // bundled) must fall back to system fonts, not hold the whole app on the
  // boot loader forever.
  const [fontsLoaded, fontError] = useFonts({
    Amiri_400Regular,
    Amiri_700Bold,
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 30 * 24 * 3600_000,
        buster: APP_VERSION,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
      // Phase 3.4 fix: once the persisted cache has been restored from disk (and
      // already rendered), reconcile the "admin can add/remove/unpublish"
      // content-list roots (home/section/sections/lectures) against the server in
      // the background — see reconcileContentListsAfterHydration for why this is
      // scoped instead of a blanket refetch-everything-on-launch. Also forces a
      // targeted invalidation of the last-active lecture's playback cache entry
      // — see onPersistedCacheHydrated above.
      onSuccess={onPersistedCacheHydrated}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          {/* SDK 56's expo-status-bar has no backgroundColor prop (Android 15
              edge-to-edge is always on) — the status-bar fog is Screen.tsx's job. */}
          <StatusBar style="dark" />
          <SessionGate fontsLoaded={fontsLoaded || !!fontError}>
            <UpdateGate>
              <AuthGate />
              <NotificationsBootstrap />
              <TourCard />
              <StartHereCard />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bgSand },
                }}
              >
                {/* Full-screen player presented modally over the student app. iOS's
                    native `modal` presentation already peeks the screen beneath and
                    supports swipe-down-to-dismiss out of the box. Android's `modal`
                    presentation has neither, so the player screen itself renders the
                    peek gap + swipe gesture on top of a `transparentModal` there.
                    `contentStyle` must be overridden to transparent here — the Stack's
                    own screenOptions.contentStyle (bgSand, above) would otherwise win
                    and paint the WHOLE native screen surface opaque cream even for
                    `transparentModal`, hiding the (student) screen beneath for the
                    entire drag + the native pop transition (the ~200ms blank-screen
                    flash on swipe-down-to-dismiss). iOS's opaque `modal` doesn't need
                    this — UIKit manages the peek/backing natively there. */}
                {/* Android animation is `fade`, not `slide_from_bottom`: the native
                    slide moved the WHOLE transparent surface (dim backdrop included),
                    so the backdrop strip visibly rode up the screen as a floating
                    dark rectangle on every open. The player screen slides its own
                    sheet up/down with Reanimated and derives the backdrop dim from
                    the same value; the short native fade just overlaps it. */}
                <Stack.Screen
                  name="player/[id]"
                  options={{
                    presentation: Platform.OS === 'android' ? 'transparentModal' : 'modal',
                    animation: Platform.OS === 'android' ? 'fade' : undefined,
                    contentStyle:
                      Platform.OS === 'android' ? { backgroundColor: 'transparent' } : undefined,
                  }}
                />
              </Stack>
            </UpdateGate>
          </SessionGate>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </PersistQueryClientProvider>
  );
}
