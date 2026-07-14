/**
 * VoiceRecorder — WhatsApp-style voice-answer recorder for the sheikh (native
 * only; the caller guards `Platform.OS !== 'web'`). Records straight to a MONO,
 * low-bitrate (~56 kbps) AAC/m4a — transparent for speech, tiny file, no ffmpeg
 * transcode needed. That low-bitrate mono target IS the "compress before send"
 * requirement.
 *
 * Flow: mic-permission → record (with PAUSE / متابعة) → إيقاف (stop) → preview via
 * VoiceNotePlayer over the local file → إرسال uploads to R2 and hands the key +
 * optional text to `onSend`. إعادة التسجيل / تجاهل discard the take.
 *
 * expo-audio recorder API (SDK 56, expo-audio ~56.0.12):
 *   useAudioRecorder(options) · prepareToRecordAsync() · record() · pause()
 *   (resume via record() again) · stop() → recorder.uri · useAudioRecorderState()
 *   · requestRecordingPermissionsAsync().
 */
import Feather from '@expo/vector-icons/Feather';
import {
  AudioQuality,
  createAudioPlayer,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioPlayer,
  type RecordingOptions,
} from 'expo-audio';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, I18nManager, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import type { PickedFile } from '@/api/storage';
import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { arDuration } from '@/lib/format';

import { VoiceNotePlayer } from './VoiceNotePlayer';

// Mono, ~56 kbps AAC in an .m4a container — speech-transparent yet tiny.
const VOICE_ANSWER_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 56000,
  isMeteringEnabled: true,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/mp4',
    bitsPerSecond: 56000,
  },
};

type Phase = 'idle' | 'recording' | 'paused' | 'recorded';

