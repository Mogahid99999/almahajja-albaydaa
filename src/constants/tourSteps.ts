import { Feather } from '@expo/vector-icons';

/**
 * The 5 fixed stops of the first-time tour (TourCard). Deliberately capped and
 * non-generic — not a step-sequencing engine, just an ordered list.
 */
export type TourCtx = { sectionId: string | null; lectureId: string | null };

export type TourStep = {
  id: 'home' | 'section' | 'player' | 'buddy' | 'questions';
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  /** Resolves this step's route, or null when it can't be shown (e.g. no lectures yet) — TourCard skips it. */
  route: (ctx: TourCtx) => string | null;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'home',
    icon: 'home',
    title: 'الرئيسية',
    body: 'من هنا تكمل من حيث توقفت، وتتصفح أحدث الدروس والأقسام العلمية.',
    route: () => '/',
  },
  {
    id: 'section',
    icon: 'book-open',
    title: 'الأقسام العلمية',
    body: 'كل قسم يحوي محاضراته مرتبة بالتسلسل المناسب للدراسة.',
    route: (ctx) => (ctx.sectionId ? `/section/${ctx.sectionId}` : null),
  },
  {
    id: 'player',
    icon: 'play-circle',
    title: 'مشغل الدرس',
    body: 'شغّل الدرس، تحكّم بالسرعة، وحمّله للاستماع بدون إنترنت.',
    route: (ctx) => (ctx.lectureId ? `/player/${ctx.lectureId}` : null),
  },
  {
    id: 'buddy',
    icon: 'users',
    title: 'رفيق الدراسة',
    body: 'اختر رفيقًا يشجعك ويتابع معك رحلتك العلمية.',
    route: () => '/buddy-search',
  },
  {
    id: 'questions',
    icon: 'help-circle',
    title: 'ساحة الأسئلة',
    body: 'اطرح سؤالك أثناء الدراسة واطّلع على إجابات المشايخ.',
    route: () => '/questions',
  },
];
