/**
 * Gets a server-rendered certificate PDF onto the device and opens it, with the
 * same route as PDF attachments: Android's «Open with…», the iOS share sheet.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

const FLAG_GRANT_READ_URI_PERMISSION = 1;

export async function openCertificatePdf(url: string, certificateId: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Linking.openURL(url);
    return;
  }
  const dir = new Directory(Paths.cache, 'certificates');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `شهادة-${certificateId}.pdf`);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(url, dest);

  if (Platform.OS === 'android') {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: await getContentUriAsync(file.uri),
      type: 'application/pdf',
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
    return;
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'شهادة الإتمام' });
}
