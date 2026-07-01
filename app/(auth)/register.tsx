import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Card, ConcentricMotif, Logo, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useRegister } from '@/hooks/useAuth';

/**
 * Register — إنشاء حساب (Task 2).
 *
 * Links a NAME + email + password onto the current silent anonymous account
 * (anon→permanent), so no progress is lost and it starts syncing across devices.
 * Data-minimisation: only name + email are collected (Apple guideline, Task 10).
 * Calm, non-gamified tone — registration only unlocks رحلتي العلمية; everything
 * else was already open to guests.
 */
export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const register = useRegister();

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const canSubmit =
    trimmedName.length > 0 && trimmedEmail.includes('@') && password.length >= 6;

  const onSubmit = () => {
    if (!canSubmit) return;
    register.mutate(
      { name: trimmedName, email: trimmedEmail, password },
      // Land on the profile so the new name/identity is confirmed — coherent from
      // every entry point (profile CTA, sign-in link, journey gate, Home banner).
      { onSuccess: () => router.replace('/(student)/profile') },
    );
  };

  return (
    <Screen scroll contentStyle={{ justifyContent: 'center', flexGrow: 1 }}>
      {/* Brand */}
      <View style={{ alignItems: 'center', marginBottom: 24 }}>
        <Logo size={52} />
        <Txt weight="display" size={22} color={colors.primaryTeal} style={{ marginTop: 12 }}>
          إنشاء حساب
        </Txt>
        <Txt size={12} color={colors.textGhost} align="center" style={{ marginTop: 6, lineHeight: 19 }}>
          سجّل لتتبّع رحلتك العلمية وحفظ تقدّمك عبر أجهزتك
        </Txt>
      </View>

      <Card style={{ padding: 20, overflow: 'hidden' }}>
        <ConcentricMotif size={180} color="rgba(31,74,66,0.05)" style={{ top: -40, left: -40 }} />

        <Field label="الاسم">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="اسمك الكريم"
            placeholderTextColor={colors.textGhost}
            style={inputStyle}
          />
        </Field>

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
            placeholder="٦ أحرف على الأقل"
            placeholderTextColor={colors.textGhost}
            secureTextEntry
            style={inputStyle}
          />
        </Field>

        {register.isError ? (
          <Txt size={12} color={colors.stateDanger} style={{ marginBottom: 10 }}>
            {(register.error as Error).message}
          </Txt>
        ) : null}

        <Pressable
          onPress={onSubmit}
          disabled={register.isPending || !canSubmit}
          style={[
            {
              backgroundColor: colors.primaryTeal,
              borderRadius: radius.input,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: register.isPending || !canSubmit ? 0.6 : 1,
            },
            shadows.button,
          ]}
        >
          <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
            {register.isPending ? 'جارٍ التسجيل…' : 'إنشاء الحساب'}
          </Txt>
        </Pressable>
      </Card>

      {/* Returning users */}
      <Pressable
        hitSlop={8}
        onPress={() => router.replace('/sign-in')}
        style={{ alignItems: 'center', marginTop: 18 }}
      >
        <Txt size={12.5} color={colors.textMuted}>
          لديك حساب؟{' '}
          <Txt size={12.5} weight="semibold" color={colors.accentBrassMuted}>
            تسجيل الدخول
          </Txt>
        </Txt>
      </Pressable>
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
