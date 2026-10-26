/**
 * «تجهيز المصحف للقراءة» — the one-time Madinah pack download.
 * Route: /(student)/mushaf/prepare
 *
 * Shows ONLY the download size (space is checked internally and mentioned only
 * when short), real progress (٪ · «X م.ب / Y م.ب» · bar), a clear stopped state
 * with «متابعة التحميل» / «إعادة المحاولة», then «تم تجهيز المصحف ✓» and the
 * reader. The outlined «اقرأ الآن بالخط المبسّط» button opens the bundled text at
 * once and never cancels or deletes a partial download. Never shown again
 * once the pack is ready.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { IconButton, Screen, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { fetchDownloadSize, initPack, startPackDownload, toMB, usePackStore } from '@/mushaf/pack';
import { ar } from '@/mushaf/quran';
import { useMushafStore } from '@/mushaf/store';

const mb = (bytes: number) => ar(toMB(bytes));
const mbDone = (bytes: number) => ar(Math.floor(bytes / (1024 * 1024)));

export default function MushafPrepare() {
  const router = useRouter();
  const status = usePackStore((s) => s.status);
  const justCompleted = usePackStore((s) => s.justCompleted);
  const setPreferSimple = useMushafStore((s) => s.setPreferSimple);

  useEffect(() => {
    void initPack().then(() => {
      if (usePackStore.getState().status.state === 'idle') void fetchDownloadSize();
    });
  }, []);

  // Ready: say so once after a fresh download, otherwise go straight to reading.
  useEffect(() => {
    if (status.state === 'unsupported' || (status.state === 'ready' && !justCompleted)) {
      router.replace('/mushaf/read');
      return;
    }
    if (status.state === 'ready' && justCompleted) {
      const t = setTimeout(() => {
        usePackStore.setState({ justCompleted: false });
        router.replace('/mushaf/read');
      }, 1400);
      return () => clearTimeout(t);
    }
  }, [status.state, justCompleted, router]);

  const readSimple = () => {
    setPreferSimple(true);
    router.replace('/mushaf/read');
  };

  const total = 'total' in status && status.total ? status.total : null;
  const done = status.state === 'downloading' || status.state === 'paused' ? status.done : 0;
  const pct = total ? Math.min(100, Math.floor((done / total) * 100)) : 0;

  let body: ReactNode;
  if (status.state === 'checking') {
    body = <ActivityIndicator color={colors.primaryTeal} style={{ marginVertical: 24 }} />;
  } else if (status.state === 'ready') {
    body = (
      <View style={styles.doneRow}>
        <Feather name="check-circle" size={22} color={colors.stateSuccess} />
        <Txt size={16} weight="semibold" color={colors.stateSuccess}>تم تجهيز المصحف ✓</Txt>
      </View>
    );
  } else if (status.state === 'downloading' || status.state === 'verifying') {
    const verifying = status.state === 'verifying';
    body = (
      <>
        <View style={styles.progressHead}>
          <Txt size={13.5} weight="semibold" color={colors.textInk}>جارٍ تجهيز المصحف…</Txt>
          <Txt size={13.5} weight="semibold" color={colors.primaryTeal}>{ar(verifying ? 100 : pct)}٪</Txt>
        </View>
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: verifying ? 100 : pct }}>
          <View style={[styles.fill, { width: `${verifying ? 100 : pct}%` }]} />
        </View>
        {total ? (
          <Txt size={12} color={colors.textMuted} style={{ marginTop: 8 }}>
            {verifying ? `${mb(total)} م.ب / ${mb(total)} م.ب` : `${mbDone(done)} م.ب / ${mb(total)} م.ب`}
          </Txt>
        ) : null}
      </>
    );
  } else if (status.state === 'paused') {
    const offline = status.reason === 'offline';
    const nospace = status.reason === 'nospace';
    body = (
      <>
        {total && done > 0 ? (
          <>
            <View style={styles.progressHead}>
              <Txt size={13.5} weight="semibold" color={colors.textInk}>توقف التحميل</Txt>
              <Txt size={13.5} weight="semibold" color={colors.primaryTeal}>{ar(pct)}٪</Txt>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.accentBrassSoft }]} />
            </View>
            <Txt size={12} color={colors.textMuted} style={{ marginTop: 8 }}>
              {mbDone(done)} م.ب / {mb(total)} م.ب
            </Txt>
          </>
        ) : null}
        <View style={styles.notice}>
          <Feather name={offline ? 'wifi-off' : nospace ? 'hard-drive' : 'alert-circle'} size={16} color={colors.stateDanger} />
          <Txt size={12.5} color={colors.textSlate} style={{ flex: 1, lineHeight: 20 }}>
            {offline
              ? 'لا يوجد اتصال بالإنترنت. ما تم تحميله محفوظ، ويُستكمل الباقي عند عودة الاتصال.'
              : nospace
                ? `المساحة المتاحة على جهازك لا تكفي. يحتاج المصحف إلى نحو ${mb(status.needBytes ?? 0)} م.ب، فأفرغ بعض المساحة ثم تابع.`
                : status.reason === 'interrupted'
                  ? 'توقف التحميل قبل اكتماله، وما تم تحميله محفوظ.'
                  : 'تعذّر إكمال التحميل. ما تم تحميله محفوظ، ويمكنك المحاولة مرة أخرى.'}
          </Txt>
        </View>
        <Pressable onPress={() => void startPackDownload()} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
          <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
            {done > 0 ? 'متابعة التحميل' : 'إعادة المحاولة'}
          </Txt>
        </Pressable>
      </>
    );
  } else {
    // idle
    body = (
      <>
        {total ? (
          <Txt size={13} color={colors.textMuted} align="center" style={{ marginBottom: 14 }}>
            حجم التحميل: {mb(total)} م.ب
          </Txt>
        ) : null}
        <Pressable onPress={() => void startPackDownload()} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
          <Feather name="download" size={17} color={colors.onTealPrimary} />
          <Txt size={15} weight="semibold" color={colors.onTealPrimary}>تحميل المصحف</Txt>
        </Pressable>
      </>
    );
  }

  return (
    <Screen padded>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
          المصحف
        </Txt>
      </View>

      <View style={styles.card}>
        <View style={styles.emblem}>
          <Feather name="book-open" size={26} color={colors.onTealPrimary} />
        </View>
        <Txt size={20} weight="display" color={colors.primaryTeal} align="center">
          تجهيز المصحف للقراءة
        </Txt>
        <Txt size={13.5} color={colors.textMuted} align="center" style={{ lineHeight: 23, marginTop: 6, marginBottom: 18 }}>
          يتم تحميل ملفات مصحف المدينة مرة واحدة فقط، وبعدها يمكنك القراءة بدون اتصال بالإنترنت.
        </Txt>
        <View style={{ alignSelf: 'stretch' }}>{body}</View>
      </View>

      {status.state !== 'ready' && status.state !== 'checking' ? (
        <Pressable
          onPress={readSimple}
          accessibilityRole="button"
          style={({ pressed }) => [styles.simpleBtn, pressed && { opacity: 0.8 }]}
        >
          <Feather name="book-open" size={16} color={colors.primaryTeal} />
          <Txt size={14} weight="semibold" color={colors.primaryTeal}>
            اقرأ الآن بالخط المبسّط
          </Txt>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand,
    borderRadius: radius.card,
    paddingVertical: 24,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  emblem: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryTeal,
    borderWidth: 2,
    borderColor: colors.accentBrass,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  btn: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTeal,
    borderRadius: radius.input,
    paddingVertical: 13,
    marginTop: 4,
  },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  track: { height: 8, borderRadius: 8, backgroundColor: colors.surfaceTrack, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 8, backgroundColor: colors.primaryTeal },
  notice: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(184,92,74,0.07)',
    borderRadius: radius.input,
    padding: 12,
    marginVertical: 14,
  },
  // Secondary to «تحميل المصحف»: outlined, never competes with the download.
  simpleBtn: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: radius.input,
    borderWidth: 1.5,
    borderColor: colors.primaryTeal,
    backgroundColor: colors.surfaceCard,
  },
  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
});
