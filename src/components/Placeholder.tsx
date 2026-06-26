import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

/**
 * Structural placeholder for routes that exist to define the navigation tree
 * but whose UI is built in the screen phase. Not a designed screen — see
 * README.md / ds-bundle for the real designs to implement later.
 */
export function Placeholder({ name }: { name: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{name}</Text>
      <Text style={styles.subtitle}>placeholder · يُبنى لاحقاً</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSand,
    gap: 6,
  },
  title: { color: colors.primaryTeal, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.textGhost, fontSize: 12 },
});
