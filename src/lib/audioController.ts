/**
 * The single owner of the expo-audio player instance.
 *
 * Everything that plays audio (Home feature card, section rows, mini player,
 * full player) calls these functions; they drive `usePlayerStore` and persist
 * progress. Keeping one player + one writer avoids the "two things playing"
 * class of bugs and keeps play/pause state consistent everywhere (PRD §8).
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import * as Linking from 'expo-linking';

import { COMPLETE_THRESHOLD, MAX_LISTEN_TICK_SEC } from '@/config';
import { getLecturePlayback, getNextLecture, getPreviousLecture } from '@/api/lectures';
import { saveLectureProgress } from '@/api/progress';
import { queryKeys } from '@/constants/queryKeys';
import { isOnlineSync, onReconnect } from '@/lib/connectivity';
import { localUriFor, readDownloadMeta, updateDownloadPosition } from '@/lib/downloads';
import { queryClient } from '@/lib/queryClient';
import { readResumePosition, saveResumePosition } from '@/lib/resumeCache';
import { usePlayerStore, type PlaybackRate } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';

// Reuse window for a prefetched playback entry (V11 · D). Kept well under the
// signed-URL TTL (3600s) so a cached URL served to the player is always valid; a
// staler (e.g. persisted) entry is past this and gets refetched fresh.
const LECTURE_PLAYBACK_STALE = 30 * 60_000;

/**
 * Warm a lecture's playback metadata (+ signed URL) into the same cache entry the
 * player reads (queryKeys.lecture). Makes auto-advance / the "next" button and the
 * resume card gapless. No-op offline (skipped by the caller) or while still fresh.
 *
 * Exported so lecture ROWS can warm themselves while just sitting on screen (see
 * LectureRowItem) — tap-time preloading alone (`preloadLecture`) still pays the
 * full signed-URL network round-trip for a lecture nobody has looked at yet; this
 * is what makes a tap on an already-warmed row start with no network wait at all.
 */
export function prefetchPlayback(lectureId: string) {
  void queryClient.prefetchQuery({
    queryKey: queryKeys.lecture(lectureId),
    queryFn: () => getLecturePlayback(lectureId),
    staleTime: LECTURE_PLAYBACK_STALE,
  });
}

let player: AudioPlayer | null = null;
let currentId: string | null = null;
let currentDuration = 0;
let currentSectionId: string | null = null;
let currentOrder = 0;
let lastSavedAt = 0;
// V11 · C: the forward listened delta is computed here (no prev SELECT) — track
// the last position we credited, whether we've saved this track yet (firstTouch),
// and whether we've already reported this track's completion (so a re-listen or a
// second tick past 90% doesn't re-fire completion badges/praise). Reset on load.
let lastSavedPos = 0;
let hasSavedTrack = false;
let trackCompleted = false;
let audioModeSet = false;
// A programmatic seek can make the player emit `didJustFinish` (e.g. it clamps a
// past-the-end target to the end). Finishes within this window are ignored so a
// seek never trips completion / auto-advance (Issue 7).
let seekGuardUntil = 0;
// True once the current track has reached its natural end. A player in that
// native ENDED state cannot be reliably revived with `replace()` + `play()`
// (same class of bug that made stop() fully release the instance), so the next
// load recreates the player from scratch instead of reusing it. Cleared when a
// fresh player starts. This is the fix for "auto-advance leaves the next lecture
// silent until you fully close and reopen the player".
let justFinished = false;
// The lecture id we have already auto-advanced FROM, so a repeated
// `didJustFinish` for the same ended track can never fire auto-advance twice.
// Naturally resets when the next track becomes current (its id differs).
let lastAutoAdvancedFrom: string | null = null;
// Monotonic load token. Each `loadLecture` bumps it and captures its own value;
// after any await, a load whose token is no longer current bails before mutating
// shared player state. This makes rapid track switching deterministic — tap A
// then quickly tap B (or an auto-advance racing a manual tap) — the LAST
// requested lecture always wins, and a slow-resolving earlier load can never
// clobber it or flash its track onto the screen.
let loadGen = 0;

/** Options accepted by the load path. `restart` forces playback from 0:00.
 * `_isErrorRetry` is internal-only (see `onStatus`'s error handling below) — it
 * marks a load as a silent auto-retry so it doesn't reset `errorRetryCount`. */
