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
import { Platform, Pressable, View, StyleSheet, useWindowDimensions } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors, platformShadow, radius } from '@/constants/theme';
import { queryKeys } from '@/constants/queryKeys';
import { Txt, Screen, IconButton, RhombusEmblem, ConcentricMotif } from '@/components/ui';
import { DownloadButton } from '@/components/DownloadButton';
import { Waveform } from '@/components/player/Waveform';
import { TransportControls } from '@/components/player/TransportControls';
import { PlayerUtilityBar } from '@/components/player/PlayerUtilityBar';
import { LessonToolsRow } from '@/components/player/LessonToolsRow';
import { PlayerAttachmentsStrip } from '@/components/attachments/PlayerAttachmentsStrip';
import { playLecture, preloadLecture, seekTo, stop } from '@/lib/audioController';
import { usePlayerStore } from '@/stores/playerStore';
import { useTourStore } from '@/stores/tourStore';
import { useLecturePlayback } from '@/hooks/useLecture';

export default function PlayerScreen() {
  // `t` (seconds) is set by a resume-notification deep-link → open at that second.
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  // Android peek-sheet + swipe-to-minimize (V·player). iOS's native `modal`
  // presentation already peeks the screen beneath and handles the swipe-down
  // gesture itself; Android's `modal` presentation does neither, so it's
  // reproduced here: the screen renders as a `transparentModal` (see
  // app/_layout.tsx) inset from the top by PEEK_TOP_RATIO, with a drag handle
  // that lets a downward swipe collapse the player the same way the chevron
  // button does. The native transition is a plain `fade`; the slide-up on open
  // and slide-down on close are driven HERE by one shared value (translateY),
  // which also derives the backdrop dim — sheet motion and dimming always move
  // together, exactly like iOS's native sheet.
  const { height: windowHeight } = useWindowDimensions();
  const isAndroid = Platform.OS === 'android';
  const PEEK_TOP_RATIO = 0.1;
  const topGap = Math.round(windowHeight * PEEK_TOP_RATIO);
  // Full travel of the sheet from resting position to fully off-screen.
  const sheetTravel = windowHeight - topGap;
  // The Pan gesture activates only after 12px of downward travel — subtract it
  // when tracking so the sheet starts moving from 0 instead of jumping 12px the
  // instant the gesture activates.
  const DRAG_ACTIVATION_PX = 12;
  const translateY = useSharedValue(isAndroid ? sheetTravel : 0);
  useEffect(() => {
    if (isAndroid) {
      translateY.value = withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collapse the modal player. When it was opened as the entry screen (a
  // notification deep-link, or a fast-refresh that landed here) there's no
  // history to pop, so GO_BACK isn't handled — fall back to Home instead.
  // On Android the sheet slides itself down WHILE the (fade) pop runs, so the
  // two overlap into one iOS-like dismiss motion with no empty frame.
  const collapse = () => {
    if (isAndroid) {
      translateY.value = withTiming(sheetTravel, {
        duration: 240,
        easing: Easing.in(Easing.cubic),
      });
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const dragGesture = Gesture.Pan()
    .activeOffsetY(DRAG_ACTIVATION_PX)
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY - DRAG_ACTIVATION_PX);
    })
    .onEnd((e) => {
      const shouldDismiss = e.translationY > windowHeight * 0.22 || e.velocityY > 800;
      if (shouldDismiss) {
        runOnJS(collapse)();
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 220 });
      }
    });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  // Backdrop dim is derived from the sheet's own position — fades in as the
  // sheet rises on open, follows the finger during a drag, fades out on dismiss.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.max(0, translateY.value / sheetTravel)),
  }));

  // Lecture metadata (eyebrow, sectionTitle) — loaded once from the API.
  const { data } = useLecturePlayback(id);

  // The guided tour's "player" step lands here just to show what the screen
  // looks like — it must never start real audio playback on a lecture the
  // student didn't choose (e.g. the newest "Recently Added" item used as the
  // tour's placeholder lectureId).
  const isTourActive = useTourStore((s) => s.isActive);

  // Live playback state from the shared store — per-field selectors so a
  // position tick (every ~1s while playing) only re-renders the Waveform leaf
  // below, not this whole screen (artwork, title, top bar).
  const storeTitle = usePlayerStore((s) => s.title);
  const storeSheikhName = usePlayerStore((s) => s.sheikhName);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isStalled = usePlayerStore((s) => s.isStalled);
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
    if (id && !isTourActive) {
      setUnavailable(false);
      const startAtSec = t != null ? Number(t) : NaN;
      void preloadLecture(id, Number.isFinite(startAtSec) ? { startAtSec } : undefined).catch(() =>
        setUnavailable(true),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, t, isTourActive]);

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
  // Compact vertical scale for short viewports (≈720×1280 / 640dp phones,
  // minus the Android sheet's top peek gap): the default stack (148px emblem +
  // 6-line title reserve + 326px pinned controls) simply doesn't fit in
  // ~576dp, so the title used to render over the waveform and the emblem
  // collided with the top bar. Everything shrinks together so it stays one
  // coherent layout; normal phones (≥700dp usable) are untouched.
  const usableHeight = isAndroid ? sheetTravel : windowHeight;
  const compact = usableHeight < 700;
  const utilityBottom = compact ? 14 : 26;
  const toolsBottom = compact ? 62 : 86;
  const attachmentsBottom = compact ? 118 : 144;
  const controlsBottomBase = hasAttachments ? (compact ? 172 : 208) : (compact ? 118 : 150);
  const controlsBottom = controlsBottomBase + insets.bottom;
  // Keep the title clear of the pinned controls (waveform+transport block —
  // ≈176px normal, ≈152px compact with the tighter transport gap).
  const titleAreaReserve = controlsBottomBase + (compact ? 152 : 176);
  const emblemSize = compact ? 96 : 148;

  const playerScreen = (
    // topInset off on Android: the sheet rests well below the status bar, so the
    // Screen's dark status-bar scrim band has nothing to fog — it rendered as a
    // weird full-width rectangular shadow at the top of the sheet.
    <Screen
      scroll={false}
      background={colors.primaryTeal}
      bottomPad={0}
      padded={false}
      topInset={!isAndroid}
    >
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

        {/* Right: spacer — balances the collapse button so the section label stays centered */}
        <View style={styles.topBarSpacer} />
      </View>

      {/* ── Emblem + title — top-anchored; a long title wraps into the whole
             region above the pinned controls (paddingBottom keeps it clear). ── */}
      <View style={[styles.flow, { paddingBottom: titleAreaReserve }]}>
        {/* ── Artwork emblem ── */}
        <View style={styles.emblemWrapper}>
          {/* Brass border + soft shadow wrap the shared RhombusEmblem. */}
          <View style={styles.emblemBorder}>
            <RhombusEmblem size={emblemSize} radius={radius.artwork} tile={colors.primaryTealDeep} />
          </View>
        </View>

        {/* ── Title block ── */}
        {/* compact: the eyebrow duplicates the top bar's section label — drop it
            to buy title room on short screens. */}
        <View style={[styles.titleBlock, compact && { marginTop: 12 }]}>
          {eyebrow && !compact ? (
            <Txt size={11} color={colors.accentBrass} weight="medium" align="center">
              {eyebrow}
            </Txt>
          ) : null}
          <Txt
            size={compact ? 20 : 25}
            weight="display"
            color={colors.onTealPrimary}
            align="center"
            style={compact ? styles.titleTextCompact : styles.titleText}
            numberOfLines={compact ? 3 : 6}
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
            {/* Make the "download it" half of the message actionable — the
                notice used to just describe downloading without any control
                to actually do it from this screen. */}
            {id ? (
              <View style={styles.offlineDownloadRow}>
                <DownloadButton lectureId={id} size={20} onTeal />
                <Txt size={12.5} weight="medium" color={colors.onTealSecondary}>
                  تحميل المحاضرة
                </Txt>
              </View>
            ) : null}
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

            {/* Calm "reconnecting" hint while a streamed track re-buffers on a
                weak/lost signal — so a stall never reads as a frozen player. */}
            {isStalled ? (
              <Txt
                size={12}
                weight="medium"
                color={colors.onTealSecondary}
                align="center"
                style={styles.reconnectingHint}
              >
                ‏…جارٍ إعادة الاتصال
              </Txt>
            ) : null}

            {/* ── Transport controls ── */}
            <View style={[styles.transportWrapper, compact && { marginTop: 8 }]}>
              <TransportControls isPlaying={isPlaying} />
            </View>
          </>
        )}
      </View>

      {/* ── Lecture attachments strip (absolute, above the tools row) ── */}
      <PlayerAttachmentsStrip attachments={data?.attachments ?? []} bottom={attachmentsBottom} />

      {/* ── «أدوات الدرس» — note · benefits · questions (absolute) ── */}
      {id ? <LessonToolsRow lectureId={id} bottom={toolsBottom} /> : null}

      {/* ── Pinned utility bar (absolute) ── */}
      <PlayerUtilityBar lectureId={id} rate={rate} bottom={utilityBottom} />
    </Screen>
  );

  if (!isAndroid) {
    return playerScreen;
  }

  // Android: dimmed backdrop (the actual screen beneath, presented via
  // `transparentModal`, shows through the peek gap) + a rounded-top sheet that
  // starts `topGap` below the screen top. The backdrop covers the WHOLE screen
  // behind the sheet (not just the peek strip) so it never reads as a floating
  // dark rectangle while the sheet is in motion — only its exposed part is
  // tappable, since the sheet sits on top. The drag gesture wraps the WHOLE
  // sheet (not just the grabber handle) so a swipe-to-dismiss starts from
  // anywhere on the player, iOS-style — `activeOffsetY`/`failOffsetX` on the
  // gesture itself (above) are what keep taps on buttons and horizontal
  // waveform-scrub drags working normally underneath it.
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.peekBackdrop, backdropStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={collapse}
          accessibilityRole="button"
          accessibilityLabel="تصغير المشغل"
        />
      </Animated.View>
      <GestureDetector gesture={dragGesture}>
        <Animated.View style={[styles.sheet, { top: topGap }, sheetStyle]}>
          <View style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>
          <View style={styles.sheetBody}>{playerScreen}</View>
        </Animated.View>
      </GestureDetector>
    </View>
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
  // Android peek-sheet (see `isAndroid` branch above) — full-screen dim behind
  // the sheet; only the peek strip above the sheet is actually visible/tappable.
  peekBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.primaryTeal,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  grabberZone: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  sheetBody: {
    flex: 1,
  },
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
  topBarSpacer: {
    width: 42,
    height: 42,
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
  titleTextCompact: {
    lineHeight: 27, // 20 * 1.35
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
  offlineDownloadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
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
  reconnectingHint: {
    marginTop: 10,
    opacity: 0.9,
  },
});
