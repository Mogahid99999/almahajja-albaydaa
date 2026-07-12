import Feather from '@expo/vector-icons/Feather';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';

import { SupportContactLink } from '@/components/SupportContactLink';
import { Card, ConcentricMotif, Logo, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useSignIn } from '@/hooks/useAuth';

// Supabase auth errors come back in English; map the ones users actually hit
// during sign-in to Arabic. Anything unrecognized falls back to a generic
// Arabic message rather than leaking English into this Arabic-first screen.
function arabicSignInError(message: string): string {
  const known: Record<string, string> = {
    'Invalid login credentials': 'البريد الإلكتروني أو رقم الهاتف أو كلمة المرور غير صحيحة',
    'Email not confirmed': 'يرجى تأكيد بريدك الإلكتروني أولاً',
    'Too many requests': 'محاولات كثيرة جداً، حاول مرة أخرى بعد قليل',
  };
  return known[message] ?? 'تعذّر تسجيل الدخول، حاول مرة أخرى';
}

export default function SignInScreen() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const signIn = useSignIn();

  // Android system back mirrors «المتابعة كضيف» below: pop back to wherever
  // the student came from when there is history, otherwise (this screen was
  // reached via `replace` — e.g. right after signing out — so a plain back
  // would close the app) land on Home as a guest. Focus-scoped so a pushed
  // /register or /reset-password on top keeps its own default back behavior.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (router.canGoBack()) return false;
        router.replace('/');
        return true;
      });
      return () => sub.remove();
    }, [router]),
  );

  // Guest-first removed AuthGate's "bounce out of (auth)" for signed-in users (so
  // guests can stay here to register), so a returning sign-in must navigate itself.
  // Land on Home; AuthGate then redirects to /admin if the account is an admin.
  const onSubmit = () =>
    signIn.mutate({ identifier, password }, { onSuccess: () => router.replace('/') });

  return (
    // Scroll + keyboard-avoid (same fix as register): the old scroll={false} +
    // centered layout cut off the bottom links on a 720×1280 screen, and the
    // keyboard buried the password field + «دخول» with no scroll escape.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    <Screen scroll contentStyle={{ flexGrow: 1 }} bottomPad={40}>
      {/* Brand — marginTop (not container paddingTop, which would displace the
          status-bar scrim) gives the logo breathing room from the top edge. */}
      <View style={{ alignItems: 'center', marginTop: 28, marginBottom: 28 }}>
        <Logo size={56} />
        <Txt weight="display" size={26} color={colors.primaryTeal} style={{ marginTop: 14 }}>
          المَحجّة البَيْضَاء
        </Txt>
        <Txt size={12} color={colors.textGhost} style={{ marginTop: 4 }}>
          مجالس الدروس الشرعية
        </Txt>
      </View>

      <Card style={{ padding: 20, overflow: 'hidden' }}>
        <ConcentricMotif size={180} color="rgba(31,74,66,0.05)" style={{ top: -40 }} />
        <Txt weight="semibold" size={16} style={[arabicTextStyle, { marginBottom: 16 }]}>
          تسجيل الدخول
        </Txt>

        <Field label="البريد الإلكتروني أو رقم الهاتف">
          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="example@gmail.com أو 09xxxxxxxx"
            placeholderTextColor={colors.textGhost}
            autoCapitalize="none"
            keyboardType="default"
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

      {/* Guest-first (CLAUDE.md): a guest session already exists behind this
          screen (SessionGate), so "continue as guest" never signs anything in
          or out — it just leaves the sign-in screen. `back()` returns to
          wherever the student came from (e.g. رحلتي العلمية's gate pushed this
          screen); when there's nothing to go back to (e.g. this screen was
          reached via `replace` right after signing out), land on Home instead.
          Native only — web IS the staff/admin dashboard with no guest session,
          so AuthGate would just bounce a "guest" tap straight back here. */}
      {Platform.OS !== 'web' ? (
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="المتابعة كضيف دون تسجيل الدخول"
          style={({ pressed }) => [{ alignItems: 'center', marginTop: 16 }, pressed && { opacity: 0.6 }]}
        >
          <Txt size={12.5} color={colors.textGhost}>
            المتابعة كضيف
          </Txt>
        </Pressable>
      ) : null}

      {/* Support contact — only when an admin has set the link (empty = hidden) */}
      <SupportContactLink style={{ marginTop: 22 }} />
    </Screen>
    </KeyboardAvoidingView>
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