type LoadOpts = { startAtSec?: number; restart?: boolean; _isErrorRetry?: boolean };

// A streamed track's `status.error` is often a transient hiccup (weak/flapping
// signal) rather than a real failure — expo-audio has no built-in retry, so left
// alone every hiccup immediately surfaced the hard "تعذّر تشغيل" notice. Give it a
// couple of silent rebuild attempts first; only the last one — the track that
// really can't play — reaches the user. Reset whenever a genuinely new load
// starts (loadLectureBody, below), so this can't itself become an infinite loop.
const MAX_ERROR_RETRIES = 2;
const ERROR_RETRY_DELAY_MS = 1500;
let errorRetryCount = 0;

// Force the next startPlayer to recreate the native player from scratch rather
// than `replace()`. Set by connectivity recovery: a stream that stalled or
// errored while the network was gone may be in a native state a bare replace()
// can't revive, so we rebuild it — same reasoning as the `justFinished` path.
let forceFreshPlayer = false;

// Hard ceiling on the signed-URL resolution before we stop waiting (weak/flaky
// signal). Without it, `ensureQueryData` (networkMode 'offlineFirst', no wired
// timeout) can hang far past what reads as "the player is stuck" to the user.
// On timeout the load rejects → the player screen shows its calm offline/retry
// notice instead of an endless spinner.
const PLAYBACK_FETCH_TIMEOUT_MS = 15_000;

/** Reject `p` if it hasn't settled within `ms` (used to bound the URL fetch). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('playback fetch timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
// The lecture currently being loaded by `loadLecture` (set synchronously before
// any await, cleared when it settles). Lets `preloadLecture` no-op a redundant
// call for the SAME lecture that's already in flight — e.g. a row's onPress
// starts the load, then the player screen mounts a beat later and would
// otherwise kick off a second, wasted load (Issue: tap→play delay fix below).
let pendingId: string | null = null;

const store = () => usePlayerStore.getState();

async function ensureAudioMode() {
  if (audioModeSet) return;
  audioModeSet = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      // Required for the system lock-screen / shade media controls to bind to our
      // player (expo-audio only associates them under exclusive focus). It also
      // means starting a lecture pauses other apps' audio — right for a lesson.
      interruptionMode: 'doNotMix',
    });
  } catch {
    // Non-fatal (e.g. web) — playback still works.
  }
}

/** Which transport buttons the system media controls should show. */
const LOCK_SCREEN_OPTIONS = { showSeekForward: true, showSeekBackward: true } as const;

/**
 * Lock-screen metadata. Superset of expo-audio's `AudioMetadata` — `durationMs`
 * and `deepLinkUri` are consumed by our expo-audio patch (see patches/): the
 * former populates the scrubber (streaming duration isn't on the MediaItem, so
 * the bar is empty without it), the latter makes a notification tap open the
 * full player instead of just the launcher.
 */
type LockScreenMetadata = {
  title?: string;
  artist?: string;
  albumTitle?: string;
  artworkUrl?: string;
  durationMs?: number;
  deepLinkUri?: string;
};

/**
 * Publish the current track to the OS media controls (lock screen + notification
 * shade), backed by expo-audio's built-in MediaSession + foreground service. This
 * keeps audio alive when backgrounded/closed and surfaces prev / play-pause / next
 * + a live position scrubber, the title/sheikh — all driven by the SAME player, so
 * the system controls and the in-app mini/full player stay in sync.
 *
 * Idempotent: calling it again for the same player just refreshes the metadata
 * (e.g. after auto-advancing to the next lecture). Guarded so web (no lock-screen
 * API) and any native hiccup stay non-fatal.
 */
function syncLockScreen() {
  if (!player) return;
  const s = store();
  const id = currentId;
  const metadata: LockScreenMetadata = {
    title: s.title ?? '',
    artist: s.sheikhName ?? undefined,
    durationMs: s.durationSec > 0 ? Math.round(s.durationSec * 1000) : undefined,
    deepLinkUri: id ? Linking.createURL(`/player/${id}`) : undefined,
  };
  try {
    player.setActiveForLockScreen(true, metadata, LOCK_SCREEN_OPTIONS);
  } catch {
    // Non-fatal (e.g. web, or lock-screen controls unavailable).
  }
}

