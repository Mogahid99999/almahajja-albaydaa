/**
 * One issued certificate (route opened from «شهاداتي», the section page and the
 * «تم إصدار شهادتك» notification). The picture and the PDF both come from the
 * server; the app holds no template.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Image, View } from 'react-native';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { CertificateActions } from '@/components/certificates/CertificateActions';
import { CertificateShareActions } from '@/components/certificates/CertificateShareActions';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { colors } from '@/constants/theme';
import { useCertificateFiles, useMyCertificate } from '@/hooks/useCertificates';

export default function CertificateScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: certificate, isLoading } = useMyCertificate(id);
  const valid = certificate?.status === 'valid';
  const { data: files } = useCertificateFiles(id, valid && !!certificate?.ready);

  return (
    <Screen padded bottomPad={24 + BOTTOM_NAV_CLEARANCE}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
          شهادتي
        </Txt>
      </View>

      {isLoading ? (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      ) : !certificate ? (
        <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
          <Txt size={14} color={colors.textMuted} align="center">
            لم نجد هذه الشهادة في حسابك.
          </Txt>
        </Card>
      ) : !valid ? (
        <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
          <Txt size={14} color={colors.textMuted} align="center">
            أُلغيت هذه الشهادة.
          </Txt>
        </Card>
      ) : (
        <>
          <Card style={{ padding: 8 }}>
            <View
              style={{ width: '100%', aspectRatio: 1123 / 794, alignItems: 'center', justifyContent: 'center' }}
            >
              {files ? (
                <Image
                  source={{ uri: files.previewUrl }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                  accessibilityLabel={`شهادة إتمام ${certificate.title}`}
                />
              ) : (
                <View style={{ alignItems: 'center', gap: 10 }}>
                  <ActivityIndicator color={colors.primaryTeal} />
                  {!certificate.ready ? (
                    <Txt size={12.5} color={colors.textMuted}>
                      جارٍ تجهيز شهادتك…
                    </Txt>
                  ) : null}
                </View>
              )}
            </View>
          </Card>

          <Txt size={15} weight="semibold" color={colors.textInk} align="center" style={{ marginTop: 16 }}>
            تم إصدار شهادتك
          </Txt>
          <Txt size={13} color={colors.textMuted} align="center" style={{ marginTop: 4, lineHeight: 21 }}>
            {[certificate.title, certificate.issueDateText].filter(Boolean).join(' · ')}
          </Txt>
          <CertificateActions certificate={certificate} showView={false} />
          <CertificateShareActions certificate={certificate} shareText={files?.shareText} />
        </>
      )}
    </Screen>
  );
}
