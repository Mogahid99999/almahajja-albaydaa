/**
 * Full-screen audio player — presented as a modal over the student app.
 * Teal (#1f4a42) full-bleed surface. Returns to app/mini-player via router.back().
 *
 * Layout top→bottom:
 *   top bar · ConcentricMotif · RhombusEmblem (148px) · title block
 *   · Waveform · TransportControls · PlayerUtilityBar (pinned)
 *
 * Design reference: screens/مشغل الصوت.dc.html
 */
import { useEffect, useState } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, platformShadow, radius } from '@/constants/theme';
import { queryKeys } from '@/constants/queryKeys';
import { Txt, Screen, IconButton, RhombusEmblem, ConcentricMotif } from '@/components/ui';
import { Waveform } from '@/components/player/Waveform';
import { TransportControls } from '@/components/player/TransportControls';
import { PlayerUtilityBar } from '@/components/player/PlayerUtilityBar';
import { LessonToolsRow } from '@/components/player/LessonToolsRow';
import { PlayerAttachmentsStrip } from '@/components/attachments/PlayerAttachmentsStrip';
import { playLecture, preloadLecture, seekTo, stop } from '@/lib/audioController';
import { usePlayerStore } from '@/stores/playerStore';
import { useLecturePlayback } from '@/hooks/useLecture';

