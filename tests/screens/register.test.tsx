/**
 * app/(auth)/register.tsx — phase-3 defect cluster (F-026 re-register guard,
 * F-029 min-8 password gate, F-030 Arabic error mapping, F-032 oath modal).
 *
 * iOS drops the phone + gender fields (Apple review 5.1.1(v) data-minimisation):
 * email becomes the required identifier, and gender is captured later. The
 * platform-specific behavior is pinned in the two describe blocks at the bottom;
 * the shared guards/validation run under the Android form (phone + gender).
 */
import { Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    useRouter: () => mockRouter,
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
  };
});

type UserShape = { isGuest: boolean } | undefined;
const mockAuth: {
  user: UserShape;
  register: {
    mutate: jest.Mock;
    isPending: boolean;
    isSuccess: boolean;
    isError: boolean;
    error: Error | null;
  };
} = {
  user: undefined,
  register: { mutate: jest.fn(), isPending: false, isSuccess: false, isError: false, error: null },
};

jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({ data: mockAuth.user }),
  useRegister: () => mockAuth.register,
}));

import RegisterScreen from '../../app/(auth)/register';

// jest-expo defaults Platform.OS to 'ios'. Most shared tests exercise the
// Android form (phone + inline gender), so restore it around each test and let
// the iOS-specific block flip it explicitly.
const realOS = Platform.OS;
beforeEach(() => {
  (Platform as { OS: string }).OS = 'android';
  mockAuth.user = { isGuest: true };
  mockAuth.register = {
    mutate: jest.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  };
});
afterAll(() => {
  (Platform as { OS: string }).OS = realOS;
});

const fillValidForm = async (api: Awaited<ReturnType<typeof render>>) => {
  await fireEvent.changeText(api.getByPlaceholderText('اسمك'), 'محمد');
  await fireEvent.changeText(api.getByPlaceholderText('9xxxxxxxx'), '0912345678');
  await fireEvent.changeText(api.getByPlaceholderText('8 أحرف أو ارقام على الأقل'), 'password123');
  await fireEvent.changeText(api.getByPlaceholderText('أعد إدخال كلمة المرور'), 'password123');
};

describe('re-register guard (F-026)', () => {
  test('an already-registered session is redirected home — the form never renders', async () => {
    mockAuth.user = { isGuest: false };
    const { getByTestId, queryByPlaceholderText } = await render(<RegisterScreen />);
    expect(getByTestId('redirect').props.children).toBe('/');
    expect(queryByPlaceholderText('اسمك')).toBeNull();
  });

  test('the guard stays inert mid-mutation so it cannot race the success redirect', async () => {
    mockAuth.user = { isGuest: false };
    mockAuth.register.isSuccess = true; // the just-registered session flips isGuest
    const { queryByTestId } = await render(<RegisterScreen />);
    expect(queryByTestId('redirect')).toBeNull();
  });

  test('guests (and pre-session boot) see the form', async () => {
    const { getByPlaceholderText } = await render(<RegisterScreen />);
    expect(getByPlaceholderText('اسمك')).toBeTruthy();
  });
});

describe('client validation (F-029)', () => {
  test('a 7-char password shows the inline Arabic error and blocks submit', async () => {
    const api = await render(<RegisterScreen />);
    await fillValidForm(api);
    await fireEvent.changeText(api.getByPlaceholderText('8 أحرف أو ارقام على الأقل'), 'short12');
    await fireEvent.changeText(api.getByPlaceholderText('أعد إدخال كلمة المرور'), 'short12');
    expect(api.getByText('كلمة المرور يجب ألا تقل عن ٨ أحرف أو أرقام')).toBeTruthy();
    await fireEvent.press(api.getByText('إنشاء الحساب'));
    expect(api.queryByText('تأكيد البيانات')).toBeNull(); // oath sheet never opened
  });

  test('mismatched confirmation shows its error', async () => {
    const api = await render(<RegisterScreen />);
    await fillValidForm(api);
    await fireEvent.changeText(api.getByPlaceholderText('أعد إدخال كلمة المرور'), 'different123');
    expect(api.getByText('كلمتا المرور غير متطابقتين')).toBeTruthy();
  });

  test('submitting without a gender selection shows the gender error, not the oath', async () => {
    const api = await render(<RegisterScreen />);
    await fillValidForm(api);
    await fireEvent.press(api.getByText('إنشاء الحساب'));
    expect(api.getByText('يرجى تحديد الجنس')).toBeTruthy();
    expect(mockAuth.register.mutate).not.toHaveBeenCalled();
  });
});

