/**
 * Offline download file operations (expo-file-system). Lecture audio is saved
 * under <documents>/lectures/<id>.mp3 so the player can prefer a local file
 * over streaming (PRD §10). Web has no persistent FS here — these no-op safely.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

function lecturesDir(): Directory {
  const dir = new Directory(Paths.document, 'lectures');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function fileFor(lectureId: string): File {
  return new File(lecturesDir(), `${lectureId}.mp3`);
}

/** Local URI if the lecture is already downloaded, else null. */
export function localUriFor(lectureId: string): string | null {
  if (isWeb) return null;
  try {
    const f = fileFor(lectureId);
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

/** Download a lecture's audio to local storage; returns the local URI. */
export async function downloadLecture(lectureId: string, url: string): Promise<string> {
  if (isWeb) throw new Error('التحميل غير مدعوم على الويب');
  const dest = new File(lecturesDir(), `${lectureId}.mp3`);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(url, dest);
  return file.uri;
}

/** Delete a downloaded lecture file. */
export function deleteLecture(lectureId: string): void {
  if (isWeb) return;
  try {
    const f = fileFor(lectureId);
    if (f.exists) f.delete();
  } catch {
    /* ignored */
  }
}