export default function PlayerScreen() {
  // `t` (seconds) is set by a resume-notification deep-link → open at that second.
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  // Collapse the modal player. When it was opened as the entry screen (a
  // notification deep-link, or a fast-refresh that landed here) there's no
  // history to pop, so GO_BACK isn't handled — fall back to Home instead.
  const collapse = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  // Lecture metadata (eyebrow, sectionTitle) — loaded once from the API.
  const { data } = useLecturePlayback(id);

  // Live playback state from the shared store — per-field selectors so a
  // position tick (every ~1s while playing) only re-renders the Waveform leaf
  // below, not this whole screen (artwork, title, top bar).
  const storeTitle = usePlayerStore((s) => s.title);
  const storeSheikhName = usePlayerStore((s) => s.sheikhName);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const rate = usePlayerStore((s) => s.rate);
  // Phase 3.5 — expo-audio's own reported load/playback failure (e.g. a
  // transient "Source error"), surfaced via onStatus in audioController.
  const loadError = usePlayerStore((s) => s.loadError);

  // True when a NON-downloaded lecture can't be reached (offline) — playLecture
  // only rejects when the stream can't be resolved AND there's no local file, so
  // we surface a calm inline notice instead of a dead player / crash (V10 Feature D).
  const [unavailable, setUnavailable] = useState(false);

  // On mount: start this lecture unless it's already current or already being
  // loaded — the latter happens when the row that opened this screen already
  // called `preloadLecture` itself (see LectureRowItem etc.), so playback
  // begins the instant the tap lands instead of waiting for this screen's
  // modal-transition + mount to finish. This is just the fallback for entry
  // points that don't pre-start it (e.g. a notification deep link). A
  // deep-link `t` overrides the saved resume position (guarded so it never
  // rewinds a student who has since listened further — see playLecture).
  useEffect(() => {
    if (id) {
      setUnavailable(false);
      const startAtSec = t != null ? Number(t) : NaN;
      void preloadLecture(id, Number.isFinite(startAtSec) ? { startAtSec } : undefined).catch(() =>
        setUnavailable(true),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, t]);

  // Retry a failed load (Phase 3.5): the player is already "on" this lecture id,
  // so a plain playLecture(id) would just toggle play/pause (see its early
  // return). stop() first fully resets the controller + store (currentId → null,
  // loadError → null); invalidating the cached playback entry too means the
  // retry mints a fresh signed URL / re-reads the row instead of possibly
  // replaying the exact same (cached) source that just failed.
  const retry = () => {
    if (!id) return;
    void qc.invalidateQueries({ queryKey: queryKeys.lecture(id) });
    stop();
    playLecture(id).catch(() => setUnavailable(true));
  };

  // Title / sheikh: prefer live store values (already loaded by playLecture),
  // fall back to API response while the store is being populated. When the
  // lecture is UNAVAILABLE (offline + not downloaded), never fall back to the
  // store values — those describe whatever is still playing in the background,
  // NOT the lecture the user just opened. Show only the requested lecture's own
  // metadata (from cache) so the screen never contradicts its "needs a
  // connection" notice with a different lecture's name.
  const title = unavailable ? (data?.title ?? '') : (storeTitle ?? data?.title ?? '');
  const sheikhName = unavailable
    ? (data?.sheikhName ?? null)
    : (storeSheikhName ?? data?.sheikhName ?? null);
  const eyebrow = data?.eyebrow ?? '';
  const sectionTitle = data?.sectionTitle ?? eyebrow;

  // The waveform + transport are pinned just above the «أدوات الدرس» row (and
  // the attachments strip when present), so a long, multi-line title can wrap
  // freely in the top region without ever pushing the controls into overlap.
  const hasAttachments = (data?.attachments?.length ?? 0) > 0;
  const controlsBottom = (hasAttachments ? 208 : 150) + insets.bottom;
  // Keep the title clear of the pinned controls (≈176px waveform+transport block).
  const titleAreaReserve = (hasAttachments ? 208 : 150) + 176;

  return (
    <Screen scroll={false} background={colors.primaryTeal} bottomPad={0} padded={false}>
      {/* Faint concentric-circle motif behind the artwork */}
      <ConcentricMotif
        size={320}
        color="rgba(201,164,99,0.09)"
        rings={3}
        style={{ top: -90, left: '50%', marginLeft: -160 }}
      />
      <ConcentricMotif
        size={220}
        color="rgba(201,164,99,0.06)"
        rings={2}
        style={{ top: -40, left: '50%', marginLeft: -110 }}
      />

      {/* ── Top bar ── (the Screen container already applies the safe-area top) */}
      <View style={[styles.topBar, { paddingTop: 10 }]}>
        {/* Left: collapse (chevron-down) → router.back() */}
        <IconButton
          icon="chevron-down"
          onPress={collapse}
          size={42}
          iconSize={20}
          color={colors.onTealIcon}
          style={styles.topBarBtn}
          accessibilityLabel="تصغير المشغل"
        />

        {/* Center: section label */}
        <Txt
          size={12}
          weight="medium"
          color={colors.onTealSecondary}
          align="center"
          style={styles.topBarLabel}
          numberOfLines={1}
        >
          {sectionTitle}
        </Txt>

        {/* Right: overflow (no-op) */}
        <IconButton
          icon="more-vertical"
          size={42}
          iconSize={18}
          color={colors.onTealIcon}
          style={styles.topBarBtn}
          accessibilityLabel="المزيد من الخيارات"
        />
      </View>

      {/* ── Emblem + title — top-anchored; a long title wraps into the whole
             region above the pinned controls (paddingBottom keeps it clear). ── */}
      <View style={[styles.flow, { paddingBottom: titleAreaReserve }]}>
        {/* ── Artwork emblem ── */}
        <View style={styles.emblemWrapper}>
          {/* Brass border + soft shadow wrap the shared RhombusEmblem. */}
          <View style={styles.emblemBorder}>
            <RhombusEmblem size={148} radius={radius.artwork} tile={colors.primaryTealDeep} />
          </View>
        </View>

        {/* ── Title block ── */}
        <View style={styles.titleBlock}>
          {eyebrow ? (
            <Txt size={11} color={colors.accentBrass} weight="medium" align="center">
              {eyebrow}
            </Txt>
          ) : null}
          <Txt
            size={25}
            weight="display"
            color={colors.onTealPrimary}
            align="center"
            style={styles.titleText}
            numberOfLines={6}
          >
            {title}
          </Txt>
          {sheikhName ? (
            <Txt size={13} color={colors.onTealSecondary} align="center" style={styles.sheikhText}>
              {sheikhName}
            </Txt>
          ) : null}
        </View>
      </View>

      {/* ── Waveform + transport — pinned just above the «أدوات الدرس» row ──
             (or a calm offline notice when a non-downloaded lecture is tapped
             without a connection). ── */}
      <View style={[styles.controls, { bottom: controlsBottom }]}>
        {unavailable ? (
          <View style={styles.offlineNotice}>
            <Feather name="wifi-off" size={22} color={colors.accentBrass} />
            <Txt
              size={13.5}
              weight="medium"
              color={colors.onTealPrimary}
              align="center"
              style={{ lineHeight: 22 }}
            >
              هذه المحاضرة تحتاج اتصالاً — أو حمّلها للاستماع بلا إنترنت
            </Txt>
          </View>
        ) : loadError ? (
          <View style={styles.offlineNotice}>
            <Feather name="refresh-cw" size={22} color={colors.accentBrass} />
            <Txt
              size={13.5}
              weight="medium"
              color={colors.onTealPrimary}
              align="center"
              style={{ lineHeight: 22 }}
            >
              تعذّر تشغيل هذه المحاضرة الآن
            </Txt>
            <Pressable
              onPress={retry}
              accessibilityRole="button"
              accessibilityLabel="إعادة المحاولة"
              style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.8 }]}
            >
              <Txt size={13} weight="semibold" color={colors.primaryTealDeep}>
                إعادة المحاولة
              </Txt>
            </Pressable>
          </View>
        ) : (
          <>
            {/* ── Waveform + time ── */}
            <View style={styles.waveformWrapper}>
              <PlayerWaveformLive />
            </View>

            {/* ── Transport controls ── */}
            <View style={styles.transportWrapper}>
              <TransportControls isPlaying={isPlaying} />
            </View>
          </>
        )}
      </View>

      {/* ── Lecture attachments strip (absolute, above the tools row) ── */}
      <PlayerAttachmentsStrip attachments={data?.attachments ?? []} />

      {/* ── «أدوات الدرس» — note · benefits · questions (absolute) ── */}
      {id ? <LessonToolsRow lectureId={id} /> : null}

      {/* ── Pinned utility bar (absolute) ── */}
      <PlayerUtilityBar lectureId={id} rate={rate} />
    </Screen>
  );
}

