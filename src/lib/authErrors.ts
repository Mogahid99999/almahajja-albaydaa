/**
 * Shared Supabase-auth → Arabic error mapping (audit phase 3).
 *
 * Every auth surface (sign-in, register, reset-password, edit-profile) needs
 * the same translation of GoTrue's English error strings; before this module
 * each screen kept its own partial copy — register.tsx had NONE and rendered
 * raw English ("User already registered") on an Arabic-first screen, and the
 * other screens' fallbacks leaked unmapped English messages verbatim.
 *
 * Messages that are ALREADY Arabic (e.g. `withAuthTimeout`'s timeout text in
 * src/api/auth.ts, or client-side validation strings) pass through untouched;
 * anything unrecognized falls back to a calm generic Arabic line instead of
 * leaking English.
 */
export function arabicAuthError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  if (/[؀-ۿ]/.test(raw)) return raw;
  const m = raw.toLowerCase();
  if (m.includes('invalid login credentials'))
    return 'البريد الإلكتروني أو رقم الهاتف أو كلمة المرور غير صحيحة';
  if (m.includes('email not confirmed')) return 'يرجى تأكيد بريدك الإلكتروني أولاً';
  if (m.includes('already') || m.includes('registered') || m.includes('exists'))
    return 'هذا البريد أو الرقم مستخدم في حساب آخر.';
  // OTP verify errors before the generic "invalid …" checks below.
  if (
    m.includes('expired') ||
    m.includes('otp') ||
    (m.includes('invalid') && m.includes('token'))
  )
    return 'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً.';
  if (m.includes('rate') || m.includes('too many') || m.includes('security purposes'))
    return 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة.';
  if (m.includes('password')) return 'كلمة المرور ضعيفة أو غير صالحة.';
  if (m.includes('invalid') && m.includes('email')) return 'بريد إلكتروني غير صالح.';
  if (m.includes('network') || m.includes('fetch') || m.includes('timeout'))
    return 'تعذّر الاتصال بالخادم، تحقّق من اتصالك وحاول مرة أخرى.';
  return 'تعذّر إتمام العملية، حاول مرة أخرى.';
}
