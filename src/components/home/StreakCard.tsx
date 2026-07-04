import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors, radius } from '@/constants/theme';
import { arDayCount } from '@/lib/format';
import { useCurrentUser } from '@/hooks/useAuth';
import { useStreakStatus } from '@/hooks/useStreak';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * Home streak card — المداومة اليومية (26.1). Four quiet states, no animation,
 * no pressure: counted today / not yet / recovery window open / fresh start.
 * Registered users only (the streak is part of رحلتي العلمية). The recovery CTA
 * opens an INFORMATIONAL sheet — recovery itself is applied automatically by
 * record_meaningful_activity once today's compensatory bar is met.
 */
export function StreakCard() {
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: status } = useStreakStatus({ enabled: !isGuest });
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isGuest || !status) return null;

  const { current, todayCounted, recoveryAvailable, recoveryDaysLeft } = status;

  let icon: keyof typeof Feather.glyphMap | null = null;
  let title: string;
  let subtitle: string;
  if (recoveryAvailable) {
    icon = 'rotate-ccw';
    title = 'لديك فرصة لاستعادة مداومتك';
    subtitle = remainingDays(recoveryDaysLeft);
  } else if (current > 0 && todayCounted) {
    icon = 'check';
    title = `مداومتك: ${arDayCount(current)}`;
    subtitle = 'واصلت اليوم، نفعك الله';
  } else if (current > 0) {
    icon = 'feather';
    title = `مداومتك: ${arDayCount(current)}`;
    subtitle = 'لم تواصل اليوم بعد، ولو بقدر يسير';
  } else {
    icon = 'sunrise';
    title = 'ابدأ مداومتك اليوم';
    subtitle = 'ولو بقدر يسير';
  }

  return (
    <>
      <Card style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              borderWidth: 2,
              borderColor: colors.accentBrass,
              backgroundColor: colors.primaryTeal,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name={icon} size={20} color={colors.onTealPrimary} />
          </View>

          <View style={{ flex: 1 }}>
            <Txt weight="display" size={15.5} color={colors.primaryTeal}>
              {title}
            </Txt>
            <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }}>
              {subtitle}
            </Txt>
          </View>

          {recoveryAvailable ? (
            <Pressable
              onPress={() => setSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="كيف أستعيد مداومتي؟"
              style={({ pressed }) => ({
                paddingVertical: 9,
                paddingHorizontal: 14,
                borderRadius: radius.pill,
                backgroundColor: colors.primaryTeal,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Txt size={12.5} weight="semibold" color={colors.onTealPrimary}>
                كيف أستعيدها؟
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </Card>

      <RecoverySheet
        visible={sheetOpen}
        daysLeft={recoveryDaysLeft}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

/** "X أيام متبقية" with Arabic-correct duals. */
function remainingDays(n: number): string {
  if (n <= 1) return 'يوم واحد متبقٍ';
  if (n === 2) return 'يومان متبقيان';
  return `${arDayCount(n)} متبقية`;
}

/**
 * Informational bottom sheet: what the compensatory activity is. No "use
 * recovery" button — the SQL applies it automatically once the bar is met.
 */
function RecoverySheet({
  visible,
  daysLeft,
  onClose,
}: {
  visible: boolean;
  daysLeft: number;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(22,53,47,0.35)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.bgSandRaised,
            borderTopLeftRadius: radius.artwork,
            borderTopRightRadius: radius.artwork,
            paddingHorizontal: 22,
            paddingTop: 18,
            paddingBottom: 34,
            gap: 14,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 44,
              height: 5,
              borderRadius: 3,
              backgroundColor: colors.borderSand2,
            }}
          />

          <Txt weight="display" size={20} color={colors.primaryTeal} align="center">
            استعادة المداومة
          </Txt>

          <Txt size={13.5} color={colors.textSlate} align="center" style={{ lineHeight: 22 }}>
            انقطعت مداومتك قريباً، وما زال بالإمكان استعادتها بإذن الله.
          </Txt>

          <Txt size={13.5} color={colors.textSlate} align="center" style={{ lineHeight: 22 }}>
            استمع اليوم إلى درسين، أو أربع دقائق من الاستماع، وتعود مداومتك كما كانت تلقائياً.
          </Txt>

          <Txt size={12.5} color={colors.textMuted} align="center">
            {remainingDays(daysLeft)} على انتهاء المهلة
          </Txt>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 6,
              paddingVertical: 14,
              borderRadius: radius.input,
              alignItems: 'center',
              backgroundColor: colors.primaryTeal,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
              فهمت
            </Txt>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
