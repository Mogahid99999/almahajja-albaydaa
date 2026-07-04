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

import { getLecturePlayback, getNextLecture, getPreviousLecture } from '@/api/lectures';
import { saveLectureProgress } from '@/api/progress';
import { queryKeys } from '@/constants/queryKeys';
import { localUriFor, readDownloadMeta, updateDownloadPosition } from '@/lib/downloads';
import { queryClient } from '@/lib/queryClient';
import { usePlayerStore, type PlaybackRate } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';

let player: AudioPlayer | null = null;
let currentId: string | null = null;
let currentDuration = 0;
let currentSectionId: string | null = null;
let currentOrder = 0;
let lastSavedAt = 0;
let audioModeSet = false;
// A programmatic seek can make the player emit `didJustFinish` (e.g. it clamps a
// past-the-end target to the end). Finishes within this window are ignored so a
// seek never trips completion / auto-advance (Issue 7).
let seekGuardUntil = 0;

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
  s.setPosition(status.currentTime ?? 0);
  s.setPlaying(status.playing);
  if (status.isLoaded) s.setLoading(false);

  // Persist progress at most every ~5s while playing.
  const now = Date.now();
  if (status.playing && currentId && now - lastSavedAt > 5000) {
    lastSavedAt = now;
    void persist(status.currentTime ?? 0);
  }

  if (status.didJustFinish && currentId) {
    // Ignore a finish that a just-issued seek produced (Issue 7) — it is not a
    // real end-of-lecture, so it must not mark complete or auto-advance.
    if (Date.now() < seekGuardUntil) return;
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
      if (currentId === forId) store().setNext(next?.id ?? null);
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
 */
function invalidateProgressViews() {
  void queryClient.invalidateQueries({ queryKey: queryKeys.home });
  if (currentSectionId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.section(currentSectionId) });
  }
}

function persist(positionSec: number, finished = false) {
  if (!currentId) return Promise.resolve();
  const pos = finished ? currentDuration : positionSec;
  // Mirror the resume position into the download sidecar (no-op unless the
  // lecture is downloaded) so it resumes at the same second when played OFFLINE,
  // where the server progress row is unreachable.
  updateDownloadPosition(currentId, pos);
  return saveLectureProgress({
    lectureId: currentId,
    positionSec: pos,
    durationSec: currentDuration,
  }).catch(() => {});
}

/** Create-or-replace the player for `source`, seek to `positionSec`, and play. */
async function startPlayer(source: string, positionSec: number) {
  if (!player) {
    player = createAudioPlayer({ uri: source }, { updateInterval: 1000 });
    player.addListener('playbackStatusUpdate', onStatus);
    // Lock-screen / notification prev·next (from our expo-audio patch) arrive as a
    // `mediaControlAction` event; route them through the same section-aware
    // controller the in-app buttons use. Event name isn't in expo-audio's types.
    (player.addListener as (name: string, cb: (e: { action?: string }) => void) => void)(
      'mediaControlAction',
      (e) => {
        if (e?.action === 'next') playNext();
        else if (e?.action === 'prev') playPrev();
      },
    );
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
export async function playLecture(
  lectureId: string,
  opts?: { startAtSec?: number },
) {
  if (!lectureId) return;
  if (currentId === lectureId && player) {
    return toggle();
  }
  await ensureAudioMode();

  const localUri = localUriFor(lectureId);
  const meta = localUri ? readDownloadMeta(lectureId) : null;

  // ── Fast path: downloaded + cached sidecar → start now, refresh later. ──
  if (localUri && meta) {
    let positionSec = meta.positionSec ?? 0;
    // A resume deep-link may ask to open ahead; honor it, never rewind (§8).
    if (opts?.startAtSec != null && opts.startAtSec > positionSec) {
      positionSec = opts.startAtSec;
    }

    currentId = lectureId;
    currentDuration = meta.durationSec;
    currentSectionId = null; // unknown until the background refresh lands
    currentOrder = 0;
    lastSavedAt = Date.now();

    store().setTrack({
      id: lectureId,
      title: meta.title,
      sheikhName: meta.sheikhName,
      durationSec: meta.durationSec,
      positionSec,
    });
    store().setLoading(true);
    void startPlayer(localUri, positionSec);

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
        const here = player?.currentTime ?? positionSec;
        if (data.positionSec > here) void seekTo(data.positionSec);
      })
      .catch(() => {});
    return;
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
    const data = await getLecturePlayback(lectureId);
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

  if (opts?.startAtSec != null && opts.startAtSec > positionSec) {
    positionSec = opts.startAtSec;
  }

  currentId = lectureId;
  currentDuration = durationSec;
  currentSectionId = sectionId;
  currentOrder = order;
  lastSavedAt = Date.now();

  store().setTrack({ id: lectureId, title, sheikhName, durationSec, positionSec });
  store().setLoading(true);
  resolveNext();
  resolvePrev();
  await startPlayer(source, positionSec);
}

export function toggle() {
  if (!player) return;
  if (player.playing) {
    player.pause();
    store().setPlaying(false);
    void persist(player.currentTime ?? store().positionSec);
    invalidateProgressViews();
  } else {
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
 * so `currentLectureId` becomes null and the MiniPlayer unmounts. The player
 * instance is kept for reuse — the next playLecture() replaces its source.
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
  }
  currentId = null;
  currentDuration = 0;
  currentSectionId = null;
  currentOrder = 0;
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
