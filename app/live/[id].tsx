/**
 * «الحلقة» — the live room (PLAN_LIVE_V23 §7.3–§7.5, P3: listening).
 *
 * Entry: the session loads → a sister who never chose is asked «كيف تظهرين في
 * الحلقة؟» (IdentitySheet, remembered per device, changeable from «في الحلقة»)
 * → liveStore.join(). live-token answers `gender_required` for a profile with
 * no gender: GenderPrompt, then the same flow again. Minimising (chevron /
 * swipe down) keeps the room — LiveMiniBar takes over; «مغادرة الحلقة» leaves.
 *
 * Layout (top → bottom): top bar (minimise · live clock + signal · people) ·
 * title + «يتحدث الآن…» · host-drop note · the halaqa board (fills the free
 * height) · attendance line · dock.
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveTokenError, type LiveSessionPublic } from '@/api/live';
import { BrotherIcon } from '@/components/live/BrotherIcon';
import { Halaqa } from '@/components/live/Halaqa';
import { LiveDock } from '@/components/live/LiveDock';
import { LivePeekSheet } from '@/components/live/LivePeekSheet';
import {
  LiveHoldNote,
  LiveStageMessage,
  LiveStateLine,
  type NowSpeaker,
} from '@/components/live/LiveStateLine';
import { NiqabIcon } from '@/components/live/NiqabIcon';
import {
  LIVE,
  LIVE_COPY,
  NO_STAFF_NAMES,
  arClock,
  arDayLabel,
  asList,
  elapsedSec,
  isEndedStatus,
  isLiveStaff,
  liveErrorCode,
  roleKind,
  staffNameMap,
  visibleName,
} from '@/components/live/liveUi';
import { useNow } from '@/components/live/LiveHomeCard';
import { GuestSpeakSheet } from '@/components/live/sheets/GuestSpeakSheet';
import { IdentitySheet } from '@/components/live/sheets/IdentitySheet';
import { PeopleSheet } from '@/components/live/sheets/PeopleSheet';
import { IconButton, Txt } from '@/components/ui';
import { GenderPrompt } from '@/components/ui/GenderPrompt';
import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useLiveSession, useLiveStaffParticipants } from '@/hooks/useLive';
import { arDuration, arNum } from '@/lib/format';
import { useLiveStore, type LiveConn, type LivePerson } from '@/stores/liveStore';

/** The prototype board (390×410) — never drawn wider than its design size. */
const BOARD_MAX = 390;
const BOARD_RATIO = 410 / 390;
const BAD_CONNS: ReadonlySet<LiveConn> = new Set<LiveConn>(['failed', 'offline', 'reconnecting']);

type Step = 'idle' | 'identity' | 'gender' | 'joining';

export default function LiveRoomScreen() {
  return <LivePeekSheet>{(collapse) => <LiveRoom collapse={collapse} />}</LivePeekSheet>;
}