function onStatus(status: AudioStatus) {
  const s = store();
  // Duration truth (Issue 7): for a STREAMING source `status.duration` is often
  // 0/absent, so also fall back to the player's own known duration. Whichever is
  // a real (>0) value is the single source of truth — the DB `duration_sec` is
  // only a seed and is frequently inaccurate, which would otherwise make the
  // waveform map a tap to the wrong absolute second (and over-seek past the end).
  const reported =
    status.duration && status.duration > 0
      ? status.duration
      : player?.duration && player.duration > 0
        ? player.duration
        : 0;
  if (reported > 0 && reported !== currentDuration) {
    const wasSeed = currentDuration <= 0 || Math.abs(reported - currentDuration) > 1;
    currentDuration = reported;
    s.setDuration(reported);
    // Refresh the lock-screen scrubber max the first time the real length lands.
    if (wasSeed) syncLockScreen();
  }
  // Hard clamp (Plan 5 · item 8): some sources report `currentTime` running
  // 30-40s past the known duration for a few ticks right before playback
  // actually stops — never let the UI (or a persisted position) show a value
  // past the track's own length.
  const rawPosition = status.currentTime ?? 0;
  const clampedPosition = currentDuration > 0 ? Math.min(rawPosition, currentDuration) : rawPosition;
  s.setPosition(clampedPosition);
  s.setPlaying(status.playing);
  if (status.isLoaded) s.setLoading(false);

  // Mid-playback re-buffering (weak/lost signal): the track is already loaded and
  // has played into the timeline (position > 0) but has run dry waiting for more
  // data. Surface it as a calm "reconnecting" hint (distinct from the initial-open
  // spinner, which the position>0 gate keeps this off) so it never looks like a
  // frozen player. Clears the instant audio flows again. A user pause reports
  // isBuffering:false, so this won't false-positive on a deliberate pause.
  const stalled =
    !!status.isBuffering && status.isLoaded && clampedPosition > 0 && !status.didJustFinish;
  if (stalled !== s.isStalled) s.setStalled(stalled);

  // Phase 3.5 — expo-audio surfaces a load/playback failure (e.g. logcat's
  // `PlaybackState state=ERROR(7) error="Source error"`) via `status.error`, which
  // was previously read nowhere: `isLoading` only clears `if (status.isLoaded)`,
  // so an error that never reaches `isLoaded: true` left the spinner stuck
  // indefinitely. Surface it in the store so the player screen can show a calm
  // retry state instead. Cleared the moment a status without an error arrives
  // (a fresh load, or the SDK's own recovery) so a resolved failure doesn't keep
  // showing the retry UI.
  if (status.error) {
    const id = currentId;
    if (id && errorRetryCount < MAX_ERROR_RETRIES) {
      // Silent retry: rebuild the player from where it failed, no error shown yet.
      errorRetryCount++;
      const at = player?.currentTime ?? s.positionSec;
      forceFreshPlayer = true;
      s.setLoading(true);
      setTimeout(() => {
        if (currentId !== id) return; // superseded by a newer load — drop it
        void loadLecture(id, { startAtSec: at, _isErrorRetry: true });
      }, ERROR_RETRY_DELAY_MS);
    } else {
      s.setLoading(false);
      s.setPlaying(false);
      s.setLoadError(status.error);
    }
  } else if (s.loadError) {
    s.setLoadError(null);
  }

  // Persist progress at most every ~5s while playing.
  const now = Date.now();
  if (status.playing && currentId && now - lastSavedAt > 5000) {
    lastSavedAt = now;
    void persist(clampedPosition);
  }

  if (status.didJustFinish && currentId && currentId !== lastAutoAdvancedFrom) {
    // Ignore a finish that a just-issued seek produced (Issue 7) — it is not a
    // real end-of-lecture, so it must not mark complete or auto-advance.
    if (Date.now() < seekGuardUntil) return;
    // Remember which track we've handled so a repeated `didJustFinish` for the
    // same ended track can't fire completion / auto-advance twice.
    lastAutoAdvancedFrom = currentId;
    // The track ended — the native player is now in an ENDED state; flag it so
    // the next load recreates the player instead of trying to `replace()` on a
    // dead instance (which would start the next lecture silent).
    justFinished = true;
    // Force completion (position = duration → ≥90% threshold).
    void persist(currentDuration || status.currentTime || 0, true);
    invalidateProgressViews();
    s.setPlaying(false);
    // Auto-advance to the next lecture in the section, if enabled and one exists.
    if (useSettingsStore.getState().autoAdvance && s.nextLectureId) {
      void playLecture(s.nextLectureId);
    }
  }
}

