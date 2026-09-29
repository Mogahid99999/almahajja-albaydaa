/**
 * «الحلقة» — the live room (PLAN_LIVE_V23 §7.3–§7.5, P3: listening).
 *
 * Entry: the session loads → a sister who never chose is asked «كيف تظهرين في
 * الحلقة؟» (IdentitySheet, remembered per device, changeable from «في الحلقة»)
 * → liveStore.join(). live-token answers `gender_required` for a profile with
 * no gender: GenderPrompt, then the same flow again. Minimising (chevron /
 * swipe down) keeps the room — LiveMiniBar takes over; «مغادرة الحلقة» leaves.
 *
 * Layout (top → bottom): top bar (minimise · live clock + signal · people
 * [+ «إدارة المجلس» for moderators]) · title + «يتحدث الآن…» · host-drop note ·
 * the halaqa board (fills the free height; notices + the end-undo bar float at
 * its foot) · requests strip (moderators) · attendance line · dock.
 *
 * P4 (§7.6): a registered listener raises a hand from the dock; speakers and
 * staff get the mic toggle. Moderators (host/moderator) take requests from the
 * strip (RequestSheet), act on people (PersonSheet from «في الحلقة» or the
 * halaqa) and switch «استقبال طلبات الكلمة» (ManageSheet); their «مغادرة
 * الحلقة» opens EndSheet — the 5-second undo before live-control `end` runs
 * HERE (a ref timer), so it survives the sheet closing and is cancelled on unmount.
 *
 * P5 (§9.2/§9.3): the top bar's share icon opens ShareSheet («مشاركة رابط البث»,
 * https://go.almahajja.app/live/{code}); for a registered listener with buddies
 * it leads on to BuddyInviteSheet («ادعُ رفيقك إلى الحلقة»). Both sheets run
 * their queries only while open.
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveTokenError, type LiveSessionPublic } from '@/api/live';
import { BrotherIcon } from '@/components/live/BrotherIcon';
import { Halaqa } from '@/components/live/Halaqa';
import { HandGlyph, LiveAvatar } from '@/components/live/LiveAvatar';
import { LiveDock, type DockSpeak } from '@/components/live/LiveDock';
import { LiveNoticeBar, LiveNoticePill, LiveUndoBar } from '@/components/live/LiveNoticeBar';
import { LivePeekSheet } from '@/components/live/LivePeekSheet';
import {
  LiveHoldNote,
  LiveStageMessage,
  LiveStateLine,
  type NowSpeaker,
} from '@/components/live/LiveStateLine';
import { NiqabIcon } from '@/components/live/NiqabIcon';
import {
  END_UNDO_MS,
  LIVE,
  LIVE_COPY,
  LIVE_P4_COPY,
  LIVE_P5_COPY,
  NO_STAFF_NAMES,
  arClock,
  arDayLabel,
  asList,
  canEndForAll,
  controlErrorText,
  currentSpeakers,
  elapsedSec,
  isEndedStatus,
  isLiveStaff,
  isModeratorRole,
  liveErrorCode,
  otherModerators,
  requestQueue,
  roleKind,
  sexOf,
  staffNameMap,
  visibleName,
} from '@/components/live/liveUi';
import { useNow } from '@/components/live/LiveHomeCard';
import { BuddyInviteSheet } from '@/components/live/sheets/BuddyInviteSheet';
import { EndSheet } from '@/components/live/sheets/EndSheet';
import { GuestSpeakSheet } from '@/components/live/sheets/GuestSpeakSheet';
import { IdentitySheet } from '@/components/live/sheets/IdentitySheet';
import { ManageSheet, type ManageRow } from '@/components/live/sheets/ManageSheet';
import { PeopleSheet } from '@/components/live/sheets/PeopleSheet';
import { PersonSheet } from '@/components/live/sheets/PersonSheet';
import { RequestSheet } from '@/components/live/sheets/RequestSheet';
import { ShareSheet } from '@/components/live/sheets/ShareSheet';
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
/** Room states in which speaking/moderation controls can reach the server. */
const ACTIVE_CONNS: ReadonlySet<LiveConn> = new Set<LiveConn>(['ok', 'poor', 'hostdrop']);
/** iOS can't present a Modal while another one is still dismissing. */
const SHEET_SWAP_MS = Platform.OS === 'ios' ? 400 : 0;

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
  // P4
  const micOn = useLiveStore((s) => s.micOn);
  const handBusy = useLiveStore((s) => s.handBusy);
  const micBusy = useLiveStore((s) => s.micBusy);
  const allowRequests = useLiveStore((s) => s.allowRequests);
  const raiseHand = useLiveStore((s) => s.raiseHand);
  const lowerHand = useLiveStore((s) => s.lowerHand);
  const setMic = useLiveStore((s) => s.setMic);
  const stepDown = useLiveStore((s) => s.stepDown);
  const handOver = useLiveStore((s) => s.handOver);
  const endForAll = useLiveStore((s) => s.endForAll);

  const joinedHere = !!id && storeSession?.id === id;
  const session: LiveSessionPublic | null = sessionQ.data ?? (joinedHere ? storeSession : null);
  const roomConn: LiveConn = joinedHere ? conn : 'idle';

  const [step, setStep] = useState<Step>('idle');
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [identityMode, setIdentityMode] = useState<'join' | 'change'>('join');
  const [guestGateOpen, setGuestGateOpen] = useState(false);
  // P4 sheets: one attendee (person / request), «إدارة المجلس», «مغادرة الحلقة» (staff).
  const [target, setTarget] = useState<{ kind: 'person' | 'request'; id: string } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  // P5: «مشاركة رابط البث» → «ادعُ رفيقك إلى الحلقة».
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

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
    // Once only: a hand-over leaves the store (→ the «left from elsewhere»
    // effect) AND closes the room itself — a second collapse() would pop the
    // screen underneath too.
    if (closing.current) return;
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

  // ── P4: speaking & moderation ──────────────────────────────────────────────
  const myRole = joinedHere ? me?.role : undefined;
  const isMod = isModeratorRole(myRole);
  const active = ACTIVE_CONNS.has(roomConn);
  const mine = me && joinedHere ? people[me.identity] : undefined;
  const requestIds = useMemo(() => (isMod ? requestQueue(people) : []), [isMod, people]);

  const personName = useCallback(
    (pid: string) => {
      const p = people[pid];
      if (!p) return '';
      return roleKind(p.role) === 'host' && sheikhName ? sheikhName : nameOf(pid, p);
    },
    [people, sheikhName, nameOf],
  );

  // Swap one sheet for another (close first; iOS needs the first one gone).
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapSheet = useCallback((close: () => void, open: () => void) => {
    close();
    if (swapTimer.current) clearTimeout(swapTimer.current);
    if (!SHEET_SWAP_MS) {
      open();
      return;
    }
    swapTimer.current = setTimeout(() => {
      swapTimer.current = null;
      open();
    }, SHEET_SWAP_MS);
  }, []);

  // «إنهاء البث للجميع» → 5-second undo → endForAll(). The timer lives here so
  // closing the sheet keeps it. Leaving the screen during the undo does NOT
  // cancel: the host confirmed, so the end goes through at once (only «تراجع»
  // cancels) — otherwise a minimised room would keep broadcasting while he
  // believes it ended.
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (endTimer.current) {
        clearTimeout(endTimer.current);
        endTimer.current = null;
        void useLiveStore.getState().endForAll().catch(() => undefined);
      }
      if (swapTimer.current) clearTimeout(swapTimer.current);
    },
    [],
  );
  const startEnding = useCallback(() => {
    if (endTimer.current) clearTimeout(endTimer.current);
    setEndError(null);
    setEnding(true);
    endTimer.current = setTimeout(() => {
      endTimer.current = null;
      setEnding(false);
      endForAll().catch((e: unknown) => setEndError(controlErrorText(e)));
    }, END_UNDO_MS);
  }, [endForAll]);
  const undoEnding = useCallback(() => {
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = null;
    setEnding(false);
  }, []);

  // Guests keep the «سجّل أولاً» path (onRequest); registered people get P4 controls.
  let speak: DockSpeak | undefined;
  if (!user?.isGuest && joinedHere && me) {
    speak =
      me.role === 'listener'
        ? {
            kind: 'hand',
            up: !!mine?.hand,
            busy: handBusy,
            closed: !allowRequests,
            disabled: !active,
            onRaise: () => raiseHand(),
            onLower: () => lowerHand(),
          }
        : {
            kind: 'mic',
            on: micOn,
            busy: micBusy,
            disabled: !active,
            onToggle: () => void setMic(!micOn),
            onStepDown: me.role === 'speaker' ? () => void stepDown() : undefined,
          };
  }

  const onLeave = () => {
    // The host and moderators choose: leave (the broadcast goes on) or end it for all.
    if (isMod && roomConn !== 'failed') {
      setEndOpen(true);
      return;
    }
    exit();
    void leave();
  };

  const manageRows = (ids: readonly string[]): ManageRow[] =>
    ids.flatMap((pid) => {
      const p = people[pid];
      return p ? [{ identity: pid, person: p, name: personName(pid) }] : [];
    });
  const targetPerson = target ? (people[target.id] ?? null) : null;

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

  // P5 share / invite. The link is for a session on air; inviting needs a
  // registered listener who is IN the room (invite_buddy_to_live checks it).
  const canShare = !ended && status === 'live' && !!session?.shareCode;
  const canInvite = !!user && !user.isGuest && joinedHere;
  const viewerSex = sexOf(me?.gender ?? user?.gender);
  const presentIdentities = useMemo(() => new Set(Object.keys(people)), [people]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgSand }}>
      <TopBar
        conn={ended ? 'ended' : roomConn}
        startedAt={session?.startedAt ?? null}
        onMinimize={collapse}
        onPeople={() => setPeopleOpen(true)}
        showPeople={joinedHere && !ended}
        onManage={isMod && !ended ? () => setManageOpen(true) : undefined}
        onShare={canShare ? () => setShareOpen(true) : undefined}
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
                onPersonPress={isMod ? (pid) => setTarget({ kind: 'person', id: pid }) : undefined}
                dim={bad}
              />
            ) : null}
            <LiveStageMessage
              conn={roomConn === 'idle' ? 'connecting' : roomConn}
              failedSub={failedSub}
              onRetry={session ? () => doJoin(session, preferredIdentity ?? undefined) : undefined}
            />
            {joinedHere ? (
              <View
                pointerEvents="box-none"
                style={{ position: 'absolute', left: 14, right: 14, bottom: 8, gap: 8, zIndex: 4 }}
              >
                {ending ? <LiveUndoBar onUndo={undoEnding} /> : null}
                {endError ? (
                  <LiveNoticePill text={endError} icon="alert-circle" onPress={() => setEndError(null)} />
                ) : null}
                <LiveNoticeBar />
              </View>
            ) : null}
          </View>

          {isMod && active && requestIds.length ? (
            <RequestsStrip
              ids={requestIds}
              people={people}
              nameOf={personName}
              onOpen={(rid) => setTarget({ kind: 'request', id: rid })}
              onManage={() => setManageOpen(true)}
            />
          ) : null}

          {!entering && roomConn !== 'failed' ? (
            <AttendanceLine brothers={counts.brothers} sisters={counts.sisters} />
          ) : null}

          <LiveDock
            conn={roomConn}
            bottomInset={insets.bottom}
            onLeave={onLeave}
            onPeople={() => setPeopleOpen(true)}
            onRequest={user?.isGuest ? () => setGuestGateOpen(true) : undefined}
            speak={speak}
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
          onSelectPerson={
            isMod
              ? (pid) =>
                  swapSheet(
                    () => setPeopleOpen(false),
                    () => setTarget({ kind: 'person', id: pid }),
                  )
              : undefined
          }
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

      {joinedHere && isMod ? (
        <>
          <RequestSheet
            visible={target?.kind === 'request'}
            onClose={() => setTarget(null)}
            identity={target?.kind === 'request' ? target.id : null}
            person={target?.kind === 'request' ? targetPerson : null}
            name={target?.kind === 'request' ? personName(target.id) : ''}
          />
          <PersonSheet
            visible={target?.kind === 'person'}
            onClose={() => setTarget(null)}
            identity={target?.kind === 'person' ? target.id : null}
            person={target?.kind === 'person' ? targetPerson : null}
            name={target?.kind === 'person' ? personName(target.id) : ''}
            canModerate={isMod}
          />
          <ManageSheet
            visible={manageOpen}
            onClose={() => setManageOpen(false)}
            allowRequests={allowRequests}
            speakers={manageRows(currentSpeakers(people))}
            requests={manageRows(requestIds)}
            onOpenPerson={(pid) =>
              swapSheet(
                () => setManageOpen(false),
                () => setTarget({ kind: 'person', id: pid }),
              )
            }
            onOpenRequest={(rid) =>
              swapSheet(
                () => setManageOpen(false),
                () => setTarget({ kind: 'request', id: rid }),
              )
            }
          />
          <EndSheet
            visible={endOpen}
            onClose={() => setEndOpen(false)}
            sectionTitle={session?.sectionTitle ?? null}
            isHost={myRole === 'host'}
            canEndAll={canEndForAll(myRole, user)}
            moderators={otherModerators(people).map((mid) => ({ identity: mid, name: personName(mid) }))}
            onLeave={() => {
              setEndOpen(false);
              exit();
              void leave();
            }}
            onHandOver={async (mid) => {
              await handOver(mid); // host_leave, then the store leaves the room
              setEndOpen(false);
              exit();
            }}
            onEnd={() => {
              setEndOpen(false);
              startEnding();
            }}
          />
        </>
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

      <ShareSheet
        visible={shareOpen && canShare}
        onClose={() => setShareOpen(false)}
        session={session}
        canInvite={canInvite}
        gender={viewerSex}
        onInvite={() =>
          swapSheet(
            () => setShareOpen(false),
            () => setInviteOpen(true),
          )
        }
      />

      {canInvite && id ? (
        <BuddyInviteSheet
          visible={inviteOpen && !ended}
          onClose={() => setInviteOpen(false)}
          sessionId={id}
          gender={viewerSex}
          presentIdentities={presentIdentities}
        />
      ) : null}

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
  onManage,
  onShare,
}: {
  conn: LiveConn;
  startedAt: string | null;
  onMinimize: () => void;
  onPeople: () => void;
  showPeople: boolean;
  /** Moderators: «إدارة المجلس». */
  onManage?: () => void;
  /** P5: «مشاركة رابط البث» (a live session with a share code). */
  onShare?: () => void;
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
        {conn === 'ended' ? null : conn === 'idle' || conn === 'connecting' ? (
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
      {showPeople || onShare ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {onShare ? (
            <IconButton icon="share-2" iconSize={17} onPress={onShare} accessibilityLabel={LIVE_P5_COPY.share} />
          ) : null}
          {showPeople && onManage ? (
            <IconButton icon="sliders" iconSize={17} onPress={onManage} accessibilityLabel={LIVE_P4_COPY.manage} />
          ) : null}
          {showPeople ? (
            <IconButton icon="users" iconSize={18} onPress={onPeople} accessibilityLabel="من في الحلقة" />
          ) : null}
        </View>
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

/**
 * Moderators: raised hands, oldest first (§7.6 requests strip). The leading
 * chip opens «إدارة المجلس»; each person chip opens RequestSheet.
 */
function RequestsStrip({
  ids,
  people,
  nameOf,
  onOpen,
  onManage,
}: {
  ids: readonly string[];
  people: Readonly<Record<string, LivePerson>>;
  nameOf: (id: string) => string;
  onOpen: (id: string) => void;
  onManage: () => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 8, gap: 8, alignItems: 'center' }}
    >
      <Pressable
        onPress={onManage}
        accessibilityRole="button"
        accessibilityLabel={`${LIVE_P4_COPY.requests} · ${arNum(ids.length)}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 36,
          paddingHorizontal: 12,
          borderRadius: radius.pill,
          backgroundColor: colors.accentBrass,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <HandGlyph size={15} color={colors.primaryTealDeep} />
        <Txt size={12.5} weight="semibold" color={colors.primaryTealDeep} tabular>
          {`${LIVE_P4_COPY.requests} · ${arNum(ids.length)}`}
        </Txt>
      </Pressable>
      {ids.map((pid) => {
        const p = people[pid];
        if (!p) return null;
        const name = nameOf(pid);
        const f = sexOf(p.gender) === 'f';
        return (
          <Pressable
            key={pid}
            onPress={() => onOpen(pid)}
            accessibilityRole="button"
            accessibilityLabel={`${name} · ${f ? 'تطلب الكلمة' : 'يطلب الكلمة'}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              height: 36,
              paddingStart: 4,
              paddingEnd: 12,
              borderRadius: radius.pill,
              backgroundColor: colors.surfaceCard,
              borderWidth: 1,
              borderColor: 'rgba(176,137,79,0.35)',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <LiveAvatar gender={f ? 'f' : 'm'} size={28} />
            <Txt size={12.5} weight="medium" numberOfLines={1} style={{ maxWidth: 130 }}>
              {name}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
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