function LiveRoom({ collapse }: { collapse: () => void }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: user } = useCurrentUser();
  const isStaff = isLiveStaff(user);
  const sessionQ = useLiveSession(id);

  const storeSession = useLiveStore((s) => s.session);
  const conn = useLiveStore((s) => s.conn);
  const me = useLiveStore((s) => s.me);
  const people = useLiveStore((s) => s.people);
  const counts = useLiveStore((s) => s.counts);
  const activeSpeakers = useLiveStore((s) => s.activeSpeakers);
  const hostPresent = useLiveStore((s) => s.hostPresent);
  const paused = useLiveStore((s) => s.paused);
  const preferredIdentity = useLiveStore((s) => s.preferredIdentity);
  const lastError = useLiveStore((s) => s.lastError);
  const join = useLiveStore((s) => s.join);
  const leave = useLiveStore((s) => s.leave);
  const setPaused = useLiveStore((s) => s.setPaused);
  const setPreferredIdentity = useLiveStore((s) => s.setPreferredIdentity);

  const joinedHere = !!id && storeSession?.id === id;
  const session: LiveSessionPublic | null = sessionQ.data ?? (joinedHere ? storeSession : null);
  const roomConn: LiveConn = joinedHere ? conn : 'idle';

  const [step, setStep] = useState<Step>('idle');
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [identityMode, setIdentityMode] = useState<'join' | 'change'>('join');
  const [guestGateOpen, setGuestGateOpen] = useState(false);

  // ── Entry flow ─────────────────────────────────────────────────────────────
  const doJoin = useCallback(
    (s: LiveSessionPublic, choice?: 'named' | 'hidden') => {
      setStep('joining');
      join(s, choice ? { identityChoice: choice } : undefined).then(
        () => setStep('idle'),
        (e: unknown) => {
          // gender_required → GenderPrompt, then begin() again; anything else is
          // already in the store (conn 'failed' + lastError) for the stage message.
          setStep(e instanceof LiveTokenError && e.code === 'gender_required' ? 'gender' : 'idle');
        },
      );
    },
    [join],
  );

  const begin = useCallback(
    (s: LiveSessionPublic, gender: string | null | undefined) => {
      // A sister (not a guest — a guest is «ضيفة» anyway) chooses once per device.
      if (gender === 'female' && !user?.isGuest && !useLiveStore.getState().preferredIdentity) {
        setIdentityMode('join');
        setStep('identity');
        return;
      }
      doJoin(s);
    },
    [doJoin, user?.isGuest],
  );

  // The entry flow runs ONCE per screen: `started` = this screen already began
  // (or found) its join — it never auto-joins again, so a leave (the dock, the
  // notification's «مغادرة», a sign-out) can't be undone by a re-render.
  // `wasJoined` = the room was seen joined here; `closing` = on the way out.
  const started = useRef<string | null>(null);
  const wasJoined = useRef(false);
  const closing = useRef(false);
  const exit = useCallback(() => {
    closing.current = true;
    collapse();
  }, [collapse]);
  const status = session?.status;
  const canEnter = status === 'live' || (status === 'green' && isStaff);
  useEffect(() => {
    if (closing.current || !session || started.current === session.id) return;
    if (joinedHere) {
      started.current = session.id; // opened while already in this room
      return;
    }
    if (!user || !canEnter) return;
    started.current = session.id;
    begin(session, user.gender);
  }, [session, user, canEnter, joinedHere, begin]);

  // Left from elsewhere while this screen is open: nothing to show — close
  // instead of a skeleton that never ends. Only once the room was SEEN joined
  // here (on first mount the entry effect has just called join(), but this
  // render still says not joined).
  useEffect(() => {
    if (joinedHere) {
      wasJoined.current = true;
    } else if (wasJoined.current && step === 'idle' && !closing.current) {
      exit();
    }
  }, [step, joinedHere, exit]);

  // ── Names (D2: staff see real names) ───────────────────────────────────────
  const staffQ = useLiveStaffParticipants(id ?? null, isStaff && joinedHere);
  const staffData = (staffQ as { data?: unknown } | null | undefined)?.data;
  const staffMap = useMemo(
    () => (isStaff ? staffNameMap(asList<unknown>(staffData)) : NO_STAFF_NAMES),
    [isStaff, staffData],
  );
  const nameOf = useCallback(
    (identity: string, p: LivePerson) => visibleName(identity, p, isStaff, staffMap),
    [isStaff, staffMap],
  );

  const sheikhName = session?.sheikhName ?? '';
  const speakerId = activeSpeakers[0] ?? null;
  const speaker: NowSpeaker = useMemo(() => {
    const p = speakerId ? people[speakerId] : undefined;
    if (!p) return null;
    const host = roleKind(p.role) === 'host';
    return { name: host && sheikhName ? sheikhName : nameOf(p.identity, p), gender: p.gender, isMe: p.isMe };
  }, [speakerId, people, sheikhName, nameOf]);

  // ── Board size: the free height between the header and the dock ────────────
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const onStageLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };
  const boardSize = stage
    ? Math.floor(Math.max(200, Math.min(stage.w - 16, BOARD_MAX, stage.h / BOARD_RATIO)))
    : 0;

  const onLeave = () => {
    exit();
    void leave();
  };

  // ── Non-room states ────────────────────────────────────────────────────────
  const ended = isEndedStatus(status) || roomConn === 'ended';
  let body: React.ReactNode = null;
  if (ended) {
    body = (
      <EndedView
        onBack={() => {
          exit();
          if (joinedHere) void leave();
        }}
      />
    );
  } else if (!session && sessionQ.isLoading) {
    body = <CenterSpinner />;
  } else if (!session) {
    body = <Notice icon="search" title="لم نجد هذا المجلس" sub="ربما انتهى أو لم يعد متاحاً." onBack={collapse} />;
  } else if (!canEnter && !joinedHere) {
    body = <ScheduledView session={session} onBack={collapse} />;
  }

  const failedSub =
    lastError && lastError !== 'network' && lastError !== 'unknown'
      ? new LiveTokenError(liveErrorCode({ code: lastError })).message
      : 'تحقّق من اتصالك ثم أعد المحاولة.';

  const bad = BAD_CONNS.has(roomConn);
  const entering = roomConn === 'idle' || roomConn === 'connecting';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgSand }}>
      <TopBar
        conn={roomConn}
        startedAt={session?.startedAt ?? null}
        onMinimize={collapse}
        onPeople={() => setPeopleOpen(true)}
        showPeople={joinedHere && !ended}
      />

      {body ?? (
        <>
          <View style={{ alignItems: 'center', paddingHorizontal: 20, gap: 3 }}>
            <Txt
              weight="display"
              size={20}
              align="center"
              style={{ lineHeight: 30, alignSelf: 'stretch' }}
              numberOfLines={2}
            >
              {session?.title}
            </Txt>
            <Txt size={12} color={colors.textFaint} align="center" numberOfLines={1} style={{ alignSelf: 'stretch' }}>
              {[session?.sectionTitle, sheikhName].filter(Boolean).join(' · ')}
            </Txt>
            <View style={{ marginTop: 6 }}>
              <LiveStateLine
                conn={roomConn === 'idle' ? 'connecting' : roomConn}
                paused={paused}
                speaker={speaker}
                sheikhName={sheikhName}
                onResume={() => setPaused(false)}
              />
            </View>
          </View>

          {roomConn === 'hostdrop' ? <LiveHoldNote /> : null}

          <View
            onLayout={onStageLayout}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}
          >
            {boardSize > 0 ? (
              <Halaqa
                size={boardSize}
                people={people}
                counts={counts}
                mode={entering || roomConn === 'failed' ? 'skeleton' : 'live'}
                hostOff={roomConn === 'hostdrop' || (!entering && !hostPresent)}
                speakerId={paused ? null : speakerId}
                paused={paused}
                sheikhName={sheikhName}
                nameOf={nameOf}
                onMorePress={() => setPeopleOpen(true)}
                dim={bad}
              />
            ) : null}
            <LiveStageMessage
              conn={roomConn === 'idle' ? 'connecting' : roomConn}
              failedSub={failedSub}
              onRetry={session ? () => doJoin(session, preferredIdentity ?? undefined) : undefined}
            />
          </View>

          {!entering && roomConn !== 'failed' ? (
            <AttendanceLine brothers={counts.brothers} sisters={counts.sisters} />
          ) : null}

          <LiveDock
            conn={roomConn}
            bottomInset={insets.bottom}
            onLeave={onLeave}
            onPeople={() => setPeopleOpen(true)}
            onRequest={user?.isGuest ? () => setGuestGateOpen(true) : undefined}
          />
        </>
      )}

      {id && joinedHere ? (
        <PeopleSheet
          visible={peopleOpen}
          onClose={() => setPeopleOpen(false)}
          sessionId={id}
          people={people}
          counts={counts}
          isStaff={isStaff}
          myIdentity={me ? { gender: me.gender, hidden: me.hidden } : null}
          myName={user?.displayName ?? null}
          onChangeIdentity={
            me?.gender === 'f' && !user?.isGuest
              ? () => {
                  setPeopleOpen(false);
                  setIdentityMode('change');
                  setStep('identity');
                }
              : undefined
          }
        />
      ) : null}

      <IdentitySheet
        visible={step === 'identity'}
        mode={identityMode}
        initial={preferredIdentity}
        userName={user?.displayName ?? null}
        onConfirm={(choice) => {
          setStep('idle');
          if (identityMode === 'change') setPreferredIdentity(choice);
          else if (session) doJoin(session, choice);
        }}
        onClose={() => {
          setStep('idle');
          // Closing the entry question = not entering.
          if (identityMode === 'join' && !joinedHere) exit();
        }}
      />

      <GenderPrompt
        visible={step === 'gender'}
        message="لتجلس في مكانك من الحلقة بين الإخوة أو الأخوات، حدّد جنسك مرة واحدة."
        // onClose also runs on success (before onResolved) — only a real cancel leaves.
        onClose={() => {}}
        onCancel={() => {
          setStep('idle');
          if (!joinedHere) exit();
        }}
        onResolved={(g) => {
          if (session) begin(session, g);
          else setStep('idle');
        }}
      />

      <GuestSpeakSheet
        visible={guestGateOpen}
        onClose={() => setGuestGateOpen(false)}
        onRegister={() => {
          setGuestGateOpen(false);
          // The live keeps playing in the mini-bar while they register.
          collapse();
          router.push('/register');
        }}
      />
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function TopBar({
  conn,
  startedAt,
  onMinimize,
  onPeople,
  showPeople,
}: {
  conn: LiveConn;
  startedAt: string | null;
  onMinimize: () => void;
  onPeople: () => void;
  showPeople: boolean;
}) {
  const level = conn === 'poor' ? 1 : BAD_CONNS.has(conn) ? 0 : 4;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingTop: 8,
        paddingBottom: 10,
      }}
    >
      <IconButton icon="chevron-down" onPress={onMinimize} accessibilityLabel="تصغير" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {conn === 'idle' || conn === 'connecting' ? (
          <Pill>
            <ActivityIndicator size="small" color={colors.primaryTeal} />
            <Txt size={12} weight="medium" color={colors.textSlate}>
              جارٍ الانضمام
            </Txt>
          </Pill>
        ) : (
          <LiveClockPill startedAt={startedAt} />
        )}
        <Pill>
          <SignalBars level={level} tint={conn === 'poor' ? colors.accentBrassMuted : colors.primaryTeal} />
          {conn === 'poor' ? (
            <Txt size={12} weight="medium" color={colors.accentBrassMuted}>
              ضعيف
            </Txt>
          ) : null}
        </Pill>
      </View>
      {showPeople ? (
        <IconButton icon="users" iconSize={18} onPress={onPeople} accessibilityLabel="من في الحلقة" />
      ) : (
        <View style={{ width: 40 }} />
      )}
    </View>
  );
}

