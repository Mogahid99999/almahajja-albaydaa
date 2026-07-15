/**
 * app/(auth)/reset-password.tsx — audit F-028: the OTP recovery code is
 * single-use, so the client must (1) gate the password to the server's min-8
 * BEFORE verifying, and (2) never re-verify an already-consumed code on retry.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockVerifyCode = jest.fn(async (..._a: unknown[]) => undefined);
const mockUpdatePassword = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('@/api/auth', () => ({
  verifyPasswordResetCode: (...a: unknown[]) => mockVerifyCode(...a),
  updatePassword: (...a: unknown[]) => mockUpdatePassword(...a),
}));

const mockResetRequest = { mutate: jest.fn(), isPending: false };
jest.mock('@/hooks/useAuth', () => ({
  useRequestPasswordReset: () => mockResetRequest,
}));

import ResetPasswordScreen from '../../app/(auth)/reset-password';

beforeEach(() => {
  mockResetRequest.mutate.mockImplementation((_email, cbs) => cbs.onSuccess());
  mockResetRequest.isPending = false;
  mockVerifyCode.mockImplementation(async () => undefined);
  mockUpdatePassword.mockImplementation(async () => undefined);
});

/** Request a code and land on the verify step. */
const toVerifyStep = async (api: Awaited<ReturnType<typeof render>>) => {
  await fireEvent.changeText(api.getByPlaceholderText('example@gmail.com'), 'user@test.com');
  await fireEvent.press(api.getByText('إرسال رمز الاستعادة'));
  expect(api.getByText('رمز التحقق')).toBeTruthy();
};

describe('request step', () => {
  test('send button is disabled until the email looks valid', async () => {
    const api = await render(<ResetPasswordScreen />);
    await fireEvent.changeText(api.getByPlaceholderText('example@gmail.com'), 'not-an-email');
    await fireEvent.press(api.getByText('إرسال رمز الاستعادة'));
    expect(mockResetRequest.mutate).not.toHaveBeenCalled();
  });

  test('a failed send shows the mapped Arabic error', async () => {
    mockResetRequest.mutate.mockImplementation((_email, cbs) =>
      cbs.onError(new Error('For security purposes, you can only request this once every 60 seconds')),
    );
    const api = await render(<ResetPasswordScreen />);
    await fireEvent.changeText(api.getByPlaceholderText('example@gmail.com'), 'user@test.com');
    await fireEvent.press(api.getByText('إرسال رمز الاستعادة'));
    expect(api.getByText('محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة.')).toBeTruthy();
  });
});

describe('verify step — the F-028 contract', () => {
  test('a short password is rejected BEFORE the single-use code is consumed', async () => {
    const api = await render(<ResetPasswordScreen />);
    await toVerifyStep(api);
    await fireEvent.changeText(api.getByPlaceholderText('______'), '123456');
    await fireEvent.changeText(api.getByPlaceholderText('••••••••'), 'short12'); // 7 chars
    await fireEvent.press(api.getByText('تأكيد وتغيير كلمة المرور'));
    expect(await api.findByText('كلمة المرور يجب ألا تقل عن ٨ أحرف.')).toBeTruthy();
    expect(mockVerifyCode).not.toHaveBeenCalled();
  });

  test('an incomplete code is rejected client-side', async () => {
    const api = await render(<ResetPasswordScreen />);
    await toVerifyStep(api);
    await fireEvent.changeText(api.getByPlaceholderText('______'), '123');
    await fireEvent.changeText(api.getByPlaceholderText('••••••••'), 'password123');
    await fireEvent.press(api.getByText('تأكيد وتغيير كلمة المرور'));
    expect(await api.findByText('أدخل الرمز كاملاً.')).toBeTruthy();
    expect(mockVerifyCode).not.toHaveBeenCalled();
  });

  test('happy path: verify → update → success message → redirect to sign-in', async () => {
    jest.useFakeTimers();
    const api = await render(<ResetPasswordScreen />);
    await toVerifyStep(api);
    await fireEvent.changeText(api.getByPlaceholderText('______'), '123456');
    await fireEvent.changeText(api.getByPlaceholderText('••••••••'), 'password123');
    await fireEvent.press(api.getByText('تأكيد وتغيير كلمة المرور'));
    expect(
      await api.findByText('تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.'),
    ).toBeTruthy();
    expect(mockVerifyCode).toHaveBeenCalledWith('user@test.com', '123456');
    expect(mockUpdatePassword).toHaveBeenCalledWith('password123');
    jest.advanceTimersByTime(1500);
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
    jest.useRealTimers();
  });

  test('retry after a failed password write does NOT re-verify the consumed code', async () => {
    mockUpdatePassword.mockRejectedValueOnce(new Error('Password should be at least 8 characters'));
    const api = await render(<ResetPasswordScreen />);
    await toVerifyStep(api);
    await fireEvent.changeText(api.getByPlaceholderText('______'), '123456');
    await fireEvent.changeText(api.getByPlaceholderText('••••••••'), 'weakpass'); // server still rejects
    await fireEvent.press(api.getByText('تأكيد وتغيير كلمة المرور'));
    expect(await api.findByText('كلمة المرور ضعيفة أو غير صالحة.')).toBeTruthy();
    expect(mockVerifyCode).toHaveBeenCalledTimes(1);

    // Retry with a stronger password: verify is skipped (the recovery session
    // is already live), only the password write runs again.
    await fireEvent.changeText(api.getByPlaceholderText('••••••••'), 'strongpass99');
    await fireEvent.press(api.getByText('تأكيد وتغيير كلمة المرور'));
    await waitFor(() => expect(mockUpdatePassword).toHaveBeenCalledTimes(2));
    expect(mockVerifyCode).toHaveBeenCalledTimes(1); // ← the F-028 assertion
  });

  test('re-sending a code starts a fresh verify cycle', async () => {
    mockUpdatePassword.mockRejectedValueOnce(new Error('boom'));
    const api = await render(<ResetPasswordScreen />);
    await toVerifyStep(api);
    await fireEvent.changeText(api.getByPlaceholderText('______'), '123456');
    await fireEvent.changeText(api.getByPlaceholderText('••••••••'), 'password123');
    await fireEvent.press(api.getByText('تأكيد وتغيير كلمة المرور'));
    await waitFor(() => expect(mockVerifyCode).toHaveBeenCalledTimes(1));

    await fireEvent.press(api.getByText('إعادة إرسال الرمز'));
    await fireEvent.changeText(api.getByPlaceholderText('______'), '654321');
    await fireEvent.press(api.getByText('تأكيد وتغيير كلمة المرور'));
    await waitFor(() => expect(mockVerifyCode).toHaveBeenCalledTimes(2));
    expect(mockVerifyCode).toHaveBeenLastCalledWith('user@test.com', '654321');
  });
});
