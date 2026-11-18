/**
 * TextInput — React Native's TextInput with one Android fix.
 *
 * Android gives every EditText a default vertical padding. Our single-line
 * fields have a fixed height (42–46), so with the phone's font size raised —
 * common among our students — the text no longer fits between that padding and
 * Android cuts it from the TOP: digits in the phone field, «اسمك», e-mail and
 * password hints (reproduced on the A54 at font_scale 1.3, 2026-11-18).
 *
 * For a fixed-height, single-line field that sets no vertical padding of its
 * own, the padding is zeroed and the text centred, so it uses the whole height.
 * Multi-line fields, fields with their own padding or a free height, iOS and
 * web are passed through untouched.
 */
import { forwardRef } from 'react';
import {
  Platform,
  TextInput as RNTextInput,
  StyleSheet,
  type TextInputProps,
  type TextStyle,
} from 'react-native';

import { APP_FONT_SCALING } from './fontScaling';

const FIXED_HEIGHT_FIX: TextStyle = { paddingVertical: 0, textAlignVertical: 'center' };

export function needsFixedHeightFix(props: Pick<TextInputProps, 'multiline' | 'style'>, os = Platform.OS): boolean {
  if (os !== 'android' || props.multiline) return false;
  const s = (StyleSheet.flatten(props.style) ?? {}) as TextStyle;
  if (s.height == null) return false;
  return s.padding == null && s.paddingVertical == null && s.paddingTop == null && s.paddingBottom == null;
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(props, ref) {
  const style = needsFixedHeightFix(props) ? [FIXED_HEIGHT_FIX, props.style] : props.style;
  // Same fixed text size as Txt (see APP_FONT_SCALING).
  return <RNTextInput ref={ref} allowFontScaling={APP_FONT_SCALING} {...props} style={style} />;
});

/** So `useRef<TextInput>(null)` keeps working after the import switch. */
export type TextInput = RNTextInput;
