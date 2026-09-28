/**
 * «كيف تظهرين في الحلقة؟» — a sister chooses, on entry, to appear with her name
 * or hidden as «طالبة» (PLAN_LIVE_V23 §1.1 item 3, §15 identity). The choice is
 * remembered (liveStore.preferredIdentity) and changeable from «في الحلقة».
 * Either way she sits with the sisters behind the hijab and is counted.
 */
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { LiveAvatar } from '../LiveAvatar';
import type { IdentityChoice } from '../liveTypes';
import { LiveSheet } from './LiveSheet';

export function IdentitySheet({
  visible,
  mode = 'join',
  initial,
  userName,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  /** 'join' = before entering (button «دخول الحلقة»); 'change' = from «في الحلقة». */
  mode?: 'join' | 'change';
  initial: IdentityChoice | null;
  /** Her display name, shown under «باسمي». */
  userName?: string | null;
  onConfirm: (choice: IdentityChoice) => void;
  onClose: () => void;
}) {
  // Privacy-first default, like the server's (liveRules.resolveHiddenName).
  const [choice, setChoice] = useState<IdentityChoice>(initial ?? 'hidden');
  useEffect(() => {
    if (visible) setChoice(initial ?? 'hidden');
  }, [visible, initial]);

  const namedSub = userName
    ? `${userName} · يظهر لمن يضغط على أيقونتك، وحين تتحدثين`
    : 'يظهر لمن يضغط على أيقونتك، وحين تتحدثين';

  return (
    <LiveSheet
      visible={visible}
      onClose={onClose}
      title="كيف تظهرين في الحلقة؟"
      sub="تجلسين مع الأخوات خلف الحجاب في الحالتين، وتُحسبين ضمن الحاضرات."
    >
      <View style={{ gap: 10 }}>
        <Option
          selected={choice === 'named'}
          title="باسمي"
          sub={namedSub}
          onPress={() => setChoice('named')}
        />
        <Option
          selected={choice === 'hidden'}
          title="بدون اسم"
          sub="تظهرين «طالبة» في الحلقة وفي القوائم"
          onPress={() => setChoice('hidden')}
        />
      </View>
      <Pressable
        onPress={() => onConfirm(choice)}
        accessibilityRole="button"
        style={({ pressed }) => [
          {
            marginTop: 16,
            backgroundColor: colors.primaryTeal,
            borderRadius: radius.input,
            paddingVertical: 14,
            alignItems: 'center',
            opacity: pressed ? 0.88 : 1,
          },
          shadows.button,
        ]}
      >
        <Txt size={15} weight="semibold" color={colors.onTealPrimary} align="center">
          {mode === 'join' ? 'دخول الحلقة' : 'حفظ'}
        </Txt>
      </Pressable>
    </LiveSheet>
  );
}

function Option({
  selected,
  title,
  sub,
  onPress,
}: {
  selected: boolean;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 18,
        backgroundColor: selected ? colors.surfaceWhite : colors.surfaceCard,
        borderWidth: 1.5,
        borderColor: selected ? colors.primaryTeal : colors.borderSand,
      }}
    >
      <LiveAvatar gender="f" size={42} />
      <View style={{ flex: 1 }}>
        <Txt size={14.5} weight="semibold">
          {title}
        </Txt>
        <Txt size={12} color={colors.textFaint} style={{ lineHeight: 19 }}>
          {sub}
        </Txt>
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 1.5,
          borderColor: selected ? colors.primaryTeal : colors.borderSand2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? (
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primaryTeal }} />
        ) : null}
      </View>
    </Pressable>
  );
}
