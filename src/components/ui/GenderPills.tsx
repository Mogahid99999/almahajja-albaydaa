import { Pressable, View } from 'react-native';

import type { Gender } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { Txt } from './Txt';

const CHOICES: { value: Gender; label: string }[] = [
  { value: 'male', label: 'ذكر' },
  { value: 'female', label: 'أنثى' },
];

/**
 * Two tappable pill options (ذكر / أنثى) — the 26.2 gender selector used in the
 * registration + edit-profile forms. Controlled; not a dropdown by design.
 */
export function GenderPills({
  value,
  onChange,
}: {
  value: Gender | null;
  onChange: (next: Gender) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {CHOICES.map((c) => {
        const active = c.value === value;
        return (
          <Pressable
            key={c.value}
            onPress={() => onChange(c.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: radius.input,
              alignItems: 'center',
              backgroundColor: active ? 'rgba(31,74,66,0.09)' : colors.surfaceWhite,
              borderWidth: active ? 1.5 : 1,
              borderColor: active ? colors.primaryTeal : colors.borderSand2,
            }}
          >
            <Txt
              size={14}
              weight={active ? 'semibold' : 'medium'}
              color={active ? colors.primaryTeal : colors.textSlate}
            >
              {c.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
