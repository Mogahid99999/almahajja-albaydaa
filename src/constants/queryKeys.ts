import type { AttachmentOwnerRef } from '@/api/types';

/**
 * Central registry of TanStack Query keys.
 * Keeping them in one place makes targeted invalidation predictable.
 */
export const queryKeys = {
  currentUser: ['auth', 'me'] as const,

  home: ['home'] as const,
  sectionsFlat: ['sections', 'flat'] as const,
  sectionsEdit: ['sections', 'edit'] as const,
  section: (sectionId: string) => ['section', sectionId] as const,

  lecture: (lectureId: string) => ['lecture', lectureId] as const,
  lecturesByIds: (ids: string[]) => ['lectures', 'byIds', ...ids] as const,
  lectureProgress: (lectureId: string) => ['progress', 'lecture', lectureId] as const,

  // Attachments (Phase 2 · feature A)
  sectionAttachments: (sectionId: string) => ['attachments', 'section', sectionId] as const,
  lectureAttachments: (lectureId: string) => ['attachments', 'lecture', lectureId] as const,
  attachment: (id: string) => ['attachment', id] as const,
  adminAttachments: (owner: AttachmentOwnerRef) =>
    ['attachments', 'admin', owner.kind, owner.id] as const,

  // Notifications (Phase 2 · feature B)
  notifications: ['notifications', 'list'] as const,
  notificationPrefs: ['notifications', 'prefs'] as const,
  sectionFollow: (sectionId: string) => ['notifications', 'follow', sectionId] as const,

  // Journey · رحلتي العلمية (Phase 2 · feature C)
  journey: ['journey', 'summary'] as const,
  weeklyGoal: ['journey', 'goal'] as const,
  badges: ['journey', 'badges'] as const,

  // Admin
  adminLectures: ['admin', 'lectures'] as const,
  unclassified: ['admin', 'unclassified'] as const,
  sheikhs: ['sheikhs'] as const,
} as const;
