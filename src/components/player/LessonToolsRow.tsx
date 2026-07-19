/**
 * «أدوات الدرس» — compact chip row pinned above the player utility bar (V6):
 *   ملاحظاتي · فوائد الدارسين · أسئلة الدرس · تحميل
 * Each opens a full screen (roomy for reading/writing) over the modal player.
 * A subtle brass dot on ملاحظاتي marks an existing note.
 */
import { useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { arDuration } from '@/lib/format';
import { useCurrentUser } from '@/hooks/useAuth';
import { useLectureNote } from '@/hooks/useNotes';
import { useDownload } from '@/hooks/useDownloads';
import { useAddBookmark } from '@/hooks/useBookmarks';
import { usePlayerStore } from '@/stores/playerStore';
import { toArabicDigits } from '@/lib/format';
import { AddBookmarkSheet } from './AddBookmarkSheet';

type Router = ReturnType<typeof useRouter>;

/** Typed-routes cast in one place (routes newer than the generated union). */
function push(router: Router, href: string) {
  router.push(href as Parameters<Router['push']>[0]);
}

/**
 * A player tool as a compact ICON-OVER-LABEL tile (V20 redesign). All five tiles
 * share the row equally (flex:1), so every one — ملاحظاتي · الفوائد · الأسئلة ·
 * للمراجعة · تحميل — is always visible and tappable on one line, no wrap, no
 * scroll, no overlap with the transport controls above.
 */
function ToolChip({
  icon,
  label,
  onPress,
  dot = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  dot?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 4,
        paddingVertical: 8,
        paddingHorizontal: 2,
        borderRadius: radius.sm,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View>
        <Feather name={icon} size={20} color={colors.accentBrass} />
        {dot ? (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -3,
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: colors.accentBrass,
            }}
          />
        ) : null}
      </View>
      <Txt size={11} weight="medium" color={colors.onTealPrimary} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Download tile — same icon-over-label tile as ToolChip, reflecting state. */
function DownloadChip({ lectureId }: { lectureId: string }) {
  const { status, progress, totalBytes, download, remove } = useDownload(lectureId);
  if (Platform.OS === 'web') return null;

  const label =
    status === 'downloaded'
      ? 'محمّل'
      : status === 'downloading'
        ? totalBytes
          ? `${toArabicDigits(String(Math.round(progress * 100)))}٪`
          : 'جارٍ…'
        : 'تحميل';

  return (
    <Pressable
      onPress={status === 'downloaded' ? remove : status === 'idle' || status === 'error' ? download : undefined}
      accessibilityRole="button"
      accessibilityLabel={status === 'downloaded' ? 'حذف التحميل' : 'تحميل الدرس'}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 4,
        paddingVertical: 8,
        paddingHorizontal: 2,
        borderRadius: radius.sm,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {status === 'downloading' && !totalBytes ? (
        <ActivityIndicator size="small" color={colors.accentBrass} />
      ) : (
        <Feather
          name={status === 'downloaded' ? 'check-circle' : status === 'error' ? 'alert-circle' : 'download'}
          size={20}
          color={status === 'error' ? colors.stateDanger : colors.accentBrass}
        />
      )}
      <Txt size={11} weight="medium" color={colors.onTealPrimary} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function LessonToolsRow({
  lectureId,
  bottom = 86,
}: {
  lectureId: string;
  /** Base bottom offset — the player shrinks it on short viewports. */
  bottom?: number;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  // The note dot — only fetched for registered users (guests have no notes).
  const { data: note } = useLectureNote(lectureId, !isGuest);

  // «للمراجعة لاحقًا» (§4): capture the live position at open (audio keeps playing),
  // save via the offline-safe mutation, confirm with a toast that never pauses.
  const addBookmark = useAddBookmark();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [capturedPos, setCapturedPos] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const lessonTitle = usePlayerStore((s) => s.title) ?? 'هذا الدرس';

  function openBookmark() {
    setCapturedPos(Math.max(0, Math.floor(usePlayerStore.getState().positionSec)));
    setSheetOpen(true);
  }

  function saveBookmark(note: string) {
    const pos = capturedPos;
    addBookmark.mutate(
      { lectureId, positionSec: pos, note: note || undefined },
      {
        onSettled: () => {
          setSheetOpen(false);
          setToast(`تمت إضافة الدقيقة ${arDuration(pos)} إلى المراجعة لاحقًا`);
          setTimeout(() => setToast(null), 2600);
        },
      },
    );
  }

  return (
    <>
      {/* One even RTL row of icon-over-label tiles (V20 redesign): every tile
          shares the width (flex:1), so all five — ملاحظاتي · الفوائد · الأسئلة ·
          للمراجعة · تحميل — stay visible on a single line, no wrap, no scroll, no
          overlap with the transport controls. Tracks the utility bar's safe-area
          lift (V4) so the gap stays constant. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: bottom + insets.bottom,
          flexDirection: 'row',
          alignItems: 'flex-start',
          paddingHorizontal: 8,
        }}
      >
        <ToolChip
          icon="edit-3"
          label="ملاحظاتي"
          dot={!!note?.body?.trim()}
          onPress={() => push(router, `/(student)/lecture-note/${lectureId}`)}
        />
        <ToolChip
          icon="award"
          label="الفوائد"
          onPress={() => push(router, `/(student)/lecture-benefits/${lectureId}`)}
        />
        <ToolChip
          icon="help-circle"
          label="الأسئلة"
          onPress={() => push(router, `/(student)/lecture-questions/${lectureId}`)}
        />
        {/* «للمراجعة لاحقًا» — hidden for guests (marks are tied to an account). */}
        {isGuest ? null : (
          <ToolChip icon="bookmark" label="للمراجعة" onPress={openBookmark} />
        )}
        <DownloadChip lectureId={lectureId} />
      </View>

      <AddBookmarkSheet
        visible={sheetOpen}
        lessonTitle={lessonTitle}
        positionSec={capturedPos}
        saving={addBookmark.isPending}
        onClose={() => setSheetOpen(false)}
        onSave={saveBookmark}
      />

      {/* Calm confirmation toast — a brass pill above the tools row; never pauses
          audio. Anchored just above the row's bottom offset. */}
      {toast ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: bottom + insets.bottom + 52,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: colors.primaryTealDeep,
              borderRadius: radius.pill,
              paddingVertical: 10,
              paddingHorizontal: 18,
              borderWidth: 1,
              borderColor: colors.accentBrassSoft,
            }}
          >
            <Txt size={12.5} weight="medium" color={colors.onTealPrimary} align="center" tabular>
              {toast}
            </Txt>
          </View>
        </View>
      ) : null}
    </>
  );
}
