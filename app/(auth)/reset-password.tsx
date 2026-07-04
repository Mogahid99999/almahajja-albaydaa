import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { updatePassword, verifyPasswordResetCode } from '@/api/auth';
import { Card, IconButton, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useRequestPasswordReset } from '@/hooks/useAuth';
import { arNum } from '@/lib/format';

/**
 * Password reset by OTP CODE (not a link) — works identically on native and web.
 *  - "request": enter email → Supabase emails a 6-digit code (recovery template
 *    renders {{ .Token }}).
 *  - "verify": enter the code + a new password → verifyOtp establishes a
 *    short-lived recovery session, then updateUser writes the new password.
 * A code avoids the mobile deep-link/recovery-session fragility a magic link has.
 */
// Must match Supabase Auth `mailer_otp_length` (set to 6 — its minimum; 4 isn't
// allowed). If that server value changes, change this too or the field truncates
// the code and every verify fails.
const OTP_LENGTH = 6;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'request' | 'verify'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = useRequestPasswordReset();

  const emailValid = /.+@.+\..+/.test(email.trim());

  const sendCode = () => {
    setError(null);
    reset.mutate(email.trim(), {
      onSuccess: () => {
        setMode('verify');
        setCode('');
      },
      onError: (e) => setError(arError(e)),
    });
  };

  const submit = async () => {
    setError(null);
    if (code.trim().length < OTP_LENGTH) {
      setError('أدخل الرمز كاملاً.');
      return;
    }
    if (password.length < 6) {
      setError('كلمة المرور يجب ألا تقل عن ٦ أحرف.');
      return;
    }
    setBusy(true);
    try {
      await verifyPasswordResetCode(email, code);
      await updatePassword(password);
      setDone(true);
      setTimeout(() => router.replace('/sign-in'), 1500);
    } catch (e) {
      setError(arError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false} contentStyle={{ justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <IconButton
          icon="chevron-right"
          onPress={() => (mode === 'verify' && !done ? setMode('request') : router.back())}
          accessibilityLabel="رجوع"
        />
        <Txt weight="display" size={22} color={colors.primaryTeal}>
          استعادة كلمة المرور
        </Txt>
      </View>

      <Card style={{ padding: 20 }}>
        {mode === 'request' ? (
          <>
            <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
              البريد الإلكتروني
            </Txt>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="example@gmail.com"
              placeholderTextColor={colors.textGhost}
              autoCapitalize="none"
              keyboardType="email-address"
              style={inputStyle}
            />
            {error ? (
              <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
                {error}
              </Txt>
            ) : null}
            <PrimaryButton
              label={reset.isPending ? 'جارٍ الإرسال…' : 'إرسال رمز الاستعادة'}
              disabled={reset.isPending || !emailValid}
              onPress={sendCode}
            />
          </>
        ) : done ? (
          <Txt size={13.5} color={colors.stateSuccess} style={{ lineHeight: 22 }}>
            تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.
          </Txt>
        ) : (
          <>
            <Txt size={13} color={colors.textMuted} style={{ marginBottom: 14, lineHeight: 21 }}>
              أرسلنا رمزاً مكوّناً من {arNum(OTP_LENGTH)} أرقام إلى{' '}
              <Txt size={13} weight="semibold" color={colors.textSlate}>
                {email.trim()}
              </Txt>
              . أدخله مع كلمة المرور الجديدة.
            </Txt>

            <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
              رمز التحقق
            </Txt>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, OTP_LENGTH))}
              placeholder={'_'.repeat(OTP_LENGTH)}
              placeholderTextColor={colors.textGhost}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              style={[inputStyle, { textAlign: 'center', letterSpacing: 8, fontSize: 20 }]}
            />

            <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginTop: 14, marginBottom: 7 }}>
              كلمة المرور الجديدة
            </Txt>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textGhost}
              secureTextEntry
              autoCapitalize="none"
              style={inputStyle}
            />

            {error ? (
              <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
                {error}
              </Txt>
            ) : null}

            <PrimaryButton
              label={busy ? 'جارٍ الحفظ…' : 'تأكيد وتغيير كلمة المرور'}
              disabled={busy}
              onPress={submit}
            />

            <Pressable
              onPress={sendCode}
              disabled={reset.isPending}
              hitSlop={8}
              style={{ alignItems: 'center', marginTop: 16 }}
            >
              <Txt size={12.5} weight="medium" color={colors.accentBrassMuted}>
                {reset.isPending ? 'جارٍ إعادة الإرسال…' : 'إعادة إرسال الرمز'}
              </Txt>
            </Pressable>
          </>
        )}
      </Card>
    </Screen>
  );
}

/** Map the (English) Supabase auth error to a calm Arabic message. */
function arError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase();
  if (msg.includes('expired') || (msg.includes('invalid') && msg.includes('token')) || msg.includes('otp'))
    return 'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً.';
  if (msg.includes('rate') || msg.includes('too many') || msg.includes('security purposes'))
    return 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة.';
  if (msg.includes('password')) return 'كلمة المرور ضعيفة أو غير صالحة.';
  return e instanceof Error && e.message ? e.message : 'تعذّر إتمام العملية.';
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          backgroundColor: colors.primaryTeal,
          borderRadius: radius.input,
          paddingVertical: 14,
          alignItems: 'center',
          marginTop: 16,
          opacity: disabled ? 0.7 : 1,
        },
        shadows.button,
      ]}
    >
      <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
        {label}
      </Txt>
    </Pressable>
  );
}

const inputStyle = {
  height: 46,
  borderWidth: 1,
  borderColor: colors.borderSand2,
  borderRadius: radius.input,
  backgroundColor: colors.surfaceWhite,
  paddingHorizontal: 14,
  textAlign: 'right' as const,
  writingDirection: 'rtl' as const,
  fontFamily: fonts.body,
  fontSize: 14,
  color: colors.textInk,
};
