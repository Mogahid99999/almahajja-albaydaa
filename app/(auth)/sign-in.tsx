import { Feather, FontAwesome } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';

import { Card, ConcentricMotif, Logo, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useSignIn } from '@/hooks/useAuth';
import { useSupportContact } from '@/hooks/useAppContent';

// Supabase auth errors come back in English; map the ones users actually hit
// during sign-in to Arabic. Anything unrecognized falls back to a generic
// Arabic message rather than leaking English into this Arabic-first screen.
function arabicSignInError(message: string): string {
  const known: Record<string, string> = {
    'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'Email not confirmed': 'يرجى تأكيد بريدك الإلكتروني أولاً',
    'Too many requests': 'محاولات كثيرة جداً، حاول مرة أخرى بعد قليل',
  };
  return known[message] ?? 'تعذّر تسجيل الدخول، حاول مرة أخرى';
}

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const signIn = useSignIn();
  const { data: support } = useSupportContact();
  const supportUrl = support?.whatsappUrl ?? '';

  // Guest-first removed AuthGate's "bounce out of (auth)" for signed-in users (so
  // guests can stay here to register), so a returning sign-in must navigate itself.
  // Land on Home; AuthGate then redirects to /admin if the account is an admin.
  const onSubmit = () =>
    signIn.mutate({ email, password }, { onSuccess: () => router.replace('/') });

  return (
    <Screen scroll={false} contentStyle={{ justifyContent: 'center' }}>
      {/* Brand */}
      <View style={{ alignItems: 'center', marginBottom: 28 }}>
        <Logo size={56} />
        <Txt weight="display" size={26} color={colors.primaryTeal} style={{ marginTop: 14 }}>
          المَحجّة البَيْضَاء
        </Txt>
        <Txt size={12} color={colors.textGhost} style={{ marginTop: 4 }}>
          مجالس الدروس الشرعية
        </Txt>
      </View>

      <Card style={{ padding: 20, overflow: 'hidden' }}>
        <ConcentricMotif size={180} color="rgba(31,74,66,0.05)" style={{ top: -40, left: -40 }} />
        <Txt weight="semibold" size={16} style={[arabicTextStyle, { marginBottom: 16 }]}>
          تسجيل الدخول
        </Txt>

        <Field label="البريد الإلكتروني">
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="example@gmail.com"
            placeholderTextColor={colors.textGhost}
            autoCapitalize="none"
            keyboardType="email-address"
            style={inputStyle}
          />
        </Field>

        <Field label="كلمة المرور">
          <View style={pwWrapStyle}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textGhost}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              style={pwInputStyle}
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={8}
              style={{ paddingHorizontal: 12, height: '100%', justifyContent: 'center' }}
              accessibilityLabel={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            >
              <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.textFaint} />
            </Pressable>
          </View>
        </Field>

        {signIn.isError ? (
          <Txt size={12} color={colors.stateDanger} style={{ marginBottom: 10 }}>
            {arabicSignInError((signIn.error as Error).message)}
          </Txt>
        ) : null}

        <Pressable
          onPress={onSubmit}
          disabled={signIn.isPending}
          style={[
            {
              backgroundColor: colors.primaryTeal,
              borderRadius: radius.input,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: signIn.isPending ? 0.7 : 1,
            },
            shadows.button,
          ]}
        >
          <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
            {signIn.isPending ? 'جارٍ الدخول…' : 'دخول'}
          </Txt>
        </Pressable>

        <Link href="/reset-password" asChild>
          <Pressable hitSlop={8} style={{ alignItems: 'center', marginTop: 16 }}>
            <Txt size={12.5} weight="medium" color={colors.accentBrassMuted}>
              نسيت كلمة المرور؟
            </Txt>
          </Pressable>
        </Link>
      </Card>

      {/* New users → register (links name+email+password onto the guest account) */}
      <Link href="/register" asChild>
        <Pressable hitSlop={8} style={{ alignItems: 'center', marginTop: 18 }}>
          <Txt size={12.5} color={colors.textMuted}>
            ليس لديك حساب؟{' '}
            <Txt size={12.5} weight="semibold" color={colors.accentBrassMuted}>
              إنشاء حساب
            </Txt>
          </Txt>
        </Pressable>
      </Link>

      {/* Support contact — only when an admin has set a WhatsApp link (empty = hidden) */}
      {supportUrl ? (
        <Pressable
          onPress={() => Linking.openURL(supportUrl)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="تواصل مع الدعم الفني عبر واتساب"
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              marginTop: 22,
              paddingVertical: 6,
            },
            pressed && { opacity: 0.6 },
          ]}
        >
          <FontAwesome name="whatsapp" size={15} color={colors.accentBrassMuted} />
          <Txt size={12} color={colors.textMuted}>
            هل لديك مشكلة؟ تواصل مع الدعم الفني للمنصة
          </Txt>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Txt size={13} weight="semibold" color={colors.textSlate} style={[arabicTextStyle, { marginBottom: 7 }]}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

// Confirmed on-device (see the same fix in components/ui/Txt.tsx):  this
// app's forced-RTL setup renders `textAlign: 'right'` flush LEFT and 'left'
// flush RIGHT for any box wider than its content, unconditionally.
const visualRightTextAlign = 'left';
const visualLeftTextAlign = 'right';

const arabicTextStyle = {
  textAlign: visualRightTextAlign as 'left' | 'right',
  writingDirection: 'rtl' as const,
};

const inputStyle = {
  height: 46,
  borderWidth: 1,
  borderColor: colors.borderSand2,
  borderRadius: radius.input,
  backgroundColor: colors.surfaceWhite,
  paddingHorizontal: 14,
  textAlign: visualLeftTextAlign as 'left' | 'right',
  writingDirection: 'ltr' as const,
  fontFamily: fonts.body,
  fontSize: 14,
  color: colors.textInk,
};

// Password field: same box as inputStyle, but a row so the show/hide eye sits
// inside it (on the left in RTL).
const pwWrapStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  height: 46,
  borderWidth: 1,
  borderColor: colors.borderSand2,
  borderRadius: radius.input,
  backgroundColor: colors.surfaceWhite,
};

const pwInputStyle = {
  flex: 1,
  height: '100%' as const,
  paddingHorizontal: 14,
  textAlign: visualLeftTextAlign as 'left' | 'right',
  writingDirection: 'ltr' as const,
  fontFamily: fonts.body,
  fontSize: 14,
  color: colors.textInk,
};
