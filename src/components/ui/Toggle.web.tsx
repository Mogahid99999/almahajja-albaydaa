/**
 * Toggle (web) — react-native-web's Switch on an RTL page.
 *
 * RN-web resolves the thumb's logical «start» offsets to physical LEFT values
 * (its I18nManager says LTR), while our page is <html dir="rtl">, where the
 * thumb's `alignSelf: flex-start` lands on the RIGHT. Switched on, the thumb was
 * pushed a full track-width further right — outside the track, on every admin
 * screen (2026-11-18, measured: track x 317–357, thumb x 377–397).
 *
 * Lay the Switch out LTR, where its maths is right, then mirror it so it reads
 * RTL like the native Arabic switch: off = thumb on the right, on = on the left.
 * The thumb also gets the caller's thumbColor when on (RN-web otherwise paints
 * its own teal there).
 */
import { StyleSheet, Switch, View, type SwitchProps } from 'react-native';

// RN-web drops a `direction` style; the `dir` attribute is what makes the
// subtree LTR.
const ltr = { dir: 'ltr' } as object;

export function Toggle({ thumbColor, ...props }: SwitchProps) {
  return (
    <View {...ltr} style={styles.mirror}>
      <Switch
        {...props}
        thumbColor={thumbColor}
        {...(thumbColor ? ({ activeThumbColor: thumbColor } as object) : null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mirror: {
    transform: [{ scaleX: -1 }],
  },
});