/**
 * Resolve (async) the next lecture in the current section and publish its id to
 * the store, so the "next" control + auto-advance know whether one exists. The
 * `forId` guard discards a stale result if the track changed meanwhile.
 */
function resolveNext() {
  const forId = currentId;
  const sectionId = currentSectionId;
  const order = currentOrder;
  if (!sectionId) {
    store().setNext(null);
    return;
  }
  void getNextLecture(sectionId, order)
    .then((next) => {
      if (currentId !== forId) return;
      store().setNext(next?.id ?? null);
      // Prefetch the next lecture's playback so auto-advance is gapless (V11 · D);
      // skip offline (the fetch would fail — local playback still works without it).
      if (next?.id && isOnlineSync()) prefetchPlayback(next.id);
    })
    .catch(() => {
      if (currentId === forId) store().setNext(null);
    });
}

/** Play the resolved next lecture (manual "next" button). No-op at the end. */
export function playNext() {
  const nextId = store().nextLectureId;
  if (nextId) void playLecture(nextId);
}

/**
 * Resolve (async) the previous lecture in the current section and publish its id
 * to the store, so the "previous" control knows whether one exists. Mirror of
 * {@link resolveNext}; the `forId` guard discards a stale result on track change.
 */
function resolvePrev() {
  const forId = currentId;
  const sectionId = currentSectionId;
  const order = currentOrder;
  if (!sectionId) {
    store().setPrev(null);
    return;
  }
  void getPreviousLecture(sectionId, order)
    .then((prev) => {
      if (currentId === forId) store().setPrev(prev?.id ?? null);
    })
    .catch(() => {
      if (currentId === forId) store().setPrev(null);
    });
}

/** Play the resolved previous lecture (manual "previous" button). No-op at the start. */
export function playPrev() {
  const prevId = store().prevLectureId;
  if (prevId) void playLecture(prevId);
}

/**
 * Section/Home rollups now cache for 5min (P4 perf plan) — refresh them at the
 * natural "the student just stopped listening" moments (pause/stop/finish)
 * rather than on every 5s tick, so a just-updated progress % doesn't look
 * stale if they immediately navigate back to the section.
 *
 * Also invalidates THIS lecture's own `queryKeys.lecture` entry (Phase 3.1 fix):
 * that cache entry embeds `positionSec` (read by `getLecturePlayback`), and it's
 * the SAME entry `playLecture()`'s streaming path seeks to via `ensureQueryData`
 * on the next open. Without this, a pause/stop/finish updates the Home resume
 * card (via the `home` invalidation below) but leaves the player's own
 * resume-seek value pinned to whatever was cached up to 30 minutes ago (or
 * indefinitely across a restart, since a fresh-looking persisted entry never
 * re-prefetches) — the two disagree. Invalidating (rather than refetching here)
 * is enough: `ensureQueryData` respects `isInvalidated` regardless of staleTime,
 * so the NEXT open always re-reads the true server position. Applies identically
 * to guest and signed-in sessions — this is a client-cache fix, not gated on auth.
 */
function invalidateProgressViews() {
  void queryClient.invalidateQueries({ queryKey: queryKeys.home });
  if (currentSectionId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.section(currentSectionId) });
  }
  if (currentId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lecture(currentId) });
  }
}

/**
 * Reset the per-track progress bookkeeping when a new lecture loads (V11 · C).
 * `lastSavedPos` seeds from the resume position so the first tick's delta is the
 * seconds listened SINCE resuming, not the whole resume offset.
 */
function resetTrackProgress(positionSec: number) {
  lastSavedPos = Math.max(0, Math.round(positionSec));
  hasSavedTrack = false;
  trackCompleted = false;
}

