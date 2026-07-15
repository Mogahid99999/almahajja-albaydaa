import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, TextInput, View } from 'react-native';

import { updatePassword, verifyPasswordResetCode } from '@/api/auth';
import { Card, IconButton, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useRequestPasswordReset } from '@/hooks/useAuth';
import { arabicAuthError } from '@/lib/authErrors';
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
  // The recovery session from a SUCCESSFUL verifyOtp survives a failed
  // updatePassword (e.g. too-short/weak password). The code is single-use, so
  // re-verifying it on the retry submit would always fail — remember that the
  // verify step already passed and skip straight to the password write.
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = useRequestPasswordReset();
  // The success message shows briefly before the redirect — but the redirect
  // must not fire if the user has already navigated away themselves.
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    },
    [],
  );

  const emailValid = /.+@.+\..+/.test(email.trim());

  const sendCode = () => {
    setError(null);
    reset.mutate(email.trim(), {
      onSuccess: () => {
        setMode('verify');
        setCode('');
        setVerified(false); // a resent code starts a fresh verify cycle
      },
      onError: (e) => setError(arabicAuthError(e)),
    });
  };

  const submit = async () => {
    setError(null);
    if (code.trim().length < OTP_LENGTH) {
      setError('أدخل الرمز كاملاً.');
      return;
    }
    // Min 8 matches the server (Supabase password_min_length): a shorter gate
    // used to let the verify step consume the single-use code, then fail on
    // updatePassword — leaving the user unable to retry with that code.
    if (password.length < 8) {
      setError('كلمة المرور يجب ألا تقل عن ٨ أحرف.');
      return;
    }
    setBusy(true);
    try {
      if (!verified) {
        await verifyPasswordResetCode(email, code);
        setVerified(true);
      }
      await updatePassword(password);
      setDone(true);
      doneTimer.current = setTimeout(() => router.replace('/sign-in'), 1500);
    } catch (e) {
      setError(arabicAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    // Scroll + keyboard-avoid (same fix as sign-in/register): the verify step
    // (code + new password + two buttons) must stay reachable on a short
    // viewport with the keyboard open.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    <Screen scroll contentStyle={{ flexGrow: 1 }} bottomPad={40}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 18 }}>
        <IconButton
          icon="chevron-right"
          onPress={() => (mode === 'verify' && !done ? setMode('request') : router.back())}
          accessibilityLabel="رجوع"
        />
        {/* flex:1 so the title owns the rest of the row: a content-sized RTL
            Text clips its trailing word on Android («استعادة كلمة المرور» →
            «استعادة كلمة»), and the full-width box also lets it wrap on
            narrow screens. */}
        <Txt weight="display" size={22} color={colors.primaryTeal} align="right" style={{ flex: 1 }}>
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
    </KeyboardAvoidingView>
  );
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
      {/* stretch + center: a content-sized RTL Text can render off-center /
          clip its trailing word inside a centered button on Android. */}
      <Txt
        weight="semibold"
        size={15}
        color={colors.onTealPrimary}
        align="center"
        style={{ alignSelf: 'stretch' }}
      >
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
