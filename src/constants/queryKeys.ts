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
  resumeCard: ['journey', 'resumeCard'] as const,
  bookmarks: ['bookmarks'] as const,
  journeyMap: ['journey', 'map'] as const,
  seriesSummary: (sectionId: string) => ['journey', 'seriesSummary', sectionId] as const,
  seriesBenefits: (sectionId: string) => ['journey', 'seriesBenefits', sectionId] as const,
  activityCalendar: (month: string) => ['journey', 'activity', month] as const,
  harvest: (range: string) => ['journey', 'harvest', range] as const,

  // Daily streak · المداومة (26.1)
  streak: ['journey', 'streak'] as const,

  // Study buddy · رفيق الدراسة (26.2)
  buddy: ['buddy', 'status'] as const,
  buddies: ['buddy', 'statuses'] as const,
  buddyGoals: ['buddy', 'goals'] as const,
  incomingBuddyGoals: ['buddy', 'goals', 'incoming'] as const,
  buddyRequests: ['buddy', 'requests'] as const,
  buddyOutgoing: ['buddy', 'outgoing'] as const,
  buddyOutgoingList: ['buddy', 'outgoing', 'list'] as const,
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
  publicQuestions: (scope: string, lectureId?: string, category?: string) =>
    ['questions', 'public', scope, lectureId ?? 'all', category ?? 'all'] as const,
  myQuestions: (scope: string, lectureId?: string, category?: string) =>
    ['questions', 'mine', scope, lectureId ?? 'all', category ?? 'all'] as const,
  questionInbox: (scope?: string, status?: string, category?: string) =>
    ['questions', 'inbox', scope ?? 'all', status ?? 'all', category ?? 'all'] as const,
  questionAnswers: (questionId: string) => ['questions', 'answers', questionId] as const,
  lectureNote: (lectureId: string) => ['notes', lectureId] as const,
  lectureBenefits: (lectureId: string) => ['benefits', lectureId] as const,
  benefitsFeed: (kind: string) => ['benefits', 'feed', kind] as const,
  lectureQuestionsFeed: ['questions', 'public', 'lecture', 'feed'] as const,
  myLectureQuestions: ['questions', 'mine', 'lecture', 'feed'] as const,
  mushafUsage: ['admin', 'mushafUsage'] as const,
  adminBenefits: (lectureId?: string) => ['admin', 'benefits', lectureId ?? 'all'] as const,
  reports: (status?: string) => ['admin', 'reports', status ?? 'all'] as const,
  feedback: (status?: string) => ['admin', 'feedback', status ?? 'all'] as const,
  myTickets: ['tickets', 'mine'] as const,
  ticketThread: (id: string) => ['tickets', 'thread', id] as const,

  // Beneficial reminders · التذكيرات النافعة (V7)
  adminBroadcasts: ['admin', 'broadcasts'] as const,
  homeBroadcasts: ['broadcasts', 'home'] as const,
  broadcast: (id: string) => ['broadcasts', id] as const,
  broadcastRecipients: (
    search: string,
    noEmail: boolean,
    notRegistered: boolean,
    gender: string | null,
  ) => ['admin', 'broadcastRecipients', search, noEmail, notRegistered, gender] as const,

  // Admin V5 (dashboard / analytics / users / settings)
  adminStats: ['admin', 'stats'] as const,
  adminAnalytics: ['admin', 'analytics'] as const,
  adminRatingsSummary: ['admin', 'ratingsSummary'] as const,
  adminRatingsList: ['admin', 'ratingsList'] as const,
  adminUsers: (search: string, registeredOnly = false, status?: string) =>
    ['admin', 'users', search, registeredOnly, status ?? null] as const,
  adminUserDetail: (userId: string) => ['admin', 'user', userId] as const,
  adminBuddies: ['admin', 'buddies'] as const,
  aboutContent: ['appContent', 'about'] as const,
  supportContact: ['appContent', 'support'] as const,
  qnaNotice: ['appContent', 'qnaNotice'] as const,
  shareContent: ['appContent', 'share'] as const,
  startHereLecture: ['appContent', 'startHere'] as const,
  adminConfig: ['admin', 'config'] as const,

  // Server-side lecture compression (V23 §6.1)
  serverTranscodeFlag: ['admin', 'serverTranscode'] as const,
  mediaJob: (jobId: string) => ['admin', 'mediaJob', jobId] as const,

  // Live audio sessions · البث المباشر (V23 P3). Root 'live' is volatile — never
  // persisted (not in PERSISTED_QUERY_ROOTS); staff participants carry real names.
  liveNow: ['live', 'now'] as const,
  liveSession: (sessionId: string) => ['live', 'session', sessionId] as const,
  liveByCode: (code: string) => ['live', 'code', code] as const,
  liveStaffParticipants: (sessionId: string) => ['live', 'staffParticipants', sessionId] as const,
  // P5: my buddies in the room (identities) + whom I already invited to it.
  liveBuddiesPresent: (sessionId: string) => ['live', 'buddiesPresent', sessionId] as const,
  liveInvited: (sessionId: string) => ['live', 'invited', sessionId] as const,
  // «التعليقات والأسئلة أثناء البث» (0147): the room's list (get_live_comments),
  // and the staff list incl. deleted ones (admin_live_comments) — under
  // ['live', 'admin', …] with the other staff live reads (useLiveAdmin liveAdminKeys.all).
  liveComments: (sessionId: string) => ['live', 'comments', sessionId] as const,

  // «الجدول الأسبوعي للدروس» (0158): ONE persisted read, refetched only when
  // app_open's schedule_version moves.
  schedule: ['schedule'] as const,
  liveAdminComments: (sessionId: string) => ['live', 'admin', 'comments', sessionId] as const,
} as const;
