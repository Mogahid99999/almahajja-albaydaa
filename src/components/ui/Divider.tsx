import { View } from 'react-native';

import { colors } from '@/constants/theme';

/** Hairline row separator inside cards (`border/hair`). */
export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.borderHair }} />;
}
