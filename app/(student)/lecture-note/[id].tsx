/**
 * ملاحظاتي — private per-lesson note editor (V6 Feature B).
 * Route: /(student)/lecture-note/[id] (player «أدوات الدرس»).
 *
 * One editable note per (user, lecture), debounced autosave («تُحفظ تلقائياً ·
 * خاصة بك»). Strictly private (own-rows RLS) — nobody else can read it.
 * Guests see the calm register nudge instead of the editor.
 */
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { saveMyNote } from '@/api/notes';
import { Card, IconButton, ProgressBar, RhombusEmblem, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useLectureNote, useSaveNote } from '@/hooks/useNotes';
import { useLecturePlayback } from '@/hooks/useLecture';
import { playLecture, seekBy, toggle } from '@/lib/audioController';
import { usePlayerStore } from '@/stores/playerStore';

const AUTOSAVE_MS = 900;

/**
 * The mini player, relocated (user request): while writing a note the BOTTOM
 * mini player is hidden (the keyboard covers it) and this bar above the editor
 * takes its place — same look, same lesson (whatever is CURRENTLY playing, not
 * necessarily this note's lesson), plus ±10s jumps for dictation. If nothing
 * is loaded yet, play starts this note's lesson.
 */
function NotePlayerBar({ lectureId }: { lectureId: string }) {
  const { currentLectureId, title, isPlaying, positionSec, durationSec } = usePlayerStore();
  const hasLecture = !!currentLectureId;
  const progress = durationSec > 0 ? positionSec / durationSec : 0;

  return (
    <View style={styles.playerBar}>
      <RhombusEmblem size={40} radius={12} />
      <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
        <Txt weight="display" size={13.5} color={colors.onTealPrimary} numberOfLines={1}>
          {hasLecture ? title : 'اضغط لتشغيل هذا الدرس'}
        </Txt>
        <ProgressBar
          value={hasLecture ? progress : 0}
          height={3}
          tint="onTeal"
          trackColor="rgba(223,231,227,0.22)"
        />
      </View>

      {/* RTL: تقديم skips left, إرجاع skips right — mirror the transport. */}
      <Pressable
        onPress={() => hasLecture && seekBy(10)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="تقديم ١٠ ثوانٍ"
        style={({ pressed }) => [styles.seekBtn, { opacity: !hasLecture ? 0.35 : pressed ? 0.6 : 1 }]}
      >
        <Feather name="rotate-cw" size={17} color={colors.onTealIcon} />
        <Txt size={8.5} color={colors.onTealSecondary} tabular>
          ١٠
        </Txt>
      </Pressable>
      <Pressable
        onPress={() => hasLecture && seekBy(-10)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="إرجاع ١٠ ثوانٍ"
        style={({ pressed }) => [styles.seekBtn, { opacity: !hasLecture ? 0.35 : pressed ? 0.6 : 1 }]}
      >
        <Feather name="rotate-ccw" size={17} color={colors.onTealIcon} />
        <Txt size={8.5} color={colors.onTealSecondary} tabular>
          ١٠
        </Txt>
      </Pressable>

      <Pressable
        onPress={() => (hasLecture ? toggle() : void playLecture(lectureId))}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={hasLecture && isPlaying ? 'إيقاف' : 'تشغيل'}
        style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.85 }]}
      >
        <Feather
          name={hasLecture && isPlaying ? 'pause' : 'play'}
          size={18}
          color={colors.primaryTealDeep}
        />
      </Pressable>
    </View>
  );
}

function RegisterNudge() {
  const router = useRouter();
  return (
    <Card>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
        <Feather name="user-plus" size={16} color={colors.accentBrassMuted} />
        <Txt size={12.5} color={colors.textMuted} style={{ flex: 1, lineHeight: 20 }}>
          تدوين الملاحظات يتطلب حساباً — حتى تبقى ملاحظاتك محفوظة ومتاحة على أجهزتك.
        </Txt>
      </View>
      <Pressable
        onPress={() => router.push('/(auth)/register')}
        style={({ pressed }) => [styles.registerBtn, pressed && { opacity: 0.85 }]}
      >
        <Txt size={13.5} weight="semibold" color={colors.onTealPrimary}>
          إنشاء حساب
        </Txt>
      </Pressable>
    </Card>
  );
}

function NoteEditor({ lectureId }: { lectureId: string }) {
  const { data: note, isLoading } = useLectureNote(lectureId);
  const save = useSaveNote(lectureId);
  const [draft, setDraft] = useState('');
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest unsaved draft, flushed on unmount so a quick back never loses text.
  const dirtyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading || loadedRef.current) return;
    loadedRef.current = true;
    setDraft(note?.body ?? '');
  }, [isLoading, note]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current !== null) {
        void saveMyNote(lectureId, dirtyRef.current).catch(() => {});
      }
    },
    [lectureId],
  );

  function onChange(text: string) {
    setDraft(text);
    dirtyRef.current = text;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dirtyRef.current = null;
      save.mutate(text);
    }, AUTOSAVE_MS);
  }

  if (isLoading) {
    return (
      <View style={{ paddingVertical: 60, alignItems: 'center' }}>
        <ActivityIndicator color={colors.primaryTeal} />
      </View>
    );
  }

  return (
    <>
      <Card style={{ padding: 4 }}>
        <TextInput
          value={draft}
          onChangeText={onChange}
          placeholder="لخّص ما استفدته من هذا الدرس..."
          placeholderTextColor={colors.textGhost}
          multiline
          textAlign="right"
          textAlignVertical="top"
          style={styles.editor}
        />
      </Card>
      <View style={styles.statusRow}>
        <Feather name="lock" size={12} color={colors.textGhost} />
        <Txt size={11.5} color={colors.textGhost}>
          تُحفظ تلقائياً · خاصة بك لا يراها غيرك
        </Txt>
        <View style={{ flex: 1 }} />
        {save.isPending ? (
          <Txt size={11.5} color={colors.textGhost}>
            جارٍ الحفظ...
          </Txt>
        ) : save.isSuccess ? (
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5 }}>
            <Feather name="check" size={12} color={colors.stateSuccess} />
            <Txt size={11.5} color={colors.stateSuccess}>
              تم الحفظ
            </Txt>
          </View>
        ) : null}
      </View>
    </>
  );
}

export default function LectureNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: lecture } = useLecturePlayback(id ?? '');

  return (
    <Screen bottomPad={118} padded>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          ملاحظاتي
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>
      {lecture?.title ? (
        <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 18 }} numberOfLines={2}>
          {lecture.title}
        </Txt>
      ) : (
        <View style={{ marginBottom: 18 }} />
      )}

      {isGuest ? (
        <RegisterNudge />
      ) : id ? (
        <>
          <NotePlayerBar lectureId={id} />
          <NoteEditor lectureId={id} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Mirrors the bottom MiniPlayer's look — it stands in for it on this screen.
  playerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    padding: 10,
    borderRadius: radius.feature - 2,
    backgroundColor: colors.primaryTealDeep,
    ...shadows.miniPlayer,
  } as ViewStyle,

  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentBrass,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  seekBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 40,
  } as ViewStyle,

  editor: {
    minHeight: 320,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 26,
    color: colors.textInk,
  } as TextStyle,

  statusRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 4,
  } as ViewStyle,

  registerBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,
});
