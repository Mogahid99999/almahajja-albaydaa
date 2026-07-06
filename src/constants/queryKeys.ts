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
  recentLectures: ['lectures', 'recent'] as const,
  featuredLectures: ['lectures', 'featured'] as const,
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

  // Daily streak · المداومة (26.1)
  streak: ['journey', 'streak'] as const,

  // Study buddy · رفيق الدراسة (26.2)
  buddy: ['buddy', 'status'] as const,
  buddyRequests: ['buddy', 'requests'] as const,
  buddyOutgoing: ['buddy', 'outgoing'] as const,
  buddySearch: (query: string) => ['buddy', 'search', query] as const,

  // Content search · بحث (bottom nav)
  contentSearch: (query: string) => ['search', 'content', query] as const,

  // Quizzes · الاختبارات (Feature 12)
  sectionQuizzes: (sectionId: string) => ['quizzes', 'section', sectionId] as const,
  quizIntro: (quizId: string) => ['quizzes', 'intro', quizId] as const,
  quizAttempt: (attemptId: string) => ['quizzes', 'attempt', attemptId] as const,
  quizResult: (attemptId: string) => ['quizzes', 'result', attemptId] as const,
  myQuizStats: ['quizzes', 'myStats'] as const,
  adminQuizzes: ['admin', 'quizzes'] as const,
  adminQuiz: (quizId: string) => ['admin', 'quiz', quizId] as const,
  adminQuizResults: (quizId: string) => ['admin', 'quizResults', quizId] as const,
  adminQuizAttempt: (attemptId: string) => ['admin', 'quizAttempt', attemptId] as const,

  // Admin
  adminLectures: ['admin', 'lectures'] as const,
  adminFeatured: ['admin', 'featured'] as const,
  unclassified: ['admin', 'unclassified'] as const,
  sheikhs: ['sheikhs'] as const,

  // Q&A · Notes · Benefits (V6)
  publicQuestions: (scope: string, lectureId?: string) =>
    ['questions', 'public', scope, lectureId ?? 'all'] as const,
  myQuestions: (scope: string, lectureId?: string) =>
    ['questions', 'mine', scope, lectureId ?? 'all'] as const,
  questionInbox: (scope?: string, status?: string) =>
    ['questions', 'inbox', scope ?? 'all', status ?? 'all'] as const,
  lectureNote: (lectureId: string) => ['notes', lectureId] as const,
  lectureBenefits: (lectureId: string) => ['benefits', lectureId] as const,
  adminBenefits: (lectureId?: string) => ['admin', 'benefits', lectureId ?? 'all'] as const,
  reports: (status?: string) => ['admin', 'reports', status ?? 'all'] as const,

  // Beneficial reminders · التذكيرات النافعة (V7)
  adminBroadcasts: ['admin', 'broadcasts'] as const,
  homeBroadcasts: ['broadcasts', 'home'] as const,
  broadcast: (id: string) => ['broadcasts', id] as const,

  // Admin V5 (dashboard / analytics / users / settings)
  adminStats: ['admin', 'stats'] as const,
  adminAnalytics: ['admin', 'analytics'] as const,
  adminUsers: (search: string) => ['admin', 'users', search] as const,
  adminUserDetail: (userId: string) => ['admin', 'user', userId] as const,
  aboutContent: ['appContent', 'about'] as const,
  supportContact: ['appContent', 'support'] as const,
  qnaNotice: ['appContent', 'qnaNotice'] as const,
  adminConfig: ['admin', 'config'] as const,
} as const;