describe('oath sheet (F-032) and submission', () => {
  test('registration fires only after the oath checkbox is confirmed', async () => {
    const api = await render(<RegisterScreen />);
    await fillValidForm(api);
    await fireEvent.press(api.getByText('أنثى'));
    await fireEvent.press(api.getByText('إنشاء الحساب'));
    expect(api.getByText('تأكيد البيانات')).toBeTruthy();

    // متابعة without the checkbox does nothing.
    await fireEvent.press(api.getByText('متابعة'));
    expect(mockAuth.register.mutate).not.toHaveBeenCalled();

    await fireEvent.press(api.getByText('أقسم بالله أن هذه البيانات صحيحة'));
    await fireEvent.press(api.getByText('متابعة'));
    expect(mockAuth.register.mutate).toHaveBeenCalledWith(
      {
        name: 'محمد',
        phone: '0912345678',
        countryCode: '249',
        email: '',
        password: 'password123',
        gender: 'female',
      },
      expect.anything(),
    );
  });

  test('«رجوع» closes the oath sheet and clears the checkbox', async () => {
    const api = await render(<RegisterScreen />);
    await fillValidForm(api);
    await fireEvent.press(api.getByText('ذكر'));
    await fireEvent.press(api.getByText('إنشاء الحساب'));
    await fireEvent.press(api.getByText('أقسم بالله أن هذه البيانات صحيحة'));
    await fireEvent.press(api.getByText('رجوع'));
    // Reopen: checkbox must be unchecked again → متابعة inert.
    await fireEvent.press(api.getByText('إنشاء الحساب'));
    await fireEvent.press(api.getByText('متابعة'));
    expect(mockAuth.register.mutate).not.toHaveBeenCalled();
  });
});

describe('server error surfacing (F-030)', () => {
  test('a raw English GoTrue error renders as calm Arabic', async () => {
    mockAuth.register.isError = true;
    mockAuth.register.error = new Error('User already registered');
    const { getByText, queryByText } = await render(<RegisterScreen />);
    expect(getByText('هذا البريد أو الرقم مستخدم في حساب آخر.')).toBeTruthy();
    expect(queryByText(/already registered/i)).toBeNull();
  });
});

// ── iOS data-minimisation (Apple 5.1.1(v)) ──────────────────────────────────
describe('iOS registration — no phone, no gender, email required', () => {
  beforeEach(() => {
    (Platform as { OS: string }).OS = 'ios';
  });

  test('the phone and gender fields are not rendered', async () => {
    const api = await render(<RegisterScreen />);
    expect(api.queryByPlaceholderText('9xxxxxxxx')).toBeNull(); // no phone field
    expect(api.queryByText('النوع')).toBeNull(); // no gender field label
    // Email is required, so its label loses the "(اختياري)" suffix.
    expect(api.getByText('البريد الإلكتروني')).toBeTruthy();
    expect(api.queryByText('البريد الإلكتروني (اختياري)')).toBeNull();
  });

  test('submit stays blocked until a valid email is entered', async () => {
    const api = await render(<RegisterScreen />);
    await fireEvent.changeText(api.getByPlaceholderText('اسمك'), 'محمد');
    await fireEvent.changeText(api.getByPlaceholderText('8 أحرف أو ارقام على الأقل'), 'password123');
    await fireEvent.changeText(api.getByPlaceholderText('أعد إدخال كلمة المرور'), 'password123');
    // No email yet → the oath sheet must not open.
    await fireEvent.press(api.getByText('إنشاء الحساب'));
    expect(api.queryByText('تأكيد البيانات')).toBeNull();
  });

  test('a valid email registers with no phone and a null gender', async () => {
    const api = await render(<RegisterScreen />);
    await fireEvent.changeText(api.getByPlaceholderText('اسمك'), 'محمد');
    await fireEvent.changeText(api.getByPlaceholderText('example@gmail.com'), 'm@example.com');
    await fireEvent.changeText(api.getByPlaceholderText('8 أحرف أو ارقام على الأقل'), 'password123');
    await fireEvent.changeText(api.getByPlaceholderText('أعد إدخال كلمة المرور'), 'password123');
    // No gender step on iOS — the oath opens straight away.
    await fireEvent.press(api.getByText('إنشاء الحساب'));
    expect(api.getByText('تأكيد البيانات')).toBeTruthy();
    await fireEvent.press(api.getByText('أقسم بالله أن هذه البيانات صحيحة'));
    await fireEvent.press(api.getByText('متابعة'));
    expect(mockAuth.register.mutate).toHaveBeenCalledWith(
      {
        name: 'محمد',
        phone: '',
        countryCode: '249',
        email: 'm@example.com',
        password: 'password123',
        gender: null,
      },
      expect.anything(),
    );
  });
});
