/**
 * SectionHeaderBadge — optional header block.
 *
 * Renders ONLY when section.showHeader is true.
 * When false, the section page starts at the meta row — return null.
 *
 * Layout: a compact teal emblem (58px, brass border) holding the section's cover
 * letter, beside the FULL section title in green (Amiri) with the description
 * under it.
 *
 * Task 7: the title must render IN FULL — earlier it was squeezed INTO a narrow
 * vertical badge (scaleX 0.82) which broke real titles mid-word (العقيدة → العقي
 * / دة, and long titles like "كتاب التوحيد - المجلس الأول" were hopeless). The
 * title now sits beside the emblem and wraps naturally with no numberOfLines
 * clipping. (This intentionally supersedes the old "title IN the badge" note.)
 *
 * Design ref: screens/صفحة القسم.dc.html › section header block.
 */
import { View } from 'react-native';

import { colors } from '@/constants/theme';
import { Txt } from '@/components/ui/Txt';

type Props = {
  title: string;
  description: string | null;
  showHeader: boolean;
  /** Section cover letter (already strips the leading "ال" — matches the grid). */
  coverLetter: string;
};

export function SectionHeaderBadge({ title, description, showHeader, coverLetter }: Props) {
  if (!showHeader) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginBottom: 4,
      }}
    >
      {/* Teal emblem holding the section's cover letter (optically centred) */}
      <View
        style={{
          flexShrink: 0,
          width: 58,
          height: 58,
          borderRadius: 16,
          backgroundColor: colors.primaryTeal,
          borderWidth: 1,
          borderColor: 'rgba(176,137,79,0.4)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Txt weight="display" size={27} color={colors.accentBrass} align="center" centerGlyph>
          {coverLetter}
        </Txt>
      </View>

      {/* Full section title (never clipped) + description */}
      <View style={{ flex: 1 }}>
        <Txt weight="display" size={20} color={colors.primaryTeal} style={{ lineHeight: 28 }}>
          {title}
        </Txt>
        {description ? (
          <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 4, lineHeight: 20 }}>
            {description}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}
