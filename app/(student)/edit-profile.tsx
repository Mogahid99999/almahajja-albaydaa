/**
 * Edit profile — تعديل الملف الشخصي (Task 2 / V7).
 *
 * Edits the display NAME + gender (auth metadata, synced across devices) AND the
 * sign-in EMAIL. Email now applies immediately: the project keeps
 * `mailer_autoconfirm` on (registration is verification-free too), so
 * updateUser({email}) swaps the sign-in address with no confirmation step.
 * Only reachable by registered users (the profile screen gates the entry on
 * !isGuest), so an email always exists here.
 *
 * Route: /(student)/edit-profile
 */
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import type { Gender } from '@/api/types';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useCurrentUser, useUpdateProfile } from '@/hooks/useAuth';

import { Card } from '@/components/ui/Card';
import { GenderPills } from '@/components/ui/GenderPills';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { useRouter } from 'expo-router';

export default function EditProfileScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const update = useUpdateProfile();

  const [name, setName] = useState(user?.displayName ?? '');
  const [gender, setGender] = useState<Gender | null>(user?.gender ?? null);
  const [email, setEmail] = useState(user?.email ?? '');

  const trimmed = name.trim();
  const nameChanged = trimmed.length > 0 && trimmed !== (user?.displayName ?? '');
  const genderChanged = gender !== null && gender !== (user?.gender ?? null);

  const emailTrimmed = email.trim().toLowerCase();
  const emailDiffers = emailTrimmed !== (user?.email ?? '').toLowerCase();
  const emailValid = /.+@.+\..+/.test(emailTrimmed);
  const emailChanged = emailDiffers && emailValid;
  const emailInvalid = emailDiffers && !emailValid; // typed, but not a valid address

  const changed = nameChanged || genderChanged || emailChanged;
  const canSave = changed && !emailInvalid;

  const onSave = () => {
    if (!canSave) return;
    update.mutate(
      {
        ...(nameChanged ? { displayName: trimmed } : {}),
        ...(genderChanged && gender ? { gender } : {}),
        ...(emailChanged ? { email: emailTrimmed } : {}),
      },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <Screen bottomPad={118} padded>
      {/* ── Nav row ─────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          تعديل الملف
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      <Card style={{ padding: 20 }}>
        {/* Name — editable */}
        <View style={{ marginBottom: 18 }}>
          <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
            الاسم
          </Txt>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="اسمك"
            placeholderTextColor={colors.textGhost}
            style={inputStyle}
          />
        </View>

        {/* Gender — required for رفيق الدراسة (26.2); changeable in v1 */}
        <View style={{ marginBottom: 18 }}>
          <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
            النوع
          </Txt>
          <GenderPills value={gender} onChange={setGender} />
        </View>

        {/* Email — sign-in address (editable; applies immediately) */}
        <View>
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
          {emailInvalid ? (
            <Txt size={11} color={colors.stateDanger} style={{ marginTop: 6 }}>
              أدخل بريدًا إلكترونيًا صحيحًا
            </Txt>
          ) : (
            <Txt size={11} color={colors.textGhost} style={{ marginTop: 6 }}>
              بريد تسجيل الدخول
            </Txt>
          )}
        </View>

        {update.isError ? (
          <Txt size={12} color={colors.stateDanger} style={{ marginTop: 12 }}>
            {arError((update.error as Error).message)}
          </Txt>
        ) : null}

        <Pressable
          onPress={onSave}
          disabled={update.isPending || !canSave}
          style={[
            {
              marginTop: 22,
              backgroundColor: colors.primaryTeal,
              borderRadius: radius.input,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: update.isPending || !canSave ? 0.6 : 1,
            },
            shadows.button,
          ]}
        >
          <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
            {update.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
          </Txt>
        </Pressable>
      </Card>
    </Screen>
  );
}

/** Map the (English) Supabase auth error to a calm Arabic message. */
function arError(msg: string): string {
  const m = (msg ?? '').toLowerCase();
  if (m.includes('already') || m.includes('registered') || m.includes('exists'))
    return 'هذا البريد مستخدم في حساب آخر.';
  if (m.includes('invalid') && m.includes('email')) return 'بريد إلكتروني غير صالح.';
  if (m.includes('rate') || m.includes('too many')) return 'محاولات كثيرة، حاول لاحقًا.';
  return msg || 'تعذّر الحفظ.';
}

const inputStyle = {
  minHeight: 46,
  borderWidth: 1,
  borderColor: colors.borderSand2,
  borderRadius: radius.input,
  backgroundColor: colors.surfaceWhite,
  paddingHorizontal: 14,
  paddingVertical: 8,
  textAlign: 'right' as const,
  writingDirection: 'rtl' as const,
  fontFamily: fonts.body,
  fontSize: 14,
  color: colors.textInk,
};
