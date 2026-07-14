/**
 * VoiceNotePlayer — WhatsApp-style playback for a sheikh's recorded voice answer
 * (جواب صوتي). Given an R2 object key it resolves a signed URL (getAnswerAudioUrl),
 * then shows: a play/pause button, a draggable/seekable progress bar, elapsed /
 * total time (Arabic-Indic digits), and a replay affordance once finished.
 *
 * Reused in three places: the asker's answered-question cards (public + mine) and
 * the moderator inbox preview after recording. Calm, RTL, theme tokens only.
 *
 * Audio: a dedicated `createAudioPlayer` instance per note (not the app's shared
 * lecture player) so a short answer never disturbs an in-progress lesson. The
 * player is released on unmount / source change. The seek bar is computed in a
 * plain physical L→R coordinate space (like PlaybackRateSlider) so drag and fill
 * agree under global forceRTL without mirroring.
 */
import Feather from '@expo/vector-icons/Feather';
import { createAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  I18nManager,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { getAnswerAudioUrl } from '@/api/questions';
import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { arDuration } from '@/lib/format';

const TRACK_HEIGHT = 5;
const THUMB_SIZE = 14;
const HIT_ZONE_HEIGHT = 30;

function clampX(rawX: number, width: number): number {
  'worklet';
  return Math.min(width, Math.max(0, rawX));
}

export function VoiceNotePlayer({ audioPath }: { audioPath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [resolveState, setResolveState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [player, setPlayer] = useState<AudioPlayer | null>(null);

  // Resolve the signed URL for this key (re-runs if the key changes).
  useEffect(() => {
    let alive = true;
    setResolveState('loading');
    setUrl(null);
    getAnswerAudioUrl(audioPath)
      .then((u) => {
        if (!alive) return;
        if (u) {
          setUrl(u);
          setResolveState('ready');
        } else {
          setResolveState('error');
        }
      })
      .catch(() => {
        if (alive) setResolveState('error');
      });
    return () => {
      alive = false;
    };
  }, [audioPath]);

  // One imperative player per resolved URL; released on change/unmount.
  useEffect(() => {
    if (!url) {
      setPlayer(null);
      return;
    }
    const p = createAudioPlayer({ uri: url }, { updateInterval: 120 });
    setPlayer(p);
    return () => {
      try {
        p.remove();
      } catch {
        // already released
      }
    };
  }, [url]);

  if (resolveState === 'loading') {
    return (
      <View style={styles.stateBox}>
        <ActivityIndicator size="small" color={colors.primaryTeal600} />
        <Txt size={12} color={colors.textMuted}>
          جارٍ تحميل التسجيل…
        </Txt>
      </View>
    );
  }

  if (resolveState === 'error' || !player) {
    return (
      <View style={styles.stateBox}>
        <Feather name="alert-circle" size={14} color={colors.textGhost} />
        <Txt size={12} color={colors.textMuted}>
          تعذّر تحميل التسجيل الصوتي
        </Txt>
      </View>
    );
  }

  return <LoadedPlayer player={player} />;
}

function LoadedPlayer({ player }: { player: AudioPlayer }) {
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  // While scrubbing, the fill follows the finger (px) instead of playback time.
  const scrubX = useSharedValue(0);
  const scrubbingSV = useSharedValue(false);

  const duration = status.duration && status.duration > 0 ? status.duration : 0;
  const current = Math.min(status.currentTime ?? 0, duration || Infinity);
  const finished = status.didJustFinish;

  // Playback-driven fill fraction (0–1).
  const playFraction = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
  // Physical x (px from the LEFT edge) of the progress point. Under global RTL,
  // 0s sits on the RIGHT, so the played position moves leftward as it advances.
  const physicalX = (fraction: number, w: number) => (I18nManager.isRTL ? w - fraction * w : fraction * w);
  const playX = useSharedValue(0);
  useEffect(() => {
    if (!scrubbingSV.value) playX.value = physicalX(playFraction, trackWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playFraction, trackWidth, playX, scrubbingSV]);

  function handleLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    playX.value = physicalX(playFraction, w);
  }

  function beginScrub() {
    setScrubbing(true);
  }
  function commitSeek(fraction: number) {
    setScrubbing(false);
    if (duration > 0) {
      const target = Math.min(duration, Math.max(0, fraction * duration));
      try {
        player.seekTo(target);
      } catch {
        // ignore transient seek failure
      }
    }
  }

  const seekGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          if (trackWidth <= 0) return;
          const x = clampX(e.x, trackWidth);
          scrubbingSV.value = true;
          scrubX.value = x;
          runOnJS(beginScrub)();
        })
        .onUpdate((e) => {
          if (trackWidth <= 0) return;
          scrubX.value = clampX(e.x, trackWidth);
        })
        .onEnd(() => {
          // Physical finger x → playback fraction, mirrored under global RTL so
          // 0s sits on the RIGHT and progress flows leftward (Waveform pattern).
          const raw = trackWidth > 0 ? scrubX.value / trackWidth : 0;
          const fraction = I18nManager.isRTL ? 1 - raw : raw;
          scrubbingSV.value = false;
          runOnJS(commitSeek)(fraction);
        })
        .onFinalize((_e, success) => {
          if (!success) {
            scrubbingSV.value = false;
            runOnJS(setScrubbing)(false);
          }
        }),
    // trackWidth / duration are read via closures updated each render; rebuild
    // the gesture when they change so the committed seek uses fresh values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackWidth, duration],
  );

  // `pos` is the progress point in px from the LEFT edge (physical). The played
  // fill spans from the time-origin edge to `pos`: left→pos under LTR, pos→right
  // under RTL. The thumb sits at `pos` either way.
  const fillStyle = useAnimatedStyle(() => {
    const pos = scrubbingSV.value ? scrubX.value : playX.value;
    return I18nManager.isRTL
      ? { left: pos, right: 0 }
      : { left: 0, width: pos };
  });
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (scrubbingSV.value ? scrubX.value : playX.value) - THUMB_SIZE / 2 },
    ],
  }));

  function togglePlay() {
    if (finished || (duration > 0 && current >= duration - 0.05)) {
      // Replay from the start.
      try {
        player.seekTo(0);
      } catch {
        // ignore
      }
      player.play();
      return;
    }
    if (status.playing) player.pause();
    else player.play();
  }

  const showReplay = finished && !status.playing;
  // While scrubbing, show the time under the finger — mirrored under RTL so the
  // label matches the physical drag position (same mapping as commitSeek).
  const scrubFraction = (() => {
    if (!scrubbing || trackWidth <= 0) return null;
    const raw = scrubX.value / trackWidth;
    return I18nManager.isRTL ? 1 - raw : raw;
  })();
  const elapsedForLabel = scrubFraction != null ? scrubFraction * duration : current;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={togglePlay}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'إيقاف مؤقت' : showReplay ? 'إعادة التشغيل' : 'تشغيل'}
        style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.85 }]}
      >
        <Feather
          name={status.playing ? 'pause' : showReplay ? 'rotate-ccw' : 'play'}
          size={16}
          color={colors.onTealPrimary}
        />
      </Pressable>

      <View style={styles.body}>
        <GestureDetector gesture={seekGesture}>
          <View onLayout={handleLayout} style={styles.hitZone} accessibilityRole="adjustable">
            <View style={styles.track}>
              <Animated.View style={[styles.trackFill, fillStyle]} />
            </View>
            <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
          </View>
        </GestureDetector>
        <View style={styles.timeRow}>
          <Txt size={11} color={colors.textGhost} tabular>
            {arDuration(elapsedForLabel)}
          </Txt>
          <Txt size={11} color={colors.textGhost} tabular>
            {arDuration(duration)}
          </Txt>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  } as ViewStyle,

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  } as ViewStyle,

  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  body: {
    flex: 1,
  } as ViewStyle,

  hitZone: {
    height: HIT_ZONE_HEIGHT,
    justifyContent: 'center',
  } as ViewStyle,

  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.surfaceTrack,
    overflow: 'hidden',
  } as ViewStyle,

  trackFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.primaryTeal600,
  } as ViewStyle,

  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.primaryTeal,
    borderWidth: 2,
    borderColor: colors.onTealPrimary,
  } as ViewStyle,

  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  } as ViewStyle,
});
