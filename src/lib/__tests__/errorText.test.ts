/**
 * src/lib/errorText.ts (audit F-054) + src/lib/authErrors.ts (audit F-030) —
 * the two seams that keep raw English server errors off Arabic-first screens.
 */
import { arabicAuthError } from '../authErrors';
import { arabicOr } from '../errorText';

describe('arabicOr', () => {
  const FALLBACK = 'تعذّر الاتصال';

  test("the server's own Arabic reason passes through verbatim", () => {
    expect(arabicOr(new Error('انتهى وقت الاختبار'), FALLBACK)).toBe('انتهى وقت الاختبار');
    expect(arabicOr('المحاولة غير موجودة', FALLBACK)).toBe('المحاولة غير موجودة');
  });

  test('English PostgREST/network noise falls back to the calm Arabic line', () => {
    expect(
      arabicOr(new Error('duplicate key value violates unique constraint'), FALLBACK),
    ).toBe(FALLBACK);
    expect(arabicOr(new Error('Network request failed'), FALLBACK)).toBe(FALLBACK);
  });

  test('a supabase RPC error — a PLAIN object, not an Error — still surfaces its Arabic reason (0125)', () => {
    // Exactly what supabase.rpc('ask_question') rejected a just-registered
    // student with: postgrest-js parses the body into an object, it never
    // constructs an Error. The screen used to show only «تعذّر إرسال السؤال».
    const rpcError = {
      code: 'P0001',
      details: null,
      hint: null,
      message: 'يلزم إنشاء حساب لطرح سؤال',
    };
    expect(arabicOr(rpcError, 'تعذّر إرسال السؤال')).toBe('يلزم إنشاء حساب لطرح سؤال');
  });

  test('a plain RPC error with an English message still falls back — no plumbing leaks', () => {
    const rpcError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    expect(arabicOr(rpcError, FALLBACK)).toBe(FALLBACK);
  });

  test('non-Error garbage (null, objects, empty) falls back', () => {
    expect(arabicOr(null, FALLBACK)).toBe(FALLBACK);
    expect(arabicOr({ code: 500 }, FALLBACK)).toBe(FALLBACK);
    expect(arabicOr('', FALLBACK)).toBe(FALLBACK);
  });
});

describe('arabicAuthError', () => {
  test('already-Arabic messages (client validation, auth timeout) pass through', () => {
    expect(arabicAuthError(new Error('انتهت مهلة الاتصال'))).toBe('انتهت مهلة الاتصال');
  });

  test('maps the common GoTrue strings', () => {
    expect(arabicAuthError(new Error('Invalid login credentials'))).toBe(
      'البريد الإلكتروني أو رقم الهاتف أو كلمة المرور غير صحيحة',
    );
    expect(arabicAuthError(new Error('User already registered'))).toBe(
      'هذا البريد أو الرقم مستخدم في حساب آخر.',
    );
    expect(arabicAuthError(new Error('Email not confirmed'))).toBe(
      'يرجى تأكيد بريدك الإلكتروني أولاً',
    );
    expect(arabicAuthError(new Error('Token has expired or is invalid'))).toBe(
      'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً.',
    );
    expect(arabicAuthError(new Error('For security purposes, you can only request this once every 60 seconds'))).toBe(
      'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة.',
    );
    expect(arabicAuthError(new Error('Password should be at least 8 characters'))).toBe(
      'كلمة المرور ضعيفة أو غير صالحة.',
    );
    expect(arabicAuthError(new Error('Unable to validate email address: invalid format'))).toBe(
      'بريد إلكتروني غير صالح.',
    );
    expect(arabicAuthError(new Error('Network request failed'))).toBe(
      'تعذّر الاتصال بالخادم، تحقّق من اتصالك وحاول مرة أخرى.',
    );
  });

  test('anything unmapped gets the calm generic fallback — never raw English', () => {
    const out = arabicAuthError(new Error('Some brand new GoTrue error'));
    expect(out).toBe('تعذّر إتمام العملية، حاول مرة أخرى.');
    expect(arabicAuthError(undefined)).toBe('تعذّر إتمام العملية، حاول مرة أخرى.');
  });
});
