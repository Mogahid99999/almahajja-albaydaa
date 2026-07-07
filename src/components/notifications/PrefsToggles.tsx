/**
 * Per-type notification preferences (feature B), mounted in the profile screen.
 * One calm switch per type — درس جديد / مرفق جديد / اختبار جديد / تذكير بالمتابعة.
 * Absence of a stored pref means ON, so toggles render enabled by default. No
 * counts, no badges — just quiet on/off control (CLAUDE.md calm tone).
 */
import { Switch, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import type { NotificationType } from '@/api/types';
import { colors } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useNotificationPrefs, useSetNotificationPref } from '@/hooks/useNotifications';

import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';
import {
  NOTIFICATION_TYPE_ORDER,
  notificationTypeDescription,
  notificationTypeIcon,
  notificationTypeLabel,
} from './labels';

function ToggleRow({
  type,
  enabled,
  onToggle,
  description,
}: {
  type: NotificationType;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  description?: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        gap: 12,
      }}
    >
      {/* Type icon (RTL: rightmost) */}
      <View
        style={{
          width: 34,
          height: 34,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name={notificationTypeIcon[type]} size={15} color={colors.primaryTeal} />
      </View>

      <View style={{ flex: 1 }}>
        <Txt size={14} weight="medium" color={colors.textInk}>
          {notificationTypeLabel[type]}
        </Txt>
        <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 2 }}>
          {description ?? notificationTypeDescription[type]}
        </Txt>
      </View>

      <Switch
        value={enabled}
        onValueChange={onToggle}
        trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
        thumbColor={colors.surfaceWhite}
        ios_backgroundColor={colors.surfaceInset}
      />
    </View>
  );
}

export function PrefsToggles() {
  const { data: prefs } = useNotificationPrefs();
  const { data: user } = useCurrentUser();
  const setPref = useSetNotificationPref();

  // `question_received` is the sheikh's «سؤال جديد» pref — irrelevant to
  // students, so it's hidden here (sheikhs control it from their own screen).
  const types =
    user?.role === 'sheikh'
      ? NOTIFICATION_TYPE_ORDER
      : NOTIFICATION_TYPE_ORDER.filter((type) => type !== 'question_received');

  // Buddy matching is same-gender (0015): a female user's buddy is female.
  const buddyDesc =
    user?.gender === 'female' ? 'عند إتمام رفيقتك درساً' : undefined;

  return (
    <View>
      <SectionTitle title="الإشعارات" />
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {types.map((type, index) => (
          <View key={type}>
            {index > 0 ? <Divider /> : null}
            <ToggleRow
              type={type}
              enabled={prefs?.[type] ?? true}
              onToggle={(next) => setPref.mutate({ type, enabled: next })}
              description={type === 'buddy_activity' ? buddyDesc : undefined}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}
