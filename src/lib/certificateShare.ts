/**
 * Shares the official certificate image (rendered by the server from the
 * certificate's own template) through the system share sheet. The caption goes
 * with the image on Android (patches/expo-sharing); iOS and many apps drop it,
 * so the wording is on the clipboard too.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
// Core Clipboard is deprecated but ships in the native binary already in use.
import { Clipboard, Linking, Platform } from 'react-native';

export function copyCertificateShareText(text: string): void {
  Clipboard.setString(text);
}

export async function shareCertificateImage(url: string, certificateId: string, caption: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    await Linking.openURL(url);
    return;
  }
  const dir = new Directory(Paths.cache, 'certificates');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `certificate-${certificateId}.jpg`);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(url, dest);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'image/jpeg',
    UTI: 'public.jpeg',
    dialogTitle: 'مشاركة الشهادة',
    ...(caption ? { text: caption } : {}),
  });
}
