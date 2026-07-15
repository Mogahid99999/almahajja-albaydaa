/**
 * app/(student)/edit-profile.tsx — phase-3 cluster (F-029 min-8 password gate,
 * two-step email change, locked name/gender, F-030 Arabic error surfacing).
 */
import { fireEvent, render } from '@testing-library/react-native';

const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/hooks/useMiniPlayerPad', () => ({ useMiniPlayerPad: () => 0 }));

type Mutation = { mutate: jest.Mock; isPending: boolean };
const mkMutation = (): Mutation => ({ mutate: jest.fn(), isPending: false });

const mockAuth = {
  user: {
    displayName: 'محمد',
    gender: 'male' as const,
    email: 'old@test.com',
    phone: '0911111111',
  },
  requestEmailChange: mkMutation(),
  verifyEmailChange: mkMutation(),
  changePassword: mkMutation(),
  changePhone: mkMutation(),
};

jest.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({ data: mockAuth.user }),
  useRequestEmailChange: () => mockAuth.requestEmailChange,
  useVerifyEmailChange: () => mockAuth.verifyEmailChange,
  useChangePassword: () => mockAuth.changePassword,
  useChangePhone: () => mockAuth.changePhone,
}));

import EditProfileScreen from '../../app/(student)/edit-profile';

beforeEach(() => {
  mockAuth.requestEmailChange = mkMutation();
  mockAuth.verifyEmailChange = mkMutation();
  mockAuth.changePassword = mkMutation();
  mockAuth.changePhone = mkMutation();
});

describe('oath-locked identity', () => {
  test('name and gender render read-only with the explanation line', async () => {
    const { getByText, queryByDisplayValue } = await render(<EditProfileScreen />);
    expect(getByText('محمد')).toBeTruthy();
    expect(getByText('ذكر')).toBeTruthy();
    expect(getByText('لا يمكن تعديل الاسم أو الجنس من هنا — تواصل مع الإدارة عند الحاجة')).toBeTruthy();
    expect(queryByDisplayValue('محمد')).toBeNull(); // not an editable input
  });
});

describe('password change (F-029)', () => {
  const openPassword = async (api: Awaited<ReturnType<typeof render>>) => {
    await fireEvent.press(api.getByText('كلمة المرور'));
  };

  test('a 7-char new password keeps save inert (server min is 8)', async () => {
    const api = await render(<EditProfileScreen />);
    await openPassword(api);
    await fireEvent.changeText(api.getByPlaceholderText('كلمة المرور الحالية'), 'current-pass');
    await fireEvent.changeText(api.getByPlaceholderText('كلمة المرور الجديدة (٨ أحرف على الأقل)'), 'short12');
    await fireEvent.changeText(api.getByPlaceholderText('أعد كتابة كلمة المرور الجديدة'), 'short12');
    await fireEvent.press(api.getByText('تغيير كلمة المرور', { exact: true }));
    expect(mockAuth.changePassword.mutate).not.toHaveBeenCalled();
  });

  test('mismatched confirmation shows the inline error and blocks save', async () => {
    const api = await render(<EditProfileScreen />);
    await openPassword(api);
    await fireEvent.changeText(api.getByPlaceholderText('كلمة المرور الحالية'), 'current-pass');
    await fireEvent.changeText(api.getByPlaceholderText('كلمة المرور الجديدة (٨ أحرف على الأقل)'), 'newpass123');
    await fireEvent.changeText(api.getByPlaceholderText('أعد كتابة كلمة المرور الجديدة'), 'different1');
    expect(api.getByText('كلمتا المرور غير متطابقتين')).toBeTruthy();
    await fireEvent.press(api.getByText('تغيير كلمة المرور', { exact: true }));
    expect(mockAuth.changePassword.mutate).not.toHaveBeenCalled();
  });

  test('a valid change reaches the server with current+new and success clears the form', async () => {
    mockAuth.changePassword.mutate.mockImplementation((_vars, cbs) => cbs.onSuccess());
    const api = await render(<EditProfileScreen />);
    await openPassword(api);
    await fireEvent.changeText(api.getByPlaceholderText('كلمة المرور الحالية'), 'current-pass');
    await fireEvent.changeText(api.getByPlaceholderText('كلمة المرور الجديدة (٨ أحرف على الأقل)'), 'newpass123');
    await fireEvent.changeText(api.getByPlaceholderText('أعد كتابة كلمة المرور الجديدة'), 'newpass123');
    await fireEvent.press(api.getByText('تغيير كلمة المرور', { exact: true }));
    expect(mockAuth.changePassword.mutate).toHaveBeenCalledWith(
      { currentPassword: 'current-pass', newPassword: 'newpass123' },
      expect.anything(),
    );
    expect(api.getByText('تم تغيير كلمة المرور بنجاح')).toBeTruthy();
  });

  test('a server rejection surfaces as Arabic (F-030)', async () => {
    mockAuth.changePassword.mutate.mockImplementation((_vars, cbs) =>
      cbs.onError(new Error('Invalid login credentials')),
    );
    const api = await render(<EditProfileScreen />);
    await openPassword(api);
    await fireEvent.changeText(api.getByPlaceholderText('كلمة المرور الحالية'), 'wrong-pass');
    await fireEvent.changeText(api.getByPlaceholderText('كلمة المرور الجديدة (٨ أحرف على الأقل)'), 'newpass123');
    await fireEvent.changeText(api.getByPlaceholderText('أعد كتابة كلمة المرور الجديدة'), 'newpass123');
    await fireEvent.press(api.getByText('تغيير كلمة المرور', { exact: true }));
    expect(
      api.getByText('البريد الإلكتروني أو رقم الهاتف أو كلمة المرور غير صحيحة'),
    ).toBeTruthy();
  });
});

