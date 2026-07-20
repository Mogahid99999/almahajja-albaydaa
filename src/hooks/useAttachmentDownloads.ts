import { useCallback, useEffect, useState } from 'react';

import type { Attachment } from '@/api/types';
import {
  deleteAttachmentFile,
  downloadAttachment,
  localUriForAttachment,
} from '@/lib/attachmentDownloads';
import { verifyAttachmentDownload } from '@/lib/downloads';

type AttachmentDownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'error';

/**
 * Per-attachment (section file) download state + actions, backed by the shared
 * download manifest (mirrors `useDownload` for lectures). Local component state is
 * enough — section files don't need the cross-screen sync lecture audio does — but
 * on mount we reconcile against the ACTUAL file: `verifyAttachmentDownload` prunes
 * the manifest entry if the file was deleted/moved outside the app, so a stale
 * "downloaded" state reopens the download (V17.1 parity for attachments).
 *
 * `sectionTitle` places the file under `<app>/<section>/…` next to that section's
 * lectures — pass it from the section page (falls back to «دروس عامة» when null).
 */
export function useAttachmentDownload(attachment: Attachment, sectionTitle: string | null = null) {
  const [status, setStatus] = useState<AttachmentDownloadStatus>('idle');

  useEffect(() => {
    let cancelled = false;
    // Reflect the local manifest immediately, then confirm the file really exists.
    setStatus(localUriForAttachment(attachment.id) ? 'downloaded' : 'idle');
    void verifyAttachmentDownload(attachment.id).then((exists) => {
      if (cancelled) return;
      setStatus(exists ? 'downloaded' : 'idle');
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.id]);

  const download = useCallback(async () => {
    setStatus('downloading');
    try {
      await downloadAttachment(attachment, sectionTitle);
      setStatus('downloaded');
    } catch {
      setStatus('error');
    }
  }, [attachment, sectionTitle]);

  const remove = useCallback(() => {
    void deleteAttachmentFile(attachment.id);
    setStatus('idle');
  }, [attachment.id]);

  return { status, download, remove };
}