function persist(positionSec: number, finished = false) {
  if (!currentId) return Promise.resolve();
  // On finish, save the full duration — but if the real duration never resolved
  // (still 0), fall back to the last known position instead of resetting to 0.
  const pos = finished ? currentDuration || positionSec : positionSec;
  // Mirror the resume position into the download sidecar (no-op unless the
  // lecture is downloaded) so it resumes at the same second when played OFFLINE,
  // where the server progress row is unreachable.
  updateDownloadPosition(currentId, pos);
  // Also mirror it into the local resume cache — unlike the download sidecar
  // above, this covers EVERY lecture (downloaded or streamed-only), closing
  // the gap where a streamed lecture has no local fallback if the persisted
  // query cache goes stale relative to disk across a force-kill.
  saveResumePosition(currentId, pos);

  // Derive everything saveLectureProgress used to fetch (V11 · C — no prev SELECT):
  const posInt = Math.max(0, Math.round(pos));
  const reachedThreshold =
    finished || (currentDuration > 0 && posInt / currentDuration >= COMPLETE_THRESHOLD);
  const justCompleted = reachedThreshold && !trackCompleted;
  if (justCompleted) trackCompleted = true;
  const firstTouch = !hasSavedTrack;
  // Forward movement only, capped — a scrub-forward can't inflate listening time.
  const deltaSec = Math.max(0, Math.min(posInt - lastSavedPos, MAX_LISTEN_TICK_SEC));
  lastSavedPos = posInt;
  hasSavedTrack = true;

  return saveLectureProgress({
    lectureId: currentId,
    positionSec: pos,
    durationSec: currentDuration,
    deltaSec,
    completed: reachedThreshold,
    justCompleted,
    firstTouch,
  }).catch(() => {});
}

/** Create a fresh player for `source` with its status + media-control listeners. */
function createPlayer(source: string): AudioPlayer {
  const p = createAudioPlayer({ uri: source }, { updateInterval: 1000 });
  p.addListener('playbackStatusUpdate', onStatus);
  // Lock-screen / notification prev·next (from our expo-audio patch) arrive as a
  // `mediaControlAction` event; route them through the same section-aware
  // controller the in-app buttons use. Event name isn't in expo-audio's types.
  (p.addListener as (name: string, cb: (e: { action?: string }) => void) => void)(
    'mediaControlAction',
    (e) => {
      if (e?.action === 'next') playNext();
      else if (e?.action === 'prev') playPrev();
    },
  );
  return p;
}

/** Fully release the current player (drop its lock-screen session + listeners). */
function teardownPlayer() {
  if (!player) return;
  try {
    player.pause();
  } catch {
    /* ignored */
  }
  try {
    player.setActiveForLockScreen(false);
  } catch {
    /* ignored */
  }
  try {
    player.remove();
  } catch {
    /* ignored */
  }
  player = null;
}

/** Create-or-replace the player for `source`, seek to `positionSec`, and play.
 * `gen` is the caller's load token — after the seek await, a superseded start
 * (rapid track switching, or stop()) bails instead of seeking/playing whatever
 * player instance is current by then. */
async function startPlayer(source: string, positionSec: number, gen: number) {
  // If the previous track reached its natural end, the native player is in an
  // ENDED state that `replace()` + `play()` can't reliably restart from (it goes
  // silent — the same failure stop() avoids by fully releasing). Recreate it from
  // scratch here. A mid-play switch (next/prev while still playing) keeps the
  // cheaper, gapless `replace()` path below.
  if (player && (justFinished || forceFreshPlayer)) {
    teardownPlayer();
  }
  justFinished = false;
  forceFreshPlayer = false;
  if (!player) {
    player = createPlayer(source);
  } else {
    player.replace({ uri: source });
  }
  player.setPlaybackRate(store().rate);
  if (positionSec > 0) {
    try {
      await player.seekTo(positionSec);
    } catch {
      /* seek before load can throw — ignored, status will catch up */
    }
  }
  if (gen !== loadGen || !player) return;
  player.play();
  store().setPlaying(true);
  // Bind/refresh the lock-screen + shade controls for whatever track just loaded.
  syncLockScreen();
}

/**
 * Load (if needed) and play a lecture. Tapping the lecture that's already loaded
 * just toggles play/pause. Resumes from the saved position.
 *
 * Offline-first + fast-start: a DOWNLOADED lecture starts from its local file and
 * cached sidecar IMMEDIATELY — no waiting on the network — then refreshes the
 * section context (next/prev) and the freshest server resume position in the
 * background (seeking forward only). A streaming lecture must await its signed
 * URL, so it still resolves metadata first.
 */
export async function playLecture(lectureId: string, opts?: LoadOpts) {
  if (!lectureId) return;
  if (currentId === lectureId && player) {
    return toggle();
  }
  return loadLecture(lectureId, opts);
}

