/**
 * Certificates phase 2 — what the student sees (0168/0169), mocked at the hook
 * seam. Asserts Arabic copy: no certificate → nothing; progress for both content
 * scopes; lectures done with a quiz left; «بانتظار التصحيح»; earned; guests; and
 * the two groups of «شهاداتي».
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CertificateEligibility, MyCertificate } from '@/api/certificates';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

const mockEligibility: { current: CertificateEligibility | undefined } = { current: undefined };
const mockList: { current: MyCertificate[] | undefined; error: boolean } = { current: undefined, error: false };
jest.mock('@/hooks/useCertificates', () => ({
  useCertificateEligibility: () => ({ data: mockEligibility.current }),
  useMyCertificates: () => ({
    data: mockList.current,
    isLoading: false,
    isError: mockList.error,
    refetch: jest.fn(),
  }),
}));

const mockUser: { current: { isGuest: boolean } } = { current: { isGuest: false } };
jest.mock('@/hooks/useAuth', () => ({ useCurrentUser: () => ({ data: mockUser.current }) }));
jest.mock('@/hooks/useMiniPlayerPad', () => ({ useMiniPlayerPad: () => 0 }));
jest.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
}));
jest.mock('@/components/navigation/BottomNavBar', () => ({ BOTTOM_NAV_CLEARANCE: 0 }));

import CertificatesScreen from '../../app/(student)/certificates';
import {
  CertificateProgressCard,
  CertificateProgressView,
} from '@/components/certificates/CertificateProgressCard';
import { CertificateTag } from '@/components/certificates/CertificateTag';

type Over = {
  enabled?: boolean;
  eligible?: boolean;
  lectures?: Partial<CertificateEligibility['lectures']>;
  quizzes?: Partial<CertificateEligibility['quizzes']>;
};

function make({ enabled = true, eligible = false, lectures, quizzes }: Over = {}): CertificateEligibility {
  return {
    sectionId: 's',
    userId: 'u',
    enabled,
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

const row = (sectionId: string, title: string, e: CertificateEligibility, parentTitle: string | null = null) => ({
  sectionId,
  title,
  parentTitle,
  ancestorIds: [],
  eligibility: e,
});

beforeEach(() => {
  mockPush.mockClear();
  mockEligibility.current = undefined;
  mockList.current = undefined;
  mockList.error = false;
  mockUser.current = { isGuest: false };
});

describe('section page card', () => {
  test('a section without a certificate shows nothing', async () => {
    mockEligibility.current = make({ enabled: false });
    await render(<CertificateProgressCard sectionId="s" isGuest={false} />);
    expect(screen.queryByText('شهادة إتمام')).toBeNull();
  });

  test('a certificate with no lecture for this student shows nothing', async () => {
    mockEligibility.current = make({ lectures: { total: 0, completed: 0, required: 0 } });
    await render(<CertificateProgressCard sectionId="s" isGuest={false} />);
    expect(screen.queryByText('شهادة إتمام')).toBeNull();
  });

  test('«هذا القسم فقط»: student still progressing', async () => {
    await render(<CertificateProgressView e={make()} />);
    expect(screen.getByText('شهادة إتمام')).toBeTruthy();
    expect(screen.getByText('٤ من ١٠ · ٤٠٪')).toBeTruthy();
    expect(screen.getByText('المطلوب إكمال جميع محاضرات هذا القسم')).toBeTruthy();
    expect(screen.getByText('المتبقي: ٦ محاضرات')).toBeTruthy();
  });

  test('the sub-sections scope with a percentage shows the numbers of the calculation', async () => {
    await render(
      <CertificateProgressView
        e={make({ lectures: { scope: 'subtree', rule: 'percent', pct: 70, total: 12, required: 9, completed: 6 } })}
      />,
    );
    expect(screen.getByText('٦ من ٩ · ٦٧٪')).toBeTruthy();
    expect(screen.getByText('المطلوب إكمال ٧٠٪ من محاضرات هذا القسم وأقسامه الفرعية (٩ من ١٢)')).toBeTruthy();
    expect(screen.getByText('المتبقي: ٣ محاضرات')).toBeTruthy();
  });

  test('lectures done, a quiz left: each quiz with its state, tapping opens it', async () => {
    await render(
      <CertificateProgressView
        e={make({
          lectures: { completed: 10, met: true, completedPct: 100 },
          quizzes: {
            rule: 'selected',
            requiredCount: 2,
            passedCount: 1,
            met: false,
            items: [
              { quizId: 'q1', title: 'اختبار الباب الأول', passed: true, pendingGrading: false },
              { quizId: 'q2', title: 'اختبار الباب الثاني', passed: false, pendingGrading: false },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText('الاختبارات المطلوبة — ١ من ٢')).toBeTruthy();
    expect(screen.getByText('اجتزته')).toBeTruthy();
    expect(screen.getByText('لم تجتزه بعد')).toBeTruthy();
    expect(screen.getByText('المتبقي: اختبار واحد')).toBeTruthy();
    await fireEvent.press(screen.getByText('اختبار الباب الثاني'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/quiz/[id]', params: { id: 'q2' } });
  });

  test('a quiz awaiting grading is not a pass', async () => {
    await render(
      <CertificateProgressView
        e={make({
          lectures: { completed: 10, met: true },
          quizzes: {
            rule: 'selected',
            requiredCount: 1,
            passedCount: 0,
            met: false,
            items: [{ quizId: 'q1', title: 'اختبار كتابي', passed: false, pendingGrading: true }],
          },
        })}
      />,
    );
    expect(screen.getByText('بانتظار التصحيح')).toBeTruthy();
    expect(screen.getByText('المتبقي: اختبار واحد بانتظار التصحيح')).toBeTruthy();
    expect(screen.queryByText('مستحقة')).toBeNull();
  });

  test('all conditions met: «مستحقة», no PDF or issuing action', async () => {
    await render(
      <CertificateProgressView e={make({ eligible: true, lectures: { completed: 10, met: true, completedPct: 100 } })} />,
    );
    expect(screen.getByText('مستحقة')).toBeTruthy();
    expect(screen.getByText('استوفيت شروط الشهادة')).toBeTruthy();
    expect(screen.getByText('سيُتاح إصدار الشهادة قريبًا بإذن الله')).toBeTruthy();
  });

  test('a guest is invited to register', async () => {
    await render(<CertificateProgressCard sectionId="s" isGuest />);
    expect(screen.getByText('يمنح هذا القسم شهادة إتمام. أنشئ حسابًا لتتابع تقدّمك نحوها وتُحفظ لك.')).toBeTruthy();
  });

  test('the tag: words on the section page, icon with a spoken label on cards', async () => {
    await render(<CertificateTag />);
    expect(screen.getByText('شهادة إتمام')).toBeTruthy();
    await render(<CertificateTag size="sm" />);
    expect(screen.getByLabelText('في هذا القسم شهادة إتمام')).toBeTruthy();
  });
});

describe('«شهاداتي» screen', () => {
  test('the two groups, with compact progress; a row opens its section', async () => {
    mockList.current = [
      row('a', 'كتاب التوحيد', make({ eligible: true, lectures: { completed: 10, met: true } }), 'العقيدة'),
      row('b', 'الأصول الثلاثة', make({ lectures: { completed: 5 } })),
    ];
    await render(<CertificatesScreen />);
    expect(screen.getAllByText('شهاداتي').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('قيد الإنجاز')).toBeTruthy();
    expect(screen.getByText('كتاب التوحيد')).toBeTruthy();
    expect(screen.getByText('العقيدة')).toBeTruthy();
    expect(screen.getByText('مستحقة — سيُتاح إصدارها قريبًا بإذن الله')).toBeTruthy();
    expect(screen.getByText('الأصول الثلاثة')).toBeTruthy();
    expect(screen.getByText('المحاضرات ٥٠٪')).toBeTruthy();
    expect(screen.getByText('المتبقي: ٥ محاضرات')).toBeTruthy();
    await fireEvent.press(screen.getByText('الأصول الثلاثة'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/section/[id]', params: { id: 'b' } });
  });

  test('nothing earned yet', async () => {
    mockList.current = [row('b', 'الأصول الثلاثة', make())];
    await render(<CertificatesScreen />);
    expect(screen.getByText('لم تستحق شهادة بعد. أكمل متطلبات أحد الأقسام أدناه وستظهر هنا.')).toBeTruthy();
  });

  test('no certificate section at all', async () => {
    mockList.current = [];
    await render(<CertificatesScreen />);
    expect(screen.getByText('لا توجد أقسام تمنح شهادة حاليًا')).toBeTruthy();
    expect(screen.queryByText('قيد الإنجاز')).toBeNull();
  });

  test('a load failure is said calmly', async () => {
    mockList.error = true;
    await render(<CertificatesScreen />);
    expect(screen.getByText('تعذّر تحميل الشهادات الآن. اسحب للأسفل لإعادة المحاولة.')).toBeTruthy();
  });

  test('guests get the account invitation', async () => {
    mockUser.current = { isGuest: true };
    await render(<CertificatesScreen />);
    expect(screen.getByText('سجّل لتحصل على شهاداتك')).toBeTruthy();
  });
});
