/**
 * Shared presentation + behavior for attachment types (PRD §13).
 * One place maps each type → Feather icon + Arabic label, and resolves the tap
 * action so the row, the player strip, and the admin manager stay consistent.
 */
import { Linking } from 'react-native';
import type Feather from '@expo/vector-icons/Feather';
import type { useRouter } from 'expo-router';

import type { Attachment, AttachmentType } from '@/api/types';

type FeatherName = keyof typeof Feather.glyphMap;
type AppRouter = ReturnType<typeof useRouter>;

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

/** Transcripts open the in-app reader; everything else opens its URL. */
export function openAttachment(attachment: Attachment, router: AppRouter) {
  if (attachment.type === 'transcript') {
    router.push(`/attachment/${attachment.id}` as Parameters<typeof router.push>[0]);
    return;
  }
  if (attachment.url) void Linking.openURL(attachment.url);
}