/** Isolated so the position tick only re-renders the waveform, not the whole screen. */
function PlayerWaveformLive() {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  return (
    <Waveform positionSec={positionSec} durationSec={durationSec} onSeek={(sec) => void seekTo(sec)} />
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 6,
  },
  topBarBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 13,
  },
  topBarLabel: {
    flex: 1,
    paddingHorizontal: 8,
  },
  // Emblem + title fill the space between the top bar and the pinned controls
  // and are centered in it; the inline paddingBottom marks the controls' top so
  // a long title stays centered above the (absolute) waveform without overlap.
  flow: {
    flex: 1,
    justifyContent: 'center',
  },
  // Waveform + transport, pinned above the «أدوات الدرس» row (bottom set inline).
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  emblemWrapper: {
    alignItems: 'center',
  },
  emblemBorder: {
    borderRadius: radius.artwork,
    borderWidth: 1,
    borderColor: 'rgba(201,164,99,0.32)',
    ...platformShadow('#000', { width: 0, height: 24 }, 0.6, 30, 12),
  },
  titleBlock: {
    // `stretch` (not `center`) gives each line the full width to lay out in;
    // a content-sized RTL Text with textAlign:'center' clips its trailing word
    // on Android (e.g. «المجلس السابع عشر» → «المجلس السابع»). Glyphs still
    // center via each Txt's align="center".
    alignSelf: 'stretch',
    alignItems: 'stretch',
    marginTop: 22,
    paddingHorizontal: 32,
    gap: 8,
  },
  titleText: {
    lineHeight: 34, // 25 * 1.35
    marginTop: 0,
  },
  sheikhText: {
    marginTop: 2,
  },
  waveformWrapper: {
    paddingHorizontal: 28,
  },
  offlineNotice: {
    paddingHorizontal: 32,
    alignItems: 'center',
    gap: 12,
  },
  retryButton: {
    backgroundColor: colors.accentBrass,
    borderRadius: radius.input,
    paddingVertical: 10,
    paddingHorizontal: 22,
    marginTop: 2,
  },
  transportWrapper: {
    marginTop: 16,
  },
});