/**
 * Start a lecture WITHOUT the toggle-if-already-current branch `playLecture`
 * has — safe to fire eagerly the instant a row is tapped, in parallel with the
 * `router.push` to the player screen, rather than waiting for that screen to
 * mount. The player screen's own mount effect calls this too (as a fallback
 * for entry points that don't pre-start it, e.g. a notification deep link);
 * the `pendingId`/`currentId` checks make the second call a no-op instead of
 * re-loading or — worse — pausing what the first call just started.
 */
export function preloadLecture(lectureId: string, opts?: LoadOpts) {
  if (!lectureId) return Promise.resolve();
  if (currentId === lectureId || pendingId === lectureId) return Promise.resolve();
  return loadLecture(lectureId, opts);
}

async function loadLecture(lectureId: string, opts?: LoadOpts) {
  // Switching to a genuinely different lecture — pause whatever's currently
  // playing right away. Without this, a NEW lecture that fails to load (e.g.
  // offline and not downloaded) left the OLD one playing silently behind the
  // screen showing the "needs a connection" notice — reported as "opening a
  // different lecture doesn't change anything" while offline.
  if (currentId && currentId !== lectureId && player?.playing) {
    // Save the outgoing track's position first — the last periodic tick can be
    // up to ~5s stale, and that listening progress would otherwise be lost.
    void persist(player.currentTime ?? store().positionSec);
    player.pause();
    store().setPlaying(false);
  }
  const gen = ++loadGen;
  pendingId = lectureId;
  try {
    await loadLectureBody(lectureId, gen, opts);
  } finally {
    if (pendingId === lectureId) pendingId = null;
  }
}

