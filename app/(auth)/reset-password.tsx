import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { updatePassword } from '@/api/auth';
import { Card, IconButton, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useRequestPasswordReset } from '@/hooks/useAuth';

/**
 * Two modes:
 *  - "request": enter email → real Supabase sends a reset link (PRD: reset via email).
 *  - "set": arriving from the email link gives a recovery session → set a new password.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'request' | 'set'>('request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = useRequestPasswordReset();

  // A recovery session (from the email link) switches us to "set new password".
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setMode('set');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('set');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Screen scroll={false} contentStyle={{ justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt weight="display" size={22} color={colors.primaryTeal}>
          استعادة كلمة المرور
        </Txt>
      </View>

      <Card style={{ padding: 20 }}>
        {mode === 'request' ? (
          sent ? (
            <Txt size={13.5} color={colors.textMuted} style={{ lineHeight: 22 }}>
              تم إرسال رابط استعادة كلمة المرور إلى بريدك. افتح الرابط من بريدك لإكمال
              تغيير كلمة المرور.
            </Txt>
          ) : (
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
              {reset.isError ? (
                <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
                  {(reset.error as Error).message}
                </Txt>
              ) : null}
              <PrimaryButton
                label={reset.isPending ? 'جارٍ الإرسال…' : 'إرسال رابط الاستعادة'}
                disabled={reset.isPending}
                onPress={() =>
                  reset.mutate(email, { onSuccess: () => setSent(true) })
                }
              />
            </>
          )
        ) : done ? (
          <Txt size={13.5} color={colors.stateSuccess} style={{ lineHeight: 22 }}>
            تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.
          </Txt>
        ) : (
          <>
            <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
              كلمة المرور الجديدة
            </Txt>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textGhost}
              secureTextEntry
              style={inputStyle}
            />
            {error ? (
              <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
                {error}
              </Txt>
            ) : null}
            <PrimaryButton
              label="حفظ كلمة المرور"
              onPress={async () => {
                setError(null);
                try {
                  await updatePassword(password);
                  setDone(true);
                  setTimeout(() => router.replace('/sign-in'), 1500);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </>
        )}
      </Card>
    </Screen>
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