describe('two-step email change', () => {
  const openEmail = async (api: Awaited<ReturnType<typeof render>>) => {
    await fireEvent.press(api.getByText('البريد الإلكتروني'));
  };

  test('an unchanged or invalid address keeps the send button inert', async () => {
    const api = await render(<EditProfileScreen />);
    await openEmail(api);
    // unchanged (prefilled with the current email)
    await fireEvent.press(api.getByText('إرسال رمز التأكيد'));
    expect(mockAuth.requestEmailChange.mutate).not.toHaveBeenCalled();
    // invalid
    await fireEvent.changeText(api.getByPlaceholderText('example@gmail.com'), 'not-an-email');
    expect(api.getByText('أدخل بريدًا إلكترونيًا صحيحًا')).toBeTruthy();
    await fireEvent.press(api.getByText('إرسال رمز التأكيد'));
    expect(mockAuth.requestEmailChange.mutate).not.toHaveBeenCalled();
  });

  test('sending a code moves to the verify step; confirming completes the change', async () => {
    mockAuth.requestEmailChange.mutate.mockImplementation((_email, cbs) => cbs.onSuccess());
    mockAuth.verifyEmailChange.mutate.mockImplementation((_vars, cbs) => cbs.onSuccess());
    const api = await render(<EditProfileScreen />);
    await openEmail(api);
    await fireEvent.changeText(api.getByPlaceholderText('example@gmail.com'), 'new@test.com');
    await fireEvent.press(api.getByText('إرسال رمز التأكيد'));
    expect(mockAuth.requestEmailChange.mutate).toHaveBeenCalledWith(
      'new@test.com',
      expect.anything(),
    );

    // Verify step: code input appears; a short code keeps confirm inert.
    await fireEvent.changeText(api.getByPlaceholderText('______'), '123');
    await fireEvent.press(api.getByText('تأكيد الرمز'));
    expect(mockAuth.verifyEmailChange.mutate).not.toHaveBeenCalled();

    await fireEvent.changeText(api.getByPlaceholderText('______'), '123456');
    await fireEvent.press(api.getByText('تأكيد الرمز'));
    expect(mockAuth.verifyEmailChange.mutate).toHaveBeenCalledWith(
      { email: 'new@test.com', code: '123456' },
      expect.anything(),
    );
    expect(api.getByText('تم تحديث البريد الإلكتروني بنجاح')).toBeTruthy();
  });
});

describe('instant phone change', () => {
  test('save stays inert until the number differs and has ≥8 digits', async () => {
    const api = await render(<EditProfileScreen />);
    await fireEvent.press(api.getByText('رقم الهاتف'));
    // unchanged number
    await fireEvent.press(api.getByText('حفظ رقم الهاتف'));
    expect(mockAuth.changePhone.mutate).not.toHaveBeenCalled();
    // too short
    await fireEvent.changeText(api.getByPlaceholderText('09xxxxxxxx'), '0912');
    await fireEvent.press(api.getByText('حفظ رقم الهاتف'));
    expect(mockAuth.changePhone.mutate).not.toHaveBeenCalled();
    // valid: digits are stripped of separators before the save
    await fireEvent.changeText(api.getByPlaceholderText('09xxxxxxxx'), '091-222-3344');
    await fireEvent.press(api.getByText('حفظ رقم الهاتف'));
    expect(mockAuth.changePhone.mutate).toHaveBeenCalledWith('0912223344', expect.anything());
  });
});
