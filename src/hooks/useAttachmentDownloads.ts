import { useCallback, useEffect, useState } from 'react';

import type { Attachment } from '@/api/types';
import {
  deleteAttachmentFile,
  downloadAttachment,
  localUriForAttachment,
} from '@/lib/attachmentDownloads';

type AttachmentDownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'error';

/**
 * Per-attachment download state + actions, backed by the filesystem (mirrors
 * `useDownload` for lectures). Local component state is enough: attachment
 * downloads don't need the cross-screen sync lecture audio does, so on mount we
 * just reconcile against what's on disk.
 */
export function useAttachmentDownload(attachment: Attachment) {
  const [status, setStatus] = useState<AttachmentDownloadStatus>('idle');

  useEffect(() => {
    const uri = localUriForAttachment(attachment.id, attachment.type);
    setStatus(uri ? 'downloaded' : 'idle');
  }, [attachment.id, attachment.type]);

  const download = useCallback(async () => {
    setStatus('downloading');
    try {
      await downloadAttachment(attachment);
      setStatus('downloaded');
    } catch {
      setStatus('error');
    }
  }, [attachment]);

  const remove = useCallback(() => {
    deleteAttachmentFile(attachment.id, attachment.type);
    setStatus('idle');
  }, [attachment.id, attachment.type]);

  return { status, download, remove };
}
