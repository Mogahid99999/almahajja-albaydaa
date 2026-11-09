/**
 * Wording of the student's certificate views. Presentation only: these pin that
 * the text reflects what certificate_eligibility returned, in Arabic.
 */
import type { CertificateEligibility } from '@/api/certificates';
import {
  arQuizCount,
  certificateHasConditions,
  quizProgress,
  lectureProgress,
  lectureRequirementLine,
  quizState,
  remainingSummary,
  showsCertificateCard,
} from '@/components/certificates/certificateText';

type Over = {
  eligible?: boolean;
  lectures?: Partial<CertificateEligibility['lectures']>;
  quizzes?: Partial<CertificateEligibility['quizzes']>;
};

function make({ eligible = false, lectures, quizzes }: Over = {}): CertificateEligibility {
  return {
    sectionId: 's',
    userId: 'u',
    enabled: true,
    seriesOngoing: false,
    eligible,
    lectures: {
      scope: 'section',
      rule: 'all',
      pct: null,
      total: 10,
      completed: 4,
      required: 10,
      completedPct: 40,
      met: false,
      ...lectures,
    },
    quizzes: { rule: 'none', requiredCount: 0, passedCount: 0, met: true, items: [], ...quizzes },
  };
}

const item = (over: Partial<CertificateEligibility['quizzes']['items'][number]>) => ({
  quizId: 'q',
  title: 'اختبار',
  passed: false,
  pendingGrading: false,
  ...over,
});

test('arQuizCount follows Arabic number agreement', () => {
  expect(arQuizCount(1)).toBe('اختبار واحد');
  expect(arQuizCount(2)).toBe('اختباران');
  expect(arQuizCount(3)).toBe('٣ اختبارات');
  expect(arQuizCount(11)).toBe('١١ اختبارًا');
});

test('progress is completed ⁄ required, capped, and 0 with nothing required', () => {
  expect(lectureProgress(make())).toBeCloseTo(0.4);
  expect(lectureProgress(make({ lectures: { completed: 9, required: 7 } }))).toBe(1);
  expect(lectureProgress(make({ lectures: { total: 0, completed: 0, required: 0 } }))).toBe(0);
});

test('the requirement line names the content scope and the rule', () => {
  expect(lectureRequirementLine(make())).toBe('المطلوب إكمال جميع محاضرات هذا القسم');
  expect(lectureRequirementLine(make({ lectures: { scope: 'subtree' } }))).toBe(
    'المطلوب إكمال جميع محاضرات هذا القسم وأقسامه الفرعية',
  );
  expect(
    lectureRequirementLine(make({ lectures: { rule: 'percent', pct: 70, required: 7, total: 10 } })),
  ).toBe('المطلوب إكمال ٧٠٪ من محاضرات هذا القسم (٧ من ١٠)');
});

test('quiz states', () => {
  expect(quizState(item({ passed: true }))).toBe('passed');
  expect(quizState(item({ pendingGrading: true }))).toBe('pending');
  expect(quizState(item({}))).toBe('todo');
});

describe('remainingSummary', () => {
  test('student still progressing', () => {
    expect(remainingSummary(make({ lectures: { completed: 8 } }))).toBe('المتبقي: محاضرتان');
  });

  test('lectures done, one quiz left', () => {
    expect(
      remainingSummary(
        make({
          lectures: { completed: 10, met: true },
          quizzes: { rule: 'selected', met: false, requiredCount: 1, items: [item({})] },
        }),
      ),
    ).toBe('المتبقي: اختبار واحد');
  });

  test('quiz awaiting grading', () => {
    expect(
      remainingSummary(
        make({
          lectures: { completed: 10, met: true },
          quizzes: { rule: 'selected', met: false, requiredCount: 1, items: [item({ pendingGrading: true })] },
        }),
      ),
    ).toBe('المتبقي: اختبار واحد بانتظار التصحيح');
  });

  test('lectures and quizzes both left', () => {
    expect(
      remainingSummary(
        make({
          lectures: { completed: 9 },
          quizzes: { rule: 'selected', met: false, requiredCount: 1, items: [item({})] },
        }),
      ),
    ).toBe('المتبقي: محاضرة واحدة واختبار واحد');
  });

  test('all conditions met', () => {
    expect(remainingSummary(make({ eligible: true, lectures: { completed: 10, met: true } }))).toBe(
      'استوفيت شروط الشهادة',
    );
  });
});

describe('no lecture condition (0173)', () => {
  const quizOnly = (quizzes: Over['quizzes'], eligible = false) =>
    make({ eligible, lectures: { rule: 'none', total: 0, completed: 0, required: 0, met: true }, quizzes: { rule: 'selected', ...quizzes } });
  const item = (over = {}) => ({ quizId: 'q', title: 'اختبار', passed: false, pendingGrading: false, ...over });

  test('what is left names only the quiz, never lectures', () => {
    expect(remainingSummary(quizOnly({ requiredCount: 1, met: false, items: [item()] }))).toBe('المتبقي: اختبار واحد');
  });

  test('a written quiz awaiting grading is said as such', () => {
    expect(remainingSummary(quizOnly({ requiredCount: 1, met: false, items: [item({ pendingGrading: true })] }))).toBe('المتبقي: اختبار واحد بانتظار التصحيح');
  });

  test('has conditions only while a quiz is really required', () => {
    expect(certificateHasConditions(quizOnly({ requiredCount: 1 }))).toBe(true);
    expect(certificateHasConditions(quizOnly({ requiredCount: 0 }))).toBe(false);
    expect(certificateHasConditions(make())).toBe(true);
    expect(certificateHasConditions(make({ lectures: { total: 0 } }))).toBe(false);
  });

  test('quiz progress', () => {
    expect(quizProgress(quizOnly({ requiredCount: 2, passedCount: 1 }))).toBe(0.5);
    expect(quizProgress(quizOnly({ requiredCount: 0 }))).toBe(0);
  });
});

describe('showsCertificateCard: one card on the section page', () => {
  test('a section granting a certificate shows that card', () => {
    expect(showsCertificateCard({ hasCertificate: true, isGuest: false, eligibility: make() })).toBe(true);
    expect(showsCertificateCard({ hasCertificate: true, isGuest: true, eligibility: undefined })).toBe(true);
  });
  test('a section with no certificate of its own keeps the progress card', () => {
    expect(showsCertificateCard({ hasCertificate: false, isGuest: false, eligibility: make() })).toBe(false);
    expect(showsCertificateCard({ hasCertificate: false, isGuest: true, eligibility: undefined })).toBe(false);
  });
  test('the progress card stays until the certificate card can really be drawn', () => {
    expect(showsCertificateCard({ hasCertificate: true, isGuest: false, eligibility: undefined })).toBe(false);
    expect(showsCertificateCard({ hasCertificate: true, isGuest: false, eligibility: { ...make(), enabled: false } })).toBe(false);
    expect(showsCertificateCard({ hasCertificate: true, isGuest: false, eligibility: make({ lectures: { total: 0 } }) })).toBe(false);
  });
});

test('an ongoing section with every condition met says so, and never reads as unfinished (0176)', () => {
  const e = { ...make({ lectures: { met: true, completed: 10 }, quizzes: { met: true } }), seriesOngoing: true };
  expect(remainingSummary(e)).toBe('استوفيت الشروط الحالية');
});
