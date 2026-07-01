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
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius } from '@/constants/theme';
import { Txt, Screen, IconButton, RhombusEmblem, ConcentricMotif } from '@/components/ui';
import { Waveform } from '@/components/player/Waveform';
import { TransportControls } from '@/components/player/TransportControls';
import { PlayerUtilityBar } from '@/components/player/PlayerUtilityBar';
import { PlayerAttachmentsStrip } from '@/components/attachments/PlayerAttachmentsStrip';
import { playLecture, seekTo } from '@/lib/audioController';
import { usePlayerStore } from '@/stores/playerStore';
import { useLecturePlayback } from '@/hooks/useLecture';

export default function PlayerScreen() {
  // `t` (seconds) is set by a resume-notification deep-link → open at that second.
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Collapse the modal player. When it was opened as the entry screen (a
  // notification deep-link, or a fast-refresh that landed here) there's no
  // history to pop, so GO_BACK isn't handled — fall back to Home instead.
  const collapse = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  // Lecture metadata (eyebrow, sectionTitle) — loaded once from the API.
  const { data } = useLecturePlayback(id);

  // Live playback state from the shared store.
  const {
    title: storeTitle,
    sheikhName: storeSheikhName,
    isPlaying,
    positionSec,
    durationSec,
    rate,
  } = usePlayerStore();

  // On mount: if a different lecture (or nothing) is loaded, start this one. A
  // deep-link `t` overrides the saved resume position (guarded so it never
  // rewinds a student who has since listened further — see playLecture).
  useEffect(() => {
    if (id && usePlayerStore.getState().currentLectureId !== id) {
      const startAtSec = t != null ? Number(t) : NaN;
      void playLecture(id, Number.isFinite(startAtSec) ? { startAtSec } : undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, t]);

  // Title / sheikh: prefer live store values (already loaded by playLecture),
  // fall back to API response while the store is being populated.
  const title = storeTitle ?? data?.title ?? '';
  const sheikhName = storeSheikhName ?? data?.sheikhName ?? null;
  const eyebrow = data?.eyebrow ?? '';
  const sectionTitle = data?.sectionTitle ?? eyebrow;

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

      {/* ── Top bar ── */}
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + 10 },
        ]}
      >
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
        >
          {title}
        </Txt>
        {sheikhName ? (
          <Txt size={13} color={colors.onTealSecondary} align="center" style={styles.sheikhText}>
            {sheikhName}
          </Txt>
        ) : null}
      </View>

      {/* ── Waveform + time ── */}
      <View style={styles.waveformWrapper}>
        <Waveform
          positionSec={positionSec}
          durationSec={durationSec}
          onSeek={(sec) => void seekTo(sec)}
        />
      </View>

      {/* ── Transport controls ── */}
      <View style={styles.transportWrapper}>
        <TransportControls isPlaying={isPlaying} />
      </View>

      {/* ── Lecture attachments strip (absolute, above the utility bar) ── */}
      <PlayerAttachmentsStrip attachments={data?.attachments ?? []} />

      {/* ── Pinned utility bar (absolute) ── */}
      <PlayerUtilityBar lectureId={id} rate={rate} />
    </Screen>
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
  emblemWrapper: {
    alignItems: 'center',
    marginTop: 42,
  },
  emblemBorder: {
    borderRadius: radius.artwork,
    borderWidth: 1,
    borderColor: 'rgba(201,164,99,0.32)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 12,
  },
  titleBlock: {
    alignItems: 'center',
    marginTop: 34,
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
    marginTop: 30,
    paddingHorizontal: 28,
  },
  transportWrapper: {
    marginTop: 24,
  },
});