export function VoiceRecorder({
  onRecorded,
  onDiscard,
}: {
  /** Called when a take is captured — the local file URI ready to upload/preview. */
  onRecorded: (file: PickedFile | null) => void;
  /** Called when the whole recorder panel should close (تجاهل before any take). */
  onDiscard: () => void;
}) {
  const recorder = useAudioRecorder(VOICE_ANSWER_RECORDING);
  const recState = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<Phase>('idle');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);

  const emit = useCallback(
    (uri: string | null) => {
      onRecorded(uri ? { uri, name: `answer-${Date.now()}.m4a`, mimeType: 'audio/mp4' } : null);
    },
    [onRecorded],
  );

  async function startRecording() {
    setError('');
    setPreparing(true);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('لا يمكن التسجيل دون إذن الميكروفون');
        setPreparing(false);
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');
    } catch {
      setError('تعذّر بدء التسجيل');
    } finally {
      setPreparing(false);
    }
  }

  function pauseRecording() {
    try {
      recorder.pause();
      setPhase('paused');
    } catch {
      setError('تعذّر الإيقاف المؤقت');
    }
  }

  function resumeRecording() {
    try {
      recorder.record();
      setPhase('recording');
    } catch {
      setError('تعذّر المتابعة');
    }
  }

  async function stopRecording() {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      setRecordedUri(uri);
      setPhase('recorded');
      emit(uri);
    } catch {
      setError('تعذّر إيقاف التسجيل');
    }
  }

  function reRecord() {
    setRecordedUri(null);
    emit(null);
    setPhase('idle');
    setError('');
  }

  const elapsed = arDuration(Math.floor((recState.durationMillis ?? 0) / 1000));

  // ── Preview a captured take ──
  if (phase === 'recorded' && recordedUri) {
    return (
      <View style={styles.wrap}>
        <View style={styles.previewHeader}>
          <Feather name="mic" size={13} color={colors.primaryTeal600} />
          <Txt size={12} weight="semibold" color={colors.primaryTeal600}>
            معاينة التسجيل
          </Txt>
        </View>
        {/* Local-file preview: VoiceNotePlayer expects an R2 key, so preview the
            raw file directly with a lightweight inline player instead. */}
        <LocalPreview uri={recordedUri} />
        <View style={styles.actionsRow}>
          <Pressable
            onPress={reRecord}
            style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.75 }]}
          >
            <Feather name="rotate-ccw" size={14} color={colors.textMuted} />
            <Txt size={12.5} weight="medium" color={colors.textMuted}>
              إعادة التسجيل
            </Txt>
          </Pressable>
        </View>
        {error ? (
          <Txt size={11.5} color={colors.stateDanger} style={{ marginTop: 6 }}>
            {error}
          </Txt>
        ) : null}
      </View>
    );
  }

  // ── Recording / paused ──
  if (phase === 'recording' || phase === 'paused') {
    const isPaused = phase === 'paused';
    return (
      <View style={styles.wrap}>
        <View style={styles.recRow}>
          <View style={[styles.recDot, isPaused && styles.recDotPaused]} />
          <Txt size={13} weight="semibold" color={colors.textInk} tabular>
            {elapsed}
          </Txt>
          <Txt size={11.5} color={colors.textGhost} style={{ flex: 1 }}>
            {isPaused ? 'التسجيل متوقف مؤقتاً' : 'يتم التسجيل…'}
          </Txt>
        </View>
        <View style={styles.actionsRow}>
          {isPaused ? (
            <>
              <Pressable
                onPress={resumeRecording}
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
              >
                <Feather name="mic" size={14} color={colors.onTealPrimary} />
                <Txt size={12.5} weight="semibold" color={colors.onTealPrimary}>
                  متابعة
                </Txt>
              </Pressable>
              {/* Listening requires a finalized file (MediaRecorder can't play a
                  paused, still-open recording), so «استماع» ends the take and
                  shows the preview player. */}
              <Pressable
                onPress={stopRecording}
                style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.8 }]}
              >
                <Feather name="play" size={14} color={colors.textSlate} />
                <Txt size={12.5} weight="semibold" color={colors.textSlate}>
                  استماع
                </Txt>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={pauseRecording}
                style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.8 }]}
              >
                <Feather name="pause" size={14} color={colors.textSlate} />
                <Txt size={12.5} weight="semibold" color={colors.textSlate}>
                  إيقاف مؤقت
                </Txt>
              </Pressable>
              <Pressable
                onPress={stopRecording}
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
              >
                <Feather name="check" size={14} color={colors.onTealPrimary} />
                <Txt size={12.5} weight="semibold" color={colors.onTealPrimary}>
                  إنهاء
                </Txt>
              </Pressable>
            </>
          )}
        </View>
        {error ? (
          <Txt size={11.5} color={colors.stateDanger} style={{ marginTop: 6 }}>
            {error}
          </Txt>
        ) : null}
      </View>
    );
  }

  // ── Idle ──
  return (
    <View style={styles.wrap}>
      <View style={styles.actionsRow}>
        <Pressable
          onPress={startRecording}
          disabled={preparing}
          style={({ pressed }) => [
            styles.primaryBtn,
            { opacity: pressed || preparing ? 0.8 : 1 },
          ]}
        >
          {preparing ? (
            <ActivityIndicator size="small" color={colors.onTealPrimary} />
          ) : (
            <>
              <Feather name="mic" size={14} color={colors.onTealPrimary} />
              <Txt size={12.5} weight="semibold" color={colors.onTealPrimary}>
                تسجيل
              </Txt>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={onDiscard}
          style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.75 }]}
        >
          <Txt size={12.5} weight="medium" color={colors.textMuted}>
            تجاهل
          </Txt>
        </Pressable>
      </View>
      {error ? (
        <Txt size={11.5} color={colors.stateDanger} style={{ marginTop: 6 }}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * Minimal local-file preview player — the captured take lives at a file:// URI
 * (no R2 key yet), so VoiceNotePlayer (which resolves keys) can't play it. This
 * mirrors VoiceNotePlayer's controls over a direct source instead.
 */
function LocalPreview({ uri }: { uri: string }) {
  const [player, setPlayer] = useState<AudioPlayer | null>(null);
  useEffect(() => {
    const p = createAudioPlayer({ uri }, { updateInterval: 200 });
    setPlayer(p);
    return () => {
      try {
        p.remove();
      } catch {
        // released
      }
    };
  }, [uri]);
  if (!player) return null;
  return <LocalPreviewControls player={player} />;
}

function LocalPreviewControls({ player }: { player: AudioPlayer }) {
  const status = useAudioPlayerStatus(player);
  const duration = status.duration && status.duration > 0 ? status.duration : 0;
  const current = Math.min(status.currentTime ?? 0, duration || Infinity);
  const finished = status.didJustFinish;

  function toggle() {
    if (finished || (duration > 0 && current >= duration - 0.05)) {
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

  return (
    <View style={styles.previewRow}>
      <Pressable
        onPress={toggle}
        accessibilityLabel={status.playing ? 'إيقاف مؤقت' : 'تشغيل'}
        style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.85 }]}
      >
        <Feather
          name={status.playing ? 'pause' : finished ? 'rotate-ccw' : 'play'}
          size={16}
          color={colors.onTealPrimary}
        />
      </Pressable>
      <View style={styles.previewTrack}>
        <View
          style={[
            styles.previewFill,
            // Fill from the time-origin edge — right under global RTL, left in LTR
            // — so playback progress reads in the correct direction.
            I18nManager.isRTL ? { right: 0 } : { left: 0 },
            { width: `${duration > 0 ? Math.min(100, (current / duration) * 100) : 0}%` },
          ]}
        />
      </View>
      <Txt size={11} color={colors.textGhost} tabular>
        {arDuration(current)} / {arDuration(duration)}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1,
    borderColor: colors.borderSand2,
  } as ViewStyle,

  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  } as ViewStyle,

  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.stateDanger,
  } as ViewStyle,

  recDotPaused: {
    backgroundColor: colors.textGhost,
  } as ViewStyle,

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  } as ViewStyle,

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,

  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
  } as ViewStyle,

  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  } as ViewStyle,

  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  } as ViewStyle,

  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  previewTrack: {
    flex: 1,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.surfaceTrack,
    overflow: 'hidden',
    position: 'relative',
  } as ViewStyle,

  previewFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.primaryTeal600,
  } as ViewStyle,
});
