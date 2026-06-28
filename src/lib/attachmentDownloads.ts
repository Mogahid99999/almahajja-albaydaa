/**
 * Offline download file operations for attachments (expo-file-system) — the
 * attachment counterpart to `src/lib/downloads.ts` (PRD §13). Files are saved
 * under <documents>/attachments/<id>.<ext>: remote file types (pdf/image) are
 * fetched, while a تفريغ (transcript) carries inline text that is written to a
 * .txt so it is available offline. Web has no persistent FS here — these no-op.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { Attachment, AttachmentType } from '@/api/types';

const isWeb = Platform.OS === 'web';

/** File extension per downloadable type (mock URLs often lack one). */
const EXT: Partial<Record<AttachmentType, string>> = {
  pdf: 'pdf',
  image: 'jpg',
  transcript: 'txt',
};

/** Whether an attachment has downloadable content (a remote file or text). */
export function isDownloadable(attachment: Attachment): boolean {
  if (attachment.type === 'transcript') return !!attachment.body;
  if (attachment.type === 'pdf' || attachment.type === 'image') return !!attachment.url;
  return false;
}

function attachmentsDir(): Directory {
  const dir = new Directory(Paths.document, 'attachments');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function fileFor(id: string, type: AttachmentType): File {
  return new File(attachmentsDir(), `${id}.${EXT[type] ?? 'bin'}`);
}

/** Local URI if the attachment is already downloaded, else null. */
export function localUriForAttachment(id: string, type: AttachmentType): string | null {
  if (isWeb) return null;
  try {
    const f = fileFor(id, type);
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

/** Download (or write) an attachment to local storage; returns the local URI. */
export async function downloadAttachment(attachment: Attachment): Promise<string> {
  if (isWeb) throw new Error('التحميل غير مدعوم على الويب');
  const dest = fileFor(attachment.id, attachment.type);
  if (dest.exists) dest.delete();

  if (attachment.type === 'transcript') {
    if (!attachment.body) throw new Error('لا يوجد نص للتفريغ');
    dest.create();
    dest.write(attachment.body);
    return dest.uri;
  }

  if (!attachment.url) throw new Error('لا يوجد ملف للتحميل');
  const file = await File.downloadFileAsync(attachment.url, dest);
  return file.uri;
}

/** Delete a downloaded attachment file. */
export function deleteAttachmentFile(id: string, type: AttachmentType): void {
  if (isWeb) return;
  try {
    const f = fileFor(id, type);
    if (f.exists) f.delete();
  } catch {
    /* ignored */
  }
}
