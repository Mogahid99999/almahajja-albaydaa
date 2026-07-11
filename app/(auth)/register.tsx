import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, TextInput, View } from 'react-native';

import type { Gender } from '@/api/types';
import { Card, ConcentricMotif, Logo, Screen, Txt } from '@/components/ui';
import { GenderPills } from '@/components/ui/GenderPills';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useRegister } from '@/hooks/useAuth';

const OATH_TEXT =
  'بمجرد إنشاء الحساب، سيتم اعتماد البيانات التي أدخلتها (الاسم والجنس) بشكل نهائي ولا يمكن تعديلها لاحقًا. بالمتابعة، أنت تُقسم بالله أن ما أدخلته صحيح وأنك مسؤول عن ذلك أمام الله.';

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
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [gender, setGender] = useState<Gender | null>(null);
  const [genderError, setGenderError] = useState(false);
  const [oathVisible, setOathVisible] = useState(false);
  const [oathChecked, setOathChecked] = useState(false);
  const register = useRegister();

  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();
  const trimmedEmail = email.trim();
  // Email is optional — phone is the required identifier (Task: phone registration).
  const emailOk = trimmedEmail.length === 0 || trimmedEmail.includes('@');
  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    trimmedName.length > 0 &&
    trimmedPhone.replace(/[^0-9]/g, '').length >= 8 &&
    emailOk &&
    password.length >= 6 &&
    passwordsMatch;

  const onSubmit = () => {
    if (!canSubmit) return;
    if (!gender) {
      setGenderError(true);
      return;
    }
    setOathChecked(false);
    setOathVisible(true);
  };

  const onConfirmOath = () => {
    if (!oathChecked || !gender) return;
    setOathVisible(false);
    register.mutate(
      { name: trimmedName, phone: trimmedPhone, email: trimmedEmail, password, gender },
      // Land on the profile so the new name/identity is confirmed — coherent from
      // every entry point (profile CTA, sign-in link, journey gate, Home banner).
      { onSuccess: () => router.replace('/(student)/profile') },
    );
  };

  const onCancelOath = () => {
    setOathVisible(false);
    setOathChecked(false);
  };

  return (
    <>
    {/* The app is edge-to-edge, so the keyboard OVERLAYS the screen instead of
        resizing it — the lower fields (تأكيد كلمة المرور) were getting covered
        while typing. `padding` shrinks the scroll area so the focused field
        scrolls above the keyboard; same fix as FeedbackSheet / lecture-note. */}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    <Screen scroll contentStyle={{ justifyContent: 'center', flexGrow: 1 }}>
      {/* Brand */}
      <View style={{ alignItems: 'center', marginBottom: 12 }}>
        <Logo size={65} />
        <Txt weight="display" size={20} color={colors.primaryTeal} style={{ marginTop: 8 }}>
          إنشاء حساب
        </Txt>
        <Txt size={12} color={colors.textGhost} align="center" style={{ marginTop: 4, lineHeight: 17 }}>
          سجّل لتتبّع رحلتك العلمية وحفظ تقدّمك عبر أجهزتك
        </Txt>
      </View>

      <Card style={{ padding: 16, overflow: 'hidden' }}>
        <ConcentricMotif size={180} color="rgba(31,74,66,0.05)" style={{ top: -40, left: -40 }} />

        <Field label="الاسم">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="اسمك"
            placeholderTextColor={colors.textGhost}
            style={inputStyle}
          />
        </Field>

        <Field label="رقم الهاتف">
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="09xxxxxxxx"
            placeholderTextColor={colors.textGhost}
            keyboardType="phone-pad"
            style={inputStyle}
          />
        </Field>

        <Field label="البريد الإلكتروني (اختياري)">
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
          <View style={{ position: 'relative', justifyContent: 'center' }}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="8 أحرف أو ارقام على الأقل"
              placeholderTextColor={colors.textGhost}
              secureTextEntry={!showPassword}
              style={[inputStyle, { paddingLeft: 40 }]}
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={8}
              style={{ position: 'absolute', left: 12 }}
            >
              <Feather
                name={showPassword ? 'eye-off' : 'eye'}
                size={18}
                color={colors.textGhost}
              />
            </Pressable>
          </View>
        </Field>

        <Field label="تأكيد كلمة المرور">
          <View style={{ position: 'relative', justifyContent: 'center' }}>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="أعد إدخال كلمة المرور"
              placeholderTextColor={colors.textGhost}
              secureTextEntry={!showConfirmPassword}
              style={[inputStyle, { paddingLeft: 40 }]}
            />
            <Pressable
              onPress={() => setShowConfirmPassword((v) => !v)}
              hitSlop={8}
              style={{ position: 'absolute', left: 12 }}
            >
              <Feather
                name={showConfirmPassword ? 'eye-off' : 'eye'}
                size={18}
                color={colors.textGhost}
              />
            </Pressable>
          </View>
          {confirmPassword.length > 0 && !passwordsMatch ? (
            <Txt size={12} color={colors.stateDanger} style={{ marginTop: 6 }}>
              كلمتا المرور غير متطابقتين
            </Txt>
          ) : null}
        </Field>

        {/* Required for رفيق الدراسة (26.2) — the buddy pairing is gender-segregated */}
        <Field label="النوع">
          <GenderPills
            value={gender}
            onChange={(g) => {
              setGender(g);
              setGenderError(false);
            }}
          />
          {genderError ? (
            <Txt size={12} color={colors.stateDanger} style={{ marginTop: 6 }}>
              يرجى تحديد الجنس
            </Txt>
          ) : null}
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
              paddingVertical: 12,
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
        style={{ alignItems: 'center', marginTop: 12 }}
      >
        <Txt size={12.5} color={colors.textMuted}>
          لديك حساب؟{' '}
          <Txt size={12.5} weight="semibold" color={colors.accentBrassMuted}>
            تسجيل الدخول
          </Txt>
        </Txt>
      </Pressable>
    </Screen>
    </KeyboardAvoidingView>

    <Modal visible={oathVisible} transparent animationType="slide" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(22,53,47,0.35)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.bgSandRaised,
            borderTopLeftRadius: radius.artwork,
            borderTopRightRadius: radius.artwork,
            paddingHorizontal: 22,
            paddingTop: 22,
            paddingBottom: 28,
            gap: 16,
          }}
        >
          <Txt weight="display" size={18} color={colors.primaryTeal} align="center">
            تأكيد البيانات
          </Txt>
          <Txt size={13.5} color={colors.textMuted} align="right" style={{ lineHeight: 23 }}>
            {OATH_TEXT}
          </Txt>

          <Pressable
            onPress={() => setOathChecked((c) => !c)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                borderWidth: 1.5,
                borderColor: oathChecked ? colors.primaryTeal : colors.borderSand2,
                backgroundColor: oathChecked ? colors.primaryTeal : colors.surfaceWhite,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {oathChecked ? <Feather name="check" size={14} color={colors.onTealPrimary} /> : null}
            </View>
            <Txt size={13} weight="medium" color={colors.textInk} style={{ flex: 1 }}>
              أقسم بالله أن هذه البيانات صحيحة
            </Txt>
          </Pressable>

          <Pressable
            onPress={onConfirmOath}
            disabled={!oathChecked || register.isPending}
            style={[
              {
                backgroundColor: colors.primaryTeal,
                borderRadius: radius.input,
                paddingVertical: 14,
                alignItems: 'center',
                opacity: !oathChecked || register.isPending ? 0.5 : 1,
              },
              shadows.button,
            ]}
          >
            <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
              {register.isPending ? 'جارٍ التسجيل…' : 'متابعة'}
            </Txt>
          </Pressable>

          <Pressable onPress={onCancelOath} style={{ alignItems: 'center', paddingVertical: 4 }}>
            <Txt size={13} weight="semibold" color={colors.textMuted}>
              رجوع
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 6 }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

const inputStyle = {
  height: 42,
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
