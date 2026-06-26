/**
 * Central registry of TanStack Query keys.
 * Keeping them in one place makes targeted invalidation predictable.
 */
export const queryKeys = {
  currentUser: ['auth', 'me'] as const,

  home: ['home'] as const,
  sectionsFlat: ['sections', 'flat'] as const,
  section: (sectionId: string) => ['section', sectionId] as const,

  lecture: (lectureId: string) => ['lecture', lectureId] as const,
  lecturesByIds: (ids: string[]) => ['lectures', 'byIds', ...ids] as const,
  lectureProgress: (lectureId: string) => ['progress', 'lecture', lectureId] as const,

  // Admin
  adminLectures: ['admin', 'lectures'] as const,
  unclassified: ['admin', 'unclassified'] as const,
  sheikhs: ['sheikhs'] as const,
} as const;
