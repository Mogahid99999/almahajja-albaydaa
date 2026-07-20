/**
 * Offline download for section files (attachments) — the attachment façade over
 * the shared download system in `src/lib/downloads.ts`. Section files (PDF /
 * صورة / تفريغ) now save into the SAME public `<app>/<section>` folders as
 * lecture audio, tracked in the SAME manifest (keyed `att:<id>`), so a downloaded
 * file sits next to its section's lectures, plays/opens offline, and is restored
 * after a reinstall by the same folder scan (V19). A تفريغ carries inline text
 * that is written to a `.txt`. Web has no persistent FS here — these no-op.
 *
 * This module keeps the small, attachment-shaped API its callers use (the hook +
 * attachmentMeta); the heavy lifting (SAF, manifest, restore) lives in downloads.ts.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { Attachment } from '@/api/types';
import {
  downloadAttachmentFile,
  deleteAttachmentDownload,
  localUriForAttachmentEntry,
  type AttachmentDownloadInput,
  type DownloadProgressCallback,
} from '@/lib/downloads';

const isWeb = Platform.OS === 'web';

/** Whether an attachment has downloadable content (a remote file or transcript text). */
export function isDownloadable(attachment: Attachment): boolean {
  if (attachment.type === 'transcript') return !!attachment.body;
  if (attachment.type === 'pdf' || attachment.type === 'image') return !!attachment.url;
  return false;
}

/** Shape an Attachment (+ its section title) into the downloader's input. */
function toDownloadInput(
  attachment: Attachment,
  sectionTitle: string | null,
): AttachmentDownloadInput {
  return {
    id: attachment.id,
    attachmentType: attachment.type,
    title: attachment.title,
    sectionTitle,
    url: attachment.url,
    body: attachment.body,
  };
}

/** Local URI if the section file is already downloaded, else null. */
export function localUriForAttachment(id: string): string | null {
  return localUriForAttachmentEntry(id);
}

/**
 * Download (or write) a section file into its section folder; returns the local
 * URI. `sectionTitle` places it under `<app>/<section>/…` alongside that section's
 * lectures — pass the section the attachment belongs to (falls back to «دروس عامة»
 * inside the downloader when null).
 */
export async function downloadAttachment(
  attachment: Attachment,
  sectionTitle: string | null = null,
  onProgress?: DownloadProgressCallback,
): Promise<string> {
  if (isWeb) throw new Error('التحميل غير مدعوم على الويب');
  return downloadAttachmentFile(toDownloadInput(attachment, sectionTitle), onProgress);
}

/** Delete a downloaded section file and its manifest entry. */
export async function deleteAttachmentFile(id: string): Promise<void> {
  await deleteAttachmentDownload(id);
}

/**
 * One-time migration of section files downloaded under the OLD private layout
 * (<Documents>/attachments/<id>.<ext>) — those pre-date the shared manifest, so
 * without this they'd show as "not downloaded" and be orphaned. Best-effort: any
 * such file is simply deleted (its bytes are cheap to re-fetch and we have no
 * section context to place it publicly), so the row reverts to downloadable and
 * the stale private dir is cleaned up. Runs once per process.
 */
function migrateLegacyAttachmentDownloads(): void {
  if (isWeb) return;
  try {
    const legacyDir = new Directory(Paths.document, 'attachments');
    if (!legacyDir.exists) return;
    for (const entry of legacyDir.list()) {
      if (entry instanceof File) {
        try {
          entry.delete();
        } catch {
          /* ignore */
        }
      }
    }
    try {
      if (legacyDir.list().length === 0) legacyDir.delete();
    } catch {
      /* ignore */
    }
  } catch {
    /* best-effort — never block the app */
  }
}

if (!isWeb) migrateLegacyAttachmentDownloads();
