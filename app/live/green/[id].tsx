/**
 * «غرفة التجهيز» — the host's green room (PLAN_LIVE_V23 §7.3/§7.6, P4).
 *
 * Opened from the section page right after «ابدأ مجلساً مباشراً» (or «العودة
 * إلى غرفة التجهيز»). The session loads → openGreen(session) once (scheduled →
 * green, then joins with the mic ON) → a mic level meter (polled from the store
 * ≈6×/s into local state — no store writes), the connection state, where the
 * recording goes, who of the moderators is here → «ابدأ البث» (startBroadcast
 * → the room, replaced) or «إلغاء» (cancel_live_session + leave + back).
 *
 * Leaving any other way (close, swipe down, back) leaves the green connection
 * — the mic is never kept open behind another screen; the session stays green
 * and the section page offers «العودة إلى غرفة التجهيز». A session that is
 * already live goes straight to the room.
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveTokenError, type LiveSessionPublic } from '@/api/live';
import { LiveAvatar } from '@/components/live/LiveAvatar';
import { LivePeekSheet } from '@/components/live/LivePeekSheet';
import {
  LIVE_COPY,
  LIVE_P4_COPY,
  asList,
  controlErrorText,
  isEndedStatus,
  meterBars,
  roleKind,
  rpcErrorText,
  sexOf,
  staffNameMap,
  visibleName,
} from '@/components/live/liveUi';
import { SheetButton, SheetError } from '@/components/live/sheets/sheetParts';
import { IconButton, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useCancelLiveSession, useLiveSession, useLiveStaffParticipants } from '@/hooks/useLive';
import { getLiveMicLevel, useLiveStore, type LiveConn } from '@/stores/liveStore';

const METER_BARS = 18;
const METER_POLL_MS = 160;
const READY_CONNS: ReadonlySet<LiveConn> = new Set<LiveConn>(['ok', 'poor', 'hostdrop']);

/** openGreen / startBroadcast failure → one Arabic line. */
function greenErrorText(e: unknown): string {
  if (e instanceof LiveTokenError) return e.message;
  return controlErrorText(e);
}

export default function LiveGreenRoomScreen() {
  return <LivePeekSheet>{(collapse) => <GreenRoom collapse={collapse} />}</LivePeekSheet>;
}

