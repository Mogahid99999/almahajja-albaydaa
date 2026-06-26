import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';

import { colors, radius } from '@/constants/theme';
import { Rhombus, Txt } from '@/components/ui';

/**
 * "لا تنسَ الدعاء" — quiet dashed-brass card at the bottom of the Home screen.
 * Non-intrusive; links to the About page so students can read more.
 */
export function DuaCard() {
  return (
    <Link href="/about" asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="لا تنسَ الدعاء للمشايخ والمساهمين"
        style={({ pressed }) => ({
          marginTop: 24,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View
          style={{
            backgroundColor: 'rgba(176,137,79,0.06)',
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.accentBrassSoft,
            borderRadius: radius.card,
            padding: 16,
            paddingHorizontal: 18,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}
        >
          {/* Rhombus brand mark */}
          <View
            style={{
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Rhombus size={20} color={colors.accentBrassMuted} filled={false} />
          </View>

          {/* Text block */}
          <View style={{ flex: 1 }}>
            <Txt
              weight="display"
              size={15}
              color="#5c4a2a"
              style={{ lineHeight: 22 }}
            >
              لا تنسَ الدعاء
            </Txt>
            <Txt
              size={12}
              color={colors.textFaint}
              style={{ marginTop: 3, lineHeight: 20 }}
            >
              ادعُ لمشايخ المنصة ولكل من ساهم في نشر هذا العلم، جزاهم الله خيراً.
            </Txt>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}
