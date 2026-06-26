/**
 * SectionHeaderBadge — optional header block.
 *
 * Renders ONLY when section.showHeader is true.
 * When false, the section page starts at the meta row — return null.
 *
 * Layout: a teal vertical badge (58px wide, ≥74px tall, radius 18, brass border)
 * containing the full section name in condensed Amiri (scaleX 0.82, brass color).
 * Beside the badge, the description text in muted 13px.
 *
 * Design ref: screens/صفحة القسم.dc.html › section header block.
 * Note from README §2 (badge revision): "put the title IN the badge, not a
 * single-letter icon + separate title".
 */
import { View } from 'react-native';

import { colors, radius } from '@/constants/theme';
import { Txt } from '@/components/ui/Txt';

type Props = {
  title: string;
  description: string | null;
  showHeader: boolean;
};

export function SectionHeaderBadge({ title, description, showHeader }: Props) {
  if (!showHeader) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: 16,
        marginBottom: 4,
      }}
    >
      {/* Teal vertical badge containing the section name */}
      <View
        style={{
          flexShrink: 0,
          width: 58,
          minHeight: 74,
          borderRadius: 18,
          backgroundColor: colors.primaryTeal,
          borderWidth: 1,
          borderColor: 'rgba(176,137,79,0.4)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 10,
          paddingHorizontal: 6,
        }}
      >
        {/*
         * Condensed Amiri: scaleX(0.82) makes the wide Arabic text fit the
         * narrow badge. React Native applies transform to the flex child.
         */}
        <Txt
          weight="display"
          size={23}
          color={colors.accentBrass}
          align="center"
          style={{
            lineHeight: 28,
            letterSpacing: -0.5,
            transform: [{ scaleX: 0.82 }],
          }}
        >
          {title}
        </Txt>
      </View>

      {/* Description beside the badge, vertically centred */}
      {description ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Txt size={13} color={colors.textMuted} style={{ lineHeight: 22 }}>
            {description}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