function GreenRoom({ collapse }: { collapse: () => void }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sessionQ = useLiveSession(id);
  const session: LiveSessionPublic | null = sessionQ.data ?? null;
  const cancelM = useCancelLiveSession();

  const storeSessionId = useLiveStore((s) => s.session?.id ?? null);
  const conn = useLiveStore((s) => s.conn);
  const people = useLiveStore((s) => s.people);
  const openGreen = useLiveStore((s) => s.openGreen);
  const startBroadcast = useLiveStore((s) => s.startBroadcast);
  const leave = useLiveStore((s) => s.leave);

  const joinedHere = !!id && storeSessionId === id;
  const roomConn: LiveConn = joinedHere ? conn : 'idle';

  const [openError, setOpenError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  /** Set once the screen hands the connection on (to the room) or has already left. */
  const handedOff = useRef(false);
  const opened = useRef<string | null>(null);
  const idRef = useRef(id);
  idRef.current = id;

  const status = session?.status;

  // Already live (opened late, or started from elsewhere) → the room.
  useEffect(() => {
    if (status === 'live' && id && !handedOff.current) {
      handedOff.current = true;
      router.replace(`/live/${id}` as Href);
    }
  }, [status, id, router]);

  const open = useCallback(
    (s: LiveSessionPublic) => {
      opened.current = s.id;
      setOpenError(null);
      openGreen(s).catch((e: unknown) => setOpenError(greenErrorText(e)));
    },
    [openGreen],
  );

  // openGreen once per session, while it can still become live.
  useEffect(() => {
    if (!session || opened.current === session.id) return;
    if (session.status !== 'scheduled' && session.status !== 'green') return;
    open(session);
  }, [session, open]);

  // Leaving the green room any way but «ابدأ البث» closes the mic — including
  // while openGreen is still in flight (no session in the store yet): leave()
  // bumps the store's join generation, which openGreen checks after every await.
  // Once «ابدأ البث» is pressed the start is committed: closing meanwhile keeps
  // the host connected (the mini-bar leads back to the room).
  const unmounted = useRef(false);
  useEffect(
    () => () => {
      unmounted.current = true;
      if (handedOff.current || startingRef.current) return;
      const st = useLiveStore.getState();
      if (!st.session || st.session.id === idRef.current) void st.leave();
    },
    [],
  );

  const startingRef = useRef(false);
  const onStart = async () => {
    if (!id || starting) return;
    startingRef.current = true;
    setStarting(true);
    setActionError(null);
    try {
      await startBroadcast();
      handedOff.current = true;
      void sessionQ.refetch?.();
      if (!unmounted.current) router.replace(`/live/${id}` as Href);
    } catch (e) {
      startingRef.current = false;
      if (unmounted.current) {
        // Closed while a start failed: nothing to show the error on — don't leave a hot mic behind.
        void useLiveStore.getState().leave();
        return;
      }
      setActionError(greenErrorText(e));
      setStarting(false);
    }
  };

  const onCancel = () => {
    if (!id || cancelling) return;
    setCancelling(true);
    setActionError(null);
    cancelM.mutate(id, {
      onSuccess: () => {
        handedOff.current = true;
        void leave();
        collapse();
      },
      onError: (e: unknown) => {
        setCancelling(false);
        setActionError(rpcErrorText(e, 'تعذّر إلغاء المجلس. حاول مرة أخرى'));
      },
    });
  };

  // ── Who is here (moderators) — staff see real names (D2) ──────────────────
  const staffQ = useLiveStaffParticipants(id ?? null, joinedHere);
  const staffData = (staffQ as { data?: unknown } | null | undefined)?.data;
  const staffMap = useMemo(() => staffNameMap(asList<unknown>(staffData)), [staffData]);
  const present = useMemo(
    () =>
      Object.entries(people)
        .filter(([, p]) => !p.isMe)
        .map(([pid, p]) => ({
          id: pid,
          name: visibleName(pid, p, true, staffMap),
          gender: sexOf(p.gender),
          moderator: roleKind(p.role) === 'moderator',
        })),
    [people, staffMap],
  );

  // ── Non-room states ───────────────────────────────────────────────────────
  let body: React.ReactNode = null;
  if (!session && sessionQ.isLoading) {
    body = <Center><ActivityIndicator size="large" color={colors.primaryTeal} /></Center>;
  } else if (!session) {
    body = <Gone title="لم نجد هذا المجلس" sub="ربما أُلغي أو انتهى." onBack={collapse} />;
  } else if (status === 'cancelled') {
    body = <Gone title="أُلغي المجلس" onBack={collapse} />;
  } else if (isEndedStatus(status)) {
    body = <Gone title={LIVE_COPY.ended} onBack={collapse} />;
  } else if (status === 'live') {
    body = <Center><ActivityIndicator size="large" color={colors.primaryTeal} /></Center>;
  }

  const ready = READY_CONNS.has(roomConn);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgSand }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 14,
          paddingTop: 8,
          paddingBottom: 6,
        }}
      >
        <IconButton icon="chevron-down" onPress={collapse} accessibilityLabel="خروج من غرفة التجهيز" />
        {/* flex:1 + centred: a width-less Arabic label in this row is measured
            short on Android and loses its last word («غرفة» — device check). */}
        <Txt size={13} weight="semibold" color={colors.textSlate} style={{ flex: 1, textAlign: 'center' }}>
          {LIVE_P4_COPY.greenRoom}
        </Txt>
        <View style={{ width: 40 }} />
      </View>

      {body ?? (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ alignItems: 'center', gap: 3, paddingTop: 4, paddingBottom: 4 }}>
              <Txt
                weight="display"
                size={21}
                align="center"
                numberOfLines={2}
                style={{ lineHeight: 32, alignSelf: 'stretch' }}
              >
                {session?.title}
              </Txt>
              <Txt size={12} color={colors.textFaint} align="center" numberOfLines={1} style={{ alignSelf: 'stretch' }}>
                {[session?.sectionTitle, session?.sheikhName].filter(Boolean).join(' · ')}
              </Txt>
            </View>

            <Card>
              <Txt size={13} weight="semibold" color={colors.textSlate}>
                اختبار الميكروفون
              </Txt>
              <MicMeter enabled={ready} />
              <Txt size={12} color={colors.textFaint} style={{ lineHeight: 19 }}>
                تكلّم قليلاً، ويتحرك المؤشر إن كان صوتك يصل.
              </Txt>
              <ConnLine
                conn={roomConn}
                error={openError}
                onRetry={session ? () => open(session) : undefined}
              />
            </Card>

            <Card>
              <InfoRow
                icon="disc"
                text={
                  session?.sectionTitle
                    ? `يُسجَّل تلقائياً ويُحفظ في قسم ${session.sectionTitle}`
                    : 'يُسجَّل تلقائياً ويُحفظ في قسم المجلس'
                }
              />
              <InfoRow icon="bell" text={LIVE_P4_COPY.notifyAll} />
            </Card>

            <Card>
              <Txt size={13} weight="semibold" color={colors.textSlate}>
                الحاضرون من المشرفين
              </Txt>
              {present.length ? (
                present.map((p) => (
                  <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <LiveAvatar gender={p.gender} size={30} moderator={p.moderator} />
                    <Txt size={13.5} weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                      {p.name}
                    </Txt>
                  </View>
                ))
              ) : (
                <Txt size={12.5} color={colors.textGhost}>
                  لم يدخل أحد من المشرفين بعد
                </Txt>
              )}
            </Card>
          </ScrollView>

          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: insets.bottom + 14,
              borderTopWidth: 1,
              borderColor: colors.borderSand,
              backgroundColor: colors.surfaceCard,
            }}
          >
            <SheetError text={actionError} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: actionError ? 10 : 0 }}>
              <SheetButton
                label={LIVE_P4_COPY.startBroadcast}
                tone="primary"
                busy={starting}
                disabled={!ready || cancelling}
                onPress={() => void onStart()}
              />
              <SheetButton
                label={LIVE_P4_COPY.cancel}
                busy={cancelling}
                disabled={starting}
                onPress={onCancel}
                accessibilityLabel="إلغاء المجلس"
              />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** Level meter: static bars, lit by the polled level (no animation). */