/** Isolated so the per-second clock re-renders only this pill. */
function LiveClockPill({ startedAt }: { startedAt: string | null }) {
  const now = useNow(1000);
  const sec = elapsedSec(startedAt, now);
  return (
    <Pill>
      <View
        style={{ width: 8, height: 8, borderRadius: 1, backgroundColor: LIVE.marker, transform: [{ rotate: '45deg' }] }}
      />
      <Txt size={12} weight="medium" color={colors.textSlate} tabular>
        {sec == null ? LIVE_COPY.liveNow : `مباشر · ${arDuration(sec)}`}
      </Txt>
    </Pill>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        height: 30,
        paddingHorizontal: 11,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceCard,
        borderWidth: 1,
        borderColor: colors.borderSand,
      }}
    >
      {children}
    </View>
  );
}

function SignalBars({ level, tint }: { level: number; tint: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 13 }}>
      {[4, 7, 10, 13].map((h, i) => (
        <View key={h} style={{ width: 3, height: h, borderRadius: 1, backgroundColor: i < level ? tint : LIVE.dimInk }} />
      ))}
    </View>
  );
}

function AttendanceLine({ brothers, sisters }: { brothers: number; sisters: number }) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}
      accessibilityLabel={`${brothers} من الإخوة و${sisters} من الأخوات`}
    >
      <BrotherIcon size={16} color="#2c6157" />
      <Txt size={12} color={colors.textSlate} tabular>
        {arNum(brothers)} من الإخوة
      </Txt>
      <Txt size={12} color={colors.textGhost}>
        ·
      </Txt>
      <NiqabIcon size={16} color={colors.primaryTealDeep} />
      <Txt size={12} color={colors.textSlate} tabular>
        {arNum(sisters)} من الأخوات
      </Txt>
    </View>
  );
}

