/**
 * «شهادة إتمام» — marks a section that grants this student a completion
 * certificate (0168 settings, listed by 0169 get_my_certificates). Brass, like
 * the app's other quiet seals (SeriesSeal, badges): a mark, not a call to action.
 *
 * 'md' on the section page meta row (icon + words); 'sm' on the 2-column section
 * cards, where there is room for the icon only (the label stays for screen
 * readers). A card is marked when the section grants a certificate OR one of the
 * sections inside it does, so its spoken label covers both.
 */
import Feather from '@expo/vector-icons/Feather';
import { View } from 'react-native';

import { colors, radius } from '@/constants/theme';
import { Txt } from '@/components/ui/Txt';

export const CERTIFICATE_LABEL = 'شهادة إتمام';

export function CertificateTag({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const sm = size === 'sm';
  return (
    <View
      accessible
      accessibilityLabel={sm ? 'في هذا القسم شهادة إتمام' : CERTIFICATE_LABEL}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(201, 164, 99, 0.16)',
        borderRadius: radius.pill,
        paddingHorizontal: sm ? 5 : 10,
        paddingVertical: sm ? 3 : 5,
      }}
    >
      <Feather name="award" size={sm ? 11 : 12} color={colors.accentBrassMuted} />
      {sm ? null : (
        <Txt size={12} weight="semibold" color={colors.accentBrassMuted}>
          {CERTIFICATE_LABEL}
        </Txt>
      )}
    </View>
  );
}
