import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Card, ConcentricMotif, Logo, Screen, Txt } from '@/components/ui';
import { DEMO_ACCOUNTS } from '@/config';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useSignIn } from '@/hooks/useAuth';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signIn = useSignIn();

  return (
    <Screen scroll={false} contentStyle={{ justifyContent: 'center' }}>
      {/* Brand */}
      <View style={{ alignItems: 'center', marginBottom: 28 }}>
        <Logo size={56} />
        <Txt weight="display" size={26} color={colors.primaryTeal} style={{ marginTop: 14 }}>
          رِواق العِلم
        </Txt>
        <Txt size={12} color={colors.textGhost} style={{ marginTop: 4 }}>
          مجالس الدروس الشرعية
        </Txt>
      </View>

      <Card style={{ padding: 20, overflow: 'hidden' }}>
        <ConcentricMotif size={180} color="rgba(31,74,66,0.05)" style={{ top: -40, left: -40 }} />
        <Txt weight="semibold" size={16} style={{ marginBottom: 16 }}>
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
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textGhost}
            secureTextEntry
            style={inputStyle}
          />
        </Field>

        {signIn.isError ? (
          <Txt size={12} color={colors.stateDanger} style={{ marginBottom: 10 }}>
            {(signIn.error as Error).message}
          </Txt>
        ) : null}

        <Pressable
          onPress={() => signIn.mutate({ email, password })}
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

      {/* Demo accounts hint (mock mode) */}
      <Card style={{ marginTop: 16, backgroundColor: 'rgba(176,137,79,0.06)', borderStyle: 'dashed', borderColor: colors.accentBrassSoft }}>
        <Txt size={11.5} color={colors.textFaint} style={{ lineHeight: 18 }}>
          حسابات تجريبية:{'\n'}مدير: {DEMO_ACCOUNTS.admin.email}{'\n'}طالب: {DEMO_ACCOUNTS.student.email}{'\n'}كلمة المرور: {DEMO_ACCOUNTS.admin.password}
        </Txt>
      </Card>
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
        {label}
      </Txt>
      {children}
    </View>
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
