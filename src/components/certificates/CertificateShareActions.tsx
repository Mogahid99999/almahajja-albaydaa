/**
 * «مشاركة الشهادة» / «نسخ نص المشاركة». The image is the official certificate as the
 * server rendered it, and the wording comes from the server too; the app draws neither.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';

import type { IssuedCertificate } from '@/api/certificates';
import { getCertificateFiles } from '@/api/certificates';
import { Txt } from '@/components/ui/Txt';
import { colors, radius } from '@/constants/theme';
import { copyCertificateShareText, shareCertificateImage } from '@/lib/certificateShare';

const FAILED = ['تعذّرت المشاركة', 'تحقّق من اتصالك ثم أعد المحاولة.'] as const;

function ShareButton({
  label,
  icon,
  primary,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  icon: 'share-2' | 'copy';
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const fg = primary ? colors.onTealPrimary : colors.primaryTeal;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.primaryTeal,
        backgroundColor: primary ? colors.primaryTeal : 'transparent',
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : <Feather name={icon} size={15} color={fg} />}
      <Txt size={13} weight="semibold" color={fg}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function CertificateShareActions({
  certificate,
  shareText,
}: {
  certificate: IssuedCertificate;
  /** Shown under the copy button; null until the links have loaded. */
  shareText?: string | null;
}) {
  const [sharing, setSharing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const ready = certificate.ready;

  async function share() {
    setSharing(true);
    try {
      const { previewUrl, shareText } = await getCertificateFiles(certificate.id);
      if (shareText) {
        copyCertificateShareText(shareText);
        setNote('نسخنا نص المشاركة، فإن لم يظهر مع الصورة فألصقه.');
      }
      await shareCertificateImage(previewUrl, certificate.id, shareText);
    } catch {
      Alert.alert(...FAILED);
    } finally {
      setSharing(false);
    }
  }

  async function copy() {
    setCopying(true);
    try {
      const text = shareText ?? (await getCertificateFiles(certificate.id)).shareText;
      if (!text) throw new Error('share text not ready');
      copyCertificateShareText(text);
      setNote('تم نسخ نص المشاركة.');
    } catch {
      Alert.alert(...FAILED);
    } finally {
      setCopying(false);
    }
  }

  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <ShareButton
        label={ready ? 'مشاركة الشهادة' : 'جارٍ تجهيز الشهادة'}
        icon="share-2"
        primary
        busy={sharing}
        disabled={!ready}
        onPress={() => void share()}
      />
      <ShareButton label="نسخ نص المشاركة" icon="copy" busy={copying} disabled={!ready} onPress={() => void copy()} />
      {shareText ? (
        <View
          style={{
            padding: 12,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: colors.borderSand2,
            backgroundColor: colors.surfaceCard,
          }}
        >
          <Txt size={13} color={colors.textInk} selectable style={{ lineHeight: 23 }}>
            {shareText}
          </Txt>
        </View>
      ) : null}
      {note ? (
        <Txt size={12.5} color={colors.textMuted} align="center" accessibilityLiveRegion="polite">
          {note}
        </Txt>
      ) : null}
    </View>
  );
}