async function loadLectureBody(lectureId: string, gen: number, opts?: LoadOpts) {
  if (!opts?._isErrorRetry) errorRetryCount = 0;
  await ensureAudioMode();
  // A newer load superseded us while awaiting audio-mode setup — abandon this
  // one so it can't commit a stale track over the newer one (rapid switching).
  if (gen !== loadGen) return;

  const localUri = localUriFor(lectureId);
  const meta = localUri ? readDownloadMeta(lectureId) : null;

  // ── Fast path: downloaded + cached sidecar → start now, refresh later. ──
  if (localUri && meta) {
    let positionSec = meta.positionSec ?? 0;
    // Also consult the local resume cache — it can be more current than the
    // download sidecar (e.g. this lecture was streamed before ever being
    // downloaded) — take whichever is larger, never rewind.
    const localResume = readResumePosition(lectureId);
    if (localResume && localResume.positionSec > positionSec) {
      positionSec = localResume.positionSec;
    }
    // A resume deep-link may ask to open ahead; honor it, never rewind (§8).
    if (opts?.startAtSec != null && opts.startAtSec > positionSec) {
      positionSec = opts.startAtSec;
    }
    // Replay-from-start (toggling play on a lecture that ran to its end) wins
    // over every resume source above.
    if (opts?.restart) positionSec = 0;

    currentId = lectureId;
    currentDuration = meta.durationSec;
    currentSectionId = null; // unknown until the background refresh lands
    currentOrder = 0;
    lastSavedAt = Date.now();
    // The new track is now current — clear the auto-advance guard so THIS track
    // (including a replay of the same id) can auto-advance when it finishes.
    lastAutoAdvancedFrom = null;
    resetTrackProgress(positionSec);

    store().setTrack({
      id: lectureId,
      title: meta.title,
      sheikhName: meta.sheikhName,
      durationSec: meta.durationSec,
      positionSec,
    });
    store().setLoading(true);
    void startPlayer(localUri, positionSec, gen);

    // Refresh section context (enables next/prev) + adopt the server resume
    // position if it's AHEAD. Fails silently offline — local playback is enough.
    void getLecturePlayback(lectureId)
      .then((data) => {
        if (currentId !== lectureId) return; // track changed meanwhile
        currentSectionId = data.sectionId;
        currentOrder = data.order;
        if (data.durationSec > 0) currentDuration = data.durationSec;
        resolveNext();
        resolvePrev();
        // Never let the server's (end-of-track) resume position yank a
        // deliberate replay-from-start back to the end.
        const here = player?.currentTime ?? positionSec;
        if (!opts?.restart && data.positionSec > here) void seekTo(data.positionSec);
      })
      .catch(() => {});
    return;
  }

  // Phase 3.7 fast-fail: offline + never downloaded → below, `ensureQueryData`
  // would still attempt a REAL network round-trip (`networkMode: 'offlineFirst'`
  // makes the first attempt regardless of connectivity) that has no timeout
  // wired anywhere, so it can hang far longer than reads as "perpetual" to a
  // waiting user before it finally rejects. Failing fast here instead makes the
  // player screen's existing `.catch(() => setUnavailable(true))` (app/player/[id].tsx)
  // show the calm "needs a connection" notice immediately instead of a
  // blank/spinning player. A DOWNLOADED lecture never reaches this line — it
  // already returned via the fast path above.
  if (!localUri && !isOnlineSync()) {
    throw new Error('offline and lecture not downloaded');
  }

  // ── Streaming path: needs the signed URL, so resolve metadata first. ──
  let title: string;
  let sheikhName: string | null;
  let durationSec: number;
  let positionSec: number;
  let source: string;
  let sectionId: string | null = null;
  let order = 0;

  try {
    // Reuse a freshly prefetched entry (gapless auto-advance / instant resume);
    // a stale or persisted entry is past the staleTime so it refetches a fresh
    // signed URL. Same cache entry the player screen reads (queryKeys.lecture).
    const data = await withTimeout(
      queryClient.ensureQueryData({
        queryKey: queryKeys.lecture(lectureId),
        queryFn: () => getLecturePlayback(lectureId),
        staleTime: LECTURE_PLAYBACK_STALE,
      }),
      PLAYBACK_FETCH_TIMEOUT_MS,
    );
    title = data.title;
    sheikhName = data.sheikhName;
    durationSec = data.durationSec;
    positionSec = data.positionSec;
    source = localUri ?? data.audioUrl;
    sectionId = data.sectionId;
    order = data.order;
  } catch (err) {
    // Offline fallback: play from disk using the cached metadata sidecar (only
    // reached when the sidecar was missing above, e.g. a pre-sidecar download).
    if (!localUri || !meta) throw err;
    title = meta.title;
    sheikhName = meta.sheikhName;
    durationSec = meta.durationSec;
    positionSec = meta.positionSec ?? 0;
    source = localUri;
  }

  // The signed-URL round-trip is the widest await in the load — a newer tap or
  // auto-advance may have superseded us while it was in flight. Bail before
  // committing so the stale lecture never clobbers the newer one (or plays over
  // it). This is the race the load token above exists for.
  if (gen !== loadGen) return;

  // Streamed-only lectures have no local sidecar (downloads.ts) to fall back
  // on if the query cache served a stale pre-force-kill position — consult
  // the resume cache here too and take whichever is larger, never rewind.
  const localResume = readResumePosition(lectureId);
  if (localResume && localResume.positionSec > positionSec) {
    positionSec = localResume.positionSec;
  }

  if (opts?.startAtSec != null && opts.startAtSec > positionSec) {
    positionSec = opts.startAtSec;
  }
  // Replay-from-start wins over every resume source above.
  if (opts?.restart) positionSec = 0;

  currentId = lectureId;
  currentDuration = durationSec;
  currentSectionId = sectionId;
  currentOrder = order;
  lastSavedAt = Date.now();
  // The new track is now current — clear the auto-advance guard so THIS track
  // (including a replay of the same id) can auto-advance when it finishes.
  lastAutoAdvancedFrom = null;
  resetTrackProgress(positionSec);

  store().setTrack({ id: lectureId, title, sheikhName, durationSec, positionSec });
  store().setLoading(true);
  resolveNext();
  resolvePrev();
  await startPlayer(source, positionSec, gen);
}

export function toggle() {
  if (!player) return;
  if (player.playing) {
    player.pause();
    store().setPlaying(false);
    void persist(player.currentTime ?? store().positionSec);
    invalidateProgressViews();
  } else {
    // Resuming a track that already ran to its natural end: the native player is
    // in an ENDED state where a bare play() is a silent no-op. Reload it fresh
    // from the start so "play" actually replays the finished lecture — reached
    // for the last lecture in a section, or when auto-advance is off.
    if (justFinished && currentId) {
      void loadLecture(currentId, { restart: true });
      return;
    }
    // The track errored out (e.g. MiniPlayer play tap after a stream failure —
    // it has no retry UI of its own): a bare play() on the dead instance is a
    // silent no-op, so rebuild from where it stopped instead.
    if (store().loadError && currentId) {
      forceFreshPlayer = true;
      void loadLecture(currentId, { startAtSec: player.currentTime ?? store().positionSec });
      return;
    }
    player.play();
    store().setPlaying(true);
  }
}

