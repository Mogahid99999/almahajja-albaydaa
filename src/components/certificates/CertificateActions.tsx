/**
 * «عرض الشهادة» / «تحميل PDF» for an issued certificate. The file comes from the
 * server through a short-lived link; nothing here draws a certificate.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';

import type { IssuedCertificate } from '@/api/certificates';
import { getCertificateFiles } from '@/api/certificates';
import { Txt } from '@/components/ui/Txt';
import { colors, radius } from '@/constants/theme';
import { openCertificatePdf } from '@/lib/certificatePdf';

function ActionButton({
  label,
  icon,
  primary,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  icon: 'eye' | 'download';
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
        flex: 1,
        minHeight: 42,
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

export function CertificateActions({ certificate, showView = true }: { certificate: IssuedCertificate; showView?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const { pdfUrl } = await getCertificateFiles(certificate.id);
      await openCertificatePdf(pdfUrl, certificate.id);
    } catch {
      Alert.alert('تعذّر تحميل الشهادة', 'تحقّق من اتصالك ثم أعد المحاولة.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
      {showView ? (
        <ActionButton
          label="عرض الشهادة"
          icon="eye"
          primary
          onPress={() => router.push(`/certificate/${certificate.id}` as Parameters<typeof router.push>[0])}
        />
      ) : null}
      <ActionButton
        label={certificate.ready ? 'تحميل PDF' : 'جارٍ تجهيز الملف'}
        icon="download"
        busy={busy}
        disabled={!certificate.ready}
        onPress={() => void download()}
      />
    </View>
  );
}
