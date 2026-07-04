/**
 * «أدوات الدرس» — compact chip row pinned above the player utility bar (V6):
 *   ملاحظاتي · فوائد الدارسين · أسئلة الدرس
 * Each opens a full screen (roomy for reading/writing) over the modal player.
 * A subtle brass dot on ملاحظاتي marks an existing note.
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useLectureNote } from '@/hooks/useNotes';

type Router = ReturnType<typeof useRouter>;

/** Typed-routes cast in one place (routes newer than the generated union). */
function push(router: Router, href: string) {
  router.push(href as Parameters<Router['push']>[0]);
}

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
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingVertical: 9,
        paddingHorizontal: 13,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: 'rgba(201,164,99,0.4)',
        backgroundColor: 'rgba(255,255,255,0.06)',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather name={icon} size={14} color={colors.accentBrass} />
      <Txt size={12.5} weight="medium" color={colors.onTealPrimary}>
        {label}
      </Txt>
      {dot ? (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.accentBrass,
          }}
        />
      ) : null}
    </Pressable>
  );
}

export function LessonToolsRow({ lectureId }: { lectureId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  // The note dot — only fetched for registered users (guests have no notes).
  const { data: note } = useLectureNote(lectureId, !isGuest);

  return (
    // Tracks the utility bar's safe-area lift (V4) so the gap stays constant.
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 86 + insets.bottom,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 18,
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
        label="فوائد الدارسين"
        onPress={() => push(router, `/(student)/lecture-benefits/${lectureId}`)}
      />
      <ToolChip
        icon="help-circle"
        label="أسئلة الدرس"
        onPress={() => push(router, `/(student)/lecture-questions/${lectureId}`)}
      />
    </View>
  );
}