export function pause() {
  if (player?.playing) {
    player.pause();
    store().setPlaying(false);
    void persist(player.currentTime ?? store().positionSec);
    invalidateProgressViews();
  }
}

/**
 * Close the player entirely (the MiniPlayer ×): persist the final position,
 * stop audio, drop the lock-screen/notification controls, and reset the store
 * so `currentLectureId` becomes null and the MiniPlayer unmounts.
 *
 * The player instance is fully released (not just paused) — a paused player
 * with its lock-screen session torn down was left in a state where the NEXT
 * lecture's `player.replace()` + `.play()` could silently fail to actually
 * produce audio (the JS store said "playing" but nothing came out), reported
 * as "close a lecture, open another, it doesn't play". Releasing it here
 * makes the next `playLecture()` create a brand-new player via
 * `createAudioPlayer`, which always starts from a clean native state.
 */
export function stop() {
  if (player) {
    void persist(player.currentTime ?? store().positionSec);
    invalidateProgressViews();
    try {
      player.pause();
    } catch {
      /* ignored */
    }
    try {
      player.setActiveForLockScreen(false);
    } catch {
      /* ignored */
    }
    try {
      player.remove();
    } catch {
      /* ignored */
    }
  }
  player = null;
  currentId = null;
  currentDuration = 0;
  currentSectionId = null;
  currentOrder = 0;
  pendingId = null;
  justFinished = false;
  forceFreshPlayer = false;
  lastAutoAdvancedFrom = null;
  // Invalidate any load still in flight — without this, closing the player
  // while a (slow) lecture load was resolving let that load commit afterwards
  // and start playing a track the user had just dismissed.
  loadGen++;
  store().reset();
}

export async function seekTo(positionSec: number) {
  if (!player) return;
  // Clamp to the player's REAL timeline (Issue 7). `player.duration` is the
  // authoritative length once known; `currentDuration` is the best-known value
  // (real once a status carried it, else the DB seed). Staying a hair short of
  // the end keeps a seek from landing exactly at the end and firing
  // `didJustFinish` → unwanted auto-advance.
  const max = player.duration && player.duration > 0 ? player.duration : currentDuration;
  const target =
    max > 0 ? Math.min(Math.max(0, positionSec), Math.max(0, max - 0.25)) : Math.max(0, positionSec);
  seekGuardUntil = Date.now() + 1200;
  store().setPosition(target);
  try {
    await player.seekTo(target);
  } catch {
    /* ignored */
  }
}

export function seekBy(deltaSec: number) {
  const next = Math.max(0, (player?.currentTime ?? store().positionSec) + deltaSec);
  void seekTo(next);
}

export function setRate(rate: PlaybackRate) {
  store().setRate(rate);
  player?.setPlaybackRate(rate);
}

// ── Connectivity recovery ────────────────────────────────────────────────────
// When the network returns after a FULL drop (offline→online edge), recover a
// streamed lecture that couldn't survive it. Weak signal that never went fully
// offline won't fire this — expo-audio's own buffering resumes that case, shown
// meanwhile via `isStalled`. Registered once at module load; the callback runs
// later, so referencing the module state below is safe.
let lastReconnectRecoverAt = 0;
// Floor between two recovery attempts. A borderline signal can report several
// offline→online edges within a few seconds; without this floor each one kicked
// off its own full player rebuild, racing/aborting the previous one and
// producing a visible reload loop instead of one clean recovery.
const RECONNECT_RECOVER_COOLDOWN_MS = 4000;

onReconnect(() => {
  if (!currentId) return;
  const s = store();
  // Recover when: the track errored out, it's sitting stalled (buffer ran dry),
  // or the store intends to play but the native player has silently stopped.
  const shouldRecover =
    s.loadError != null || s.isStalled || (s.isPlaying && !!player && !player.playing);
  if (!shouldRecover) return;
  const now = Date.now();
  if (now - lastReconnectRecoverAt < RECONNECT_RECOVER_COOLDOWN_MS) return;
  lastReconnectRecoverAt = now;
  // Resume from where it stalled (never rewind); rebuild the native player since
  // a stalled/errored instance may not revive via a bare replace().
  const at = player?.currentTime ?? s.positionSec;
  forceFreshPlayer = true;
  void loadLecture(currentId, { startAtSec: at });
});