function MicMeter({ enabled }: { enabled: boolean }) {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setLit(0);
      return;
    }
    const t = setInterval(() => setLit(meterBars(getLiveMicLevel(), METER_BARS)), METER_POLL_MS);
    return () => clearInterval(t);
  }, [enabled]);
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 26 }}
      accessibilityLabel={lit > 0 ? 'يصل صوتك إلى الميكروفون' : 'لا صوت من الميكروفون بعد'}
    >
      {Array.from({ length: METER_BARS }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 10 + Math.round((i / (METER_BARS - 1)) * 14),
            borderRadius: 2,
            backgroundColor: i < lit ? (i >= METER_BARS - 3 ? colors.accentBrass : colors.primaryTeal600) : colors.surfaceInset,
          }}
        />
      ))}
    </View>
  );
}

function ConnLine({ conn, error, onRetry }: { conn: LiveConn; error: string | null; onRetry?: () => void }) {
  let icon: keyof typeof Feather.glyphMap = 'check-circle';
  let tone: string = colors.primaryTeal;
  let text: string;
  let spin = false;
  switch (conn) {
    case 'ok':
      text = 'الاتصال جيد';
      break;
    case 'poor':
      icon = 'alert-triangle';
      tone = colors.accentBrassMuted;
      text = LIVE_COPY.poor;
      break;
    case 'hostdrop':
      icon = 'mic-off';
      tone = colors.accentBrassMuted;
      text = 'لم يصل صوتك إلى الخادم بعد. تحقّق من الميكروفون';
      break;
    case 'reconnecting':
      spin = true;
      text = LIVE_COPY.reconnecting;
      break;
    case 'offline':
      icon = 'wifi-off';
      tone = colors.stateDanger;
      text = 'لا يوجد اتصال بالإنترنت';
      break;
    case 'failed':
      icon = 'refresh-cw';
      tone = colors.stateDanger;
      text = error ?? LIVE_COPY.failed;
      break;
    default:
      if (error) {
        icon = 'alert-circle';
        tone = colors.stateDanger;
        text = error;
      } else {
        spin = true;
        text = 'جارٍ تجهيز الاتصال…';
      }
  }
  const showRetry = !!onRetry && (conn === 'failed' || (!!error && (conn === 'idle' || conn === 'connecting')));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
      {spin ? <ActivityIndicator size="small" color={colors.primaryTeal} /> : <Feather name={icon} size={15} color={tone} />}
      <Txt size={12.5} color={tone} style={{ flex: 1, lineHeight: 20 }} accessibilityLiveRegion="polite">
        {text}
      </Txt>
      {showRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
          <Txt size={12.5} weight="semibold" color={colors.primaryTeal} style={{ textDecorationLine: 'underline' }}>
            إعادة المحاولة
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

function InfoRow({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <Feather name={icon} size={15} color={colors.accentBrassMuted} style={{ marginTop: 3 }} />
      <Txt size={13} color={colors.textSlate} style={{ flex: 1, lineHeight: 21 }}>
        {text}
      </Txt>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.surfaceCard,
        borderWidth: 1,
        borderColor: colors.borderSand,
        borderRadius: radius.card,
        paddingVertical: 14,
        paddingHorizontal: 14,
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}

function Gone({ title, sub, onBack }: { title: string; sub?: string; onBack: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 }}>
      <Feather name="moon" size={26} color={colors.accentBrassMuted} />
      <Txt weight="display" size={20} align="center" style={{ alignSelf: 'stretch' }}>
        {title}
      </Txt>
      {sub ? (
        <Txt size={13} color={colors.textMuted} align="center" style={{ lineHeight: 22, alignSelf: 'stretch' }}>
          {sub}
        </Txt>
      ) : null}
      <View style={{ marginTop: 12, flexDirection: 'row' }}>
        <SheetButton label="العودة" tone="primary" grow={false} onPress={onBack} />
      </View>
    </View>
  );
}
