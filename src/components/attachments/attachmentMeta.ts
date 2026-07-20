/**
 * Shared presentation + behavior for attachment types (PRD §13).
 * One place maps each type → Feather icon + Arabic label, and resolves the tap
 * action so the row, the player strip, and the admin manager stay consistent.
 */
import { Alert, Linking, Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import type Feather from '@expo/vector-icons/Feather';
import type { useRouter } from 'expo-router';

import type { Attachment, AttachmentType } from '@/api/types';
import { localUriForAttachment } from '@/lib/attachmentDownloads';

type FeatherName = keyof typeof Feather.glyphMap;
type AppRouter = ReturnType<typeof useRouter>;

const isWeb = Platform.OS === 'web';
const isAndroid = Platform.OS === 'android';
/** ACTION_VIEW flag: grant the target app temporary read access to our content URI. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export const ATTACHMENT_META: Record<
  AttachmentType,
  { icon: FeatherName; label: string }
> = {
  pdf: { icon: 'file-text', label: 'ملف PDF' },
  book: { icon: 'book-open', label: 'كتاب' },
  transcript: { icon: 'align-right', label: 'تفريغ' },
  image: { icon: 'image', label: 'صورة' },
  link: { icon: 'link', label: 'رابط' },
};

/** Filesystem-safe base name for a cached PDF (strips path-illegal characters). */
function safePdfName(title: string): string {
  const base = title.trim().replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'ملف';
  return `${base}.pdf`;
}

/**
 * Stage the PDF as a `file://` in the app's OWN cache. A downloaded copy's local
 * URI is a SAF `content://` from the system Downloads provider — neither a
 * FileProvider content URI (ACTION_VIEW) nor expo-sharing can use a foreign
 * `content://`, so it's copied out of SAF into our cache (works fully offline);
 * otherwise the remote file is downloaded into the cache. Returns null when
 * neither is possible (no local copy and no URL). iOS private files are already
 * `file://` and used as-is.
 */
async function stagePdfFile(attachment: Attachment): Promise<string | null> {
  const dir = new Directory(Paths.cache, 'pdf-open');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, safePdfName(attachment.title));
  if (dest.exists) dest.delete();

  const local = localUriForAttachment(attachment.id);
  if (local) {
    if (local.startsWith('file://')) return local; // already a plain file (iOS)
    // Android SAF content:// — stage into our cache. Prefer native copy; fall back
    // to a bytes round-trip if the provider rejects a direct copy.
    const src = new File(local);
    try {
      await src.copy(dest);
    } catch {
      dest.create();
      dest.write(await src.bytes());
    }
    return dest.uri;
  }
  if (attachment.url) {
    const file = await File.downloadFileAsync(attachment.url, dest);
    return file.uri;
  }
  return null;
}

/**
 * Open a PDF in a real reader app — the system «فتح بواسطة…» (Open with…) chooser,
 * NOT the share sheet. Android fires an ACTION_VIEW intent on a FileProvider
 * content URI (application/pdf) so PDF viewers (Acrobat, Drive, …) are offered to
 * OPEN the file; iOS uses expo-sharing (QuickLook, which shows the document). Prefers
 * a downloaded copy (offline-ok); else downloads the remote file to the cache first.
 * Falls back to the browser (Linking) if no viewer handles it or on web; tells the
 * user calmly if there's nothing to open at all.
 */
async function openPdf(attachment: Attachment): Promise<void> {
  const fileUri = isWeb ? null : await stagePdfFile(attachment);

  if (fileUri && isAndroid) {
    // ACTION_VIEW → «Open with…» chooser of apps that can VIEW a PDF.
    const contentUri = await getContentUriAsync(fileUri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: 'application/pdf',
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
    return;
  }
  if (fileUri && (await Sharing.isAvailableAsync())) {
    // iOS: QuickLook via the share sheet opens the document to read.
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: attachment.title,
    });
    return;
  }

  // No viewer path (web / staging failed) — fall back to the browser.
  if (attachment.url) {
    void Linking.openURL(attachment.url);
    return;
  }
  Alert.alert('تعذّر فتح الملف', 'لا يوجد تطبيق مناسب لفتح هذا الملف على جهازك.');
}

/**
 * Resolve the tap action: transcripts open the in-app reader; PDFs open in a
 * native reader app («Open with…», see {@link openPdf}); everything else opens
 * its URL. Async because the PDF path may download + present a share sheet — the
 * callers already fire it fire-and-forget.
 */
export async function openAttachment(attachment: Attachment, router: AppRouter): Promise<void> {
  if (attachment.type === 'transcript') {
    router.push(`/attachment/${attachment.id}` as Parameters<typeof router.push>[0]);
    return;
  }
  if (attachment.type === 'pdf') {
    try {
      await openPdf(attachment);
    } catch {
      // A failed download/share should still try the browser rather than dead-end.
      if (attachment.url) void Linking.openURL(attachment.url);
    }
    return;
  }
  if (attachment.url) void Linking.openURL(attachment.url);
}
