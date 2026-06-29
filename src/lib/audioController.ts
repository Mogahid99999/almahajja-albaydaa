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

import { getLecturePlayback } from '@/api/lectures';
import { saveLectureProgress } from '@/api/progress';
import { localUriFor, readDownloadMeta } from '@/lib/downloads';
import { usePlayerStore, type PlaybackRate } from '@/stores/playerStore';

let player: AudioPlayer | null = null;
let currentId: string | null = null;
let currentDuration = 0;
let lastSavedAt = 0;
let audioModeSet = false;

const store = () => usePlayerStore.getState();

async function ensureAudioMode() {
  if (audioModeSet) return;
  audioModeSet = true;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
  } catch {
    // Non-fatal (e.g. web) — playback still works.
  }
}

function onStatus(status: AudioStatus) {
  const s = store();
  if (status.duration && status.duration > 0) {
    currentDuration = status.duration;
    s.setDuration(status.duration);
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
    // Force completion (position = duration → ≥90% threshold).
    void persist(currentDuration || status.currentTime || 0, true);
    s.setPlaying(false);
  }
}

function persist(positionSec: number, finished = false) {
  if (!currentId) return Promise.resolve();
  return saveLectureProgress({
    lectureId: currentId,
    positionSec: finished ? currentDuration : positionSec,
    durationSec: currentDuration,
  }).catch(() => {});
}

/**
 * Load (if needed) and play a lecture. Tapping the lecture that's already loaded
 * just toggles play/pause. Resumes from the saved position.
 *
 * Offline-first: a downloaded lecture plays from its local file rather than the
 * (short-lived, signed) stream URL. Metadata still comes from the network when
 * available — for the fresh resume position — but falls back to the cached
 * sidecar when offline, so a downloaded lecture plays with no connection.
 */
export async function playLecture(lectureId: string) {
  if (!lectureId) return;
  if (currentId === lectureId && player) {
    return toggle();
  }
  await ensureAudioMode();

  const localUri = localUriFor(lectureId);

  let title: string;
  let sheikhName: string | null;
  let durationSec: number;
  let positionSec: number;
  let source: string;

  try {
    const data = await getLecturePlayback(lectureId);
    title = data.title;
    sheikhName = data.sheikhName;
    durationSec = data.durationSec;
    positionSec = data.positionSec;
    source = localUri ?? data.audioUrl;
  } catch (err) {
    // Offline fallback: play from disk using the cached metadata sidecar.
    const meta = localUri ? readDownloadMeta(lectureId) : null;
    if (!localUri || !meta) throw err;
    title = meta.title;
    sheikhName = meta.sheikhName;
    durationSec = meta.durationSec;
    positionSec = 0; // resume position is server-side; offline starts over
    source = localUri;
  }

  currentId = lectureId;
  currentDuration = durationSec;
  lastSavedAt = Date.now();

  store().setTrack({ id: lectureId, title, sheikhName, durationSec, positionSec });
  store().setLoading(true);

  if (!player) {
    player = createAudioPlayer({ uri: source }, { updateInterval: 500 });
    player.addListener('playbackStatusUpdate', onStatus);
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
}

export function toggle() {
  if (!player) return;
  if (player.playing) {
    player.pause();
    store().setPlaying(false);
    void persist(player.currentTime ?? store().positionSec);
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
  }
}

export async function seekTo(positionSec: number) {
  if (!player) return;
  store().setPosition(positionSec);
  try {
    await player.seekTo(Math.max(0, positionSec));
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
