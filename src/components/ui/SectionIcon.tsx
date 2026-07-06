import { MaterialCommunityIcons } from '@expo/vector-icons';

import { sectionIconName } from '@/lib/sectionIcon';

type Props = {
  /** Section title — used to pick a matching icon. */
  title: string;
  size?: number;
  color: string;
};

/** A section's topic icon, no surrounding tile/box — just the glyph. */
export function SectionIcon({ title, size = 24, color }: Props) {
  return <MaterialCommunityIcons name={sectionIconName(title)} size={size} color={color} />;
}
