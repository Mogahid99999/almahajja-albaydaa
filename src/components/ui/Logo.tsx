import { Image } from 'react-native';

/**
 * App logo: the brand mark (brass open-book chevron over the white path on a
 * deep-teal tile), exported from the source artwork (assets/logo.pdf) as
 * assets/logo-mark.png. Rendered as a rounded-square chip so it reads as the
 * app icon everywhere it appears (home header, admin sidebar, sign-in).
 */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <Image
      source={require('../../../assets/logo-mark.png')}
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      resizeMode="cover"
      accessibilityLabel="شعار المَحجّة البَيْضَاء"
    />
  );
}