function CenterSpinner() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.primaryTeal} />
    </View>
  );
}

function Notice({
  icon,
  title,
  sub,
  onBack,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  sub?: string;
  onBack: () => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 }}>
      <Feather name={icon} size={26} color={colors.accentBrassMuted} />
      {/* Full-width boxes, centred text: under forced RTL Android mis-measures a
          fit-content Arabic line and clips its last word («…على الحضور» was cut). */}
      <Txt weight="display" size={20} align="center" style={{ alignSelf: 'stretch' }}>
        {title}
      </Txt>
      {sub ? (
        <Txt size={13} color={colors.textMuted} align="center" style={{ lineHeight: 22, alignSelf: 'stretch' }}>
          {sub}
        </Txt>
      ) : null}
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginTop: 12,
          height: 44,
          paddingHorizontal: 26,
          borderRadius: radius.pill,
          backgroundColor: colors.primaryTeal,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Txt size={14} weight="semibold" color={colors.onTealPrimary}>
          العودة
        </Txt>
      </Pressable>
    </View>
  );
}

function EndedView({ onBack }: { onBack: () => void }) {
  return <Notice icon="moon" title={LIVE_COPY.ended} sub={LIVE_COPY.endedThanks} onBack={onBack} />;
}

function ScheduledView({ session, onBack }: { session: LiveSessionPublic; onBack: () => void }) {
  const now = useNow(60_000);
  const when = session.scheduledAt
    ? `موعده ${arDayLabel(session.scheduledAt, now)} ${arClock(session.scheduledAt)}`
    : undefined;
  return <Notice icon="calendar" title="لم يبدأ المجلس بعد" sub={when} onBack={onBack} />;
}
