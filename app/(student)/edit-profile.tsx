/**
 * Edit profile — تعديل الملف الشخصي (Task 2 / V7, extended for phone registration).
 *
 * Name and gender are entered once at registration under an identity oath
 * (Item 10) and are permanently read-only afterward for every account, shown
 * here for reference only. Phone (if the account was phone-registered) is
 * also shown read-only — only admin can edit it (see admin/user/[id].tsx).
 *
 * Email is a two-step change: saving a new address sends a 6-digit code to
 * it (does NOT apply immediately anymore — email is now the password-recovery
 * channel, so an unverified/typo'd address must never silently become it),
 * and entering that code completes the change. Password change needs no
 * "current password" — the signed-in session itself is the proof of identity.
 *
 * Only reachable by registered users (the profile screen gates the entry on
 * !isGuest).
 *
 * Route: /(student)/edit-profile
 */
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import type { Gender } from '@/api/types';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import {
  useCurrentUser,
  useRequestEmailChange,
  useUpdatePassword,
  useVerifyEmailChange,
} from '@/hooks/useAuth';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { useRouter } from 'expo-router';

const GENDER_LABEL: Record<Gender, string> = { male: 'ذكر', female: 'أنثى' };
const OTP_LENGTH = 6; // must match Supabase `mailer_otp_length` — see reset-password.tsx

export default function EditProfileScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const requestEmailChange = useRequestEmailChange();
  const verifyEmailChange = useVerifyEmailChange();
  const updatePassword = useUpdatePassword();
  const miniPad = useMiniPlayerPad();

  const [email, setEmail] = useState(user?.email ?? '');
  // Non-null once a code has been sent — the address it was sent to.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [emailNotice, setEmailNotice] = useState<{ msg: string; type: 'success' | 'error' } | null>(
    null,
  );

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordNotice, setPasswordNotice] = useState<{
    msg: string;
    type: 'success' | 'error';
  } | null>(null);

  const emailTrimmed = email.trim().toLowerCase();
  const emailDiffers = emailTrimmed !== (user?.email ?? '').toLowerCase();
  const emailValid = /.+@.+\..+/.test(emailTrimmed);
  const emailChanged = emailDiffers && emailValid;
  const emailInvalid = emailDiffers && !emailValid; // typed, but not a valid address

  const onSendCode = () => {
    if (!emailChanged) return;
    setEmailNotice(null);
    requestEmailChange.mutate(emailTrimmed, {
      onSuccess: () => {
        setPendingEmail(emailTrimmed);
        setEmailCode('');
      },
      onError: (e) => setEmailNotice({ msg: arError((e as Error).message), type: 'error' }),
    });
  };

  const onConfirmCode = () => {
    if (!pendingEmail || emailCode.trim().length < OTP_LENGTH) return;
    verifyEmailChange.mutate(
      { email: pendingEmail, code: emailCode.trim() },
      {
        onSuccess: () => {
          setPendingEmail(null);
          setEmailCode('');
          setEmailNotice({ msg: 'تم تحديث البريد الإلكتروني بنجاح', type: 'success' });
        },
        onError: (e) => setEmailNotice({ msg: arError((e as Error).message), type: 'error' }),
      },
    );
  };

  const passwordValid = newPassword.length >= 6 && newPassword === confirmPassword;
  const onSavePassword = () => {
    if (!passwordValid) return;
    setPasswordNotice(null);
    updatePassword.mutate(newPassword, {
      onSuccess: () => {
        setNewPassword('');
        setConfirmPassword('');
        setPasswordNotice({ msg: 'تم تغيير كلمة المرور بنجاح', type: 'success' });
      },
      onError: (e) => setPasswordNotice({ msg: arError((e as Error).message), type: 'error' }),
    });
  };

  return (
    <Screen bottomPad={miniPad || 24} padded>
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
        {/* Name — locked after registration (Item 10 identity oath) */}
        <View style={{ marginBottom: 18 }}>
          <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
            الاسم
          </Txt>
          <View style={readOnlyBoxStyle}>
            <Txt size={14} color={colors.textInk}>
              {user?.displayName ?? '—'}
            </Txt>
          </View>
        </View>

        {/* Gender — locked after registration (Item 10 identity oath) */}
        <View style={{ marginBottom: 18 }}>
          <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
            النوع
          </Txt>
          <View style={readOnlyBoxStyle}>
            <Txt size={14} color={colors.textInk}>
              {user?.gender ? GENDER_LABEL[user.gender] : '—'}
            </Txt>
          </View>
        </View>

        {/* Phone — sign-in credential; only the admin can edit it (no self-service, no OTP) */}
        <View style={{ marginBottom: 10 }}>
          <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
            رقم الهاتف
          </Txt>
          <View style={readOnlyBoxStyle}>
            <Txt size={14} color={colors.textInk}>
              {user?.phone || '—'}
            </Txt>
          </View>
        </View>

        <Txt size={11} color={colors.textGhost} style={{ marginBottom: 18 }}>
          لا يمكن تعديل الاسم أو الجنس أو رقم الهاتف من هنا — تواصل مع الإدارة عند الحاجة
        </Txt>

        {/* Email — two-step change: a code is sent to the new address and must be
            confirmed before it takes effect (email is the password-recovery channel). */}
        {pendingEmail ? (
          <View>
            <Txt size={13} color={colors.textMuted} style={{ marginBottom: 12, lineHeight: 20 }}>
              أرسلنا رمزاً مكوّناً من {OTP_LENGTH} أرقام إلى{' '}
              <Txt size={13} weight="semibold" color={colors.textSlate}>
                {pendingEmail}
              </Txt>
            </Txt>
            <TextInput
              value={emailCode}
              onChangeText={(t) => setEmailCode(t.replace(/[^0-9]/g, '').slice(0, OTP_LENGTH))}
              placeholder={'_'.repeat(OTP_LENGTH)}
              placeholderTextColor={colors.textGhost}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              style={[inputStyle, { textAlign: 'center', letterSpacing: 8, fontSize: 20 }]}
            />
            <Pressable
              onPress={onConfirmCode}
              disabled={verifyEmailChange.isPending || emailCode.trim().length < OTP_LENGTH}
              style={[
                {
                  marginTop: 14,
                  backgroundColor: colors.primaryTeal,
                  borderRadius: radius.input,
                  paddingVertical: 14,
                  alignItems: 'center',
                  opacity:
                    verifyEmailChange.isPending || emailCode.trim().length < OTP_LENGTH ? 0.6 : 1,
                },
                shadows.button,
              ]}
            >
              <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
                {verifyEmailChange.isPending ? 'جارٍ التأكيد…' : 'تأكيد الرمز'}
              </Txt>
            </Pressable>
            <Pressable
              onPress={() => {
                setPendingEmail(null);
                setEmailCode('');
                setEmailNotice(null);
              }}
              hitSlop={8}
              style={{ alignItems: 'center', marginTop: 12 }}
            >
              <Txt size={12.5} weight="semibold" color={colors.textMuted}>
                رجوع
              </Txt>
            </Pressable>
          </View>
        ) : (
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
                بريد تسجيل الدخول واستعادة كلمة المرور — تغييره يتطلب تأكيد رمز يُرسل إليه
              </Txt>
            )}
            <Pressable
              onPress={onSendCode}
              disabled={requestEmailChange.isPending || !emailChanged}
              style={[
                {
                  marginTop: 16,
                  backgroundColor: colors.primaryTeal,
                  borderRadius: radius.input,
                  paddingVertical: 14,
                  alignItems: 'center',
                  opacity: requestEmailChange.isPending || !emailChanged ? 0.6 : 1,
                },
                shadows.button,
              ]}
            >
              <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
                {requestEmailChange.isPending ? 'جارٍ الإرسال…' : 'إرسال رمز التأكيد'}
              </Txt>
            </Pressable>
          </View>
        )}

        {emailNotice ? (
          <Txt
            size={12}
            color={emailNotice.type === 'error' ? colors.stateDanger : colors.stateSuccess}
            style={{ marginTop: 12 }}
          >
            {emailNotice.msg}
          </Txt>
        ) : null}
      </Card>

      {/* Change password — no "current password" needed, the session already proves identity */}
      <Card style={{ padding: 20, marginTop: 16 }}>
        <Txt weight="semibold" size={15} color={colors.textInk} style={{ marginBottom: 16 }}>
          تغيير كلمة المرور
        </Txt>

        <View style={{ marginBottom: 14 }}>
          <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
            كلمة المرور الجديدة
          </Txt>
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="٦ أحرف على الأقل"
            placeholderTextColor={colors.textGhost}
            secureTextEntry
            autoCapitalize="none"
            style={inputStyle}
          />
        </View>

        <View>
          <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
            تأكيد كلمة المرور
          </Txt>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="أعد كتابة كلمة المرور"
            placeholderTextColor={colors.textGhost}
            secureTextEntry
            autoCapitalize="none"
            style={inputStyle}
          />
          {confirmPassword.length > 0 && newPassword !== confirmPassword ? (
            <Txt size={11} color={colors.stateDanger} style={{ marginTop: 6 }}>
              كلمتا المرور غير متطابقتين
            </Txt>
          ) : null}
        </View>

        {passwordNotice ? (
          <Txt
            size={12}
            color={passwordNotice.type === 'error' ? colors.stateDanger : colors.stateSuccess}
            style={{ marginTop: 12 }}
          >
            {passwordNotice.msg}
          </Txt>
        ) : null}

        <Pressable
          onPress={onSavePassword}
          disabled={updatePassword.isPending || !passwordValid}
          style={[
            {
              marginTop: 18,
              backgroundColor: colors.primaryTeal,
              borderRadius: radius.input,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: updatePassword.isPending || !passwordValid ? 0.6 : 1,
            },
            shadows.button,
          ]}
        >
          <Txt weight="semibold" size={15} color={colors.onTealPrimary}>
            {updatePassword.isPending ? 'جارٍ الحفظ…' : 'تغيير كلمة المرور'}
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
  if (m.includes('expired') || (m.includes('invalid') && (m.includes('token') || m.includes('otp'))))
    return 'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً.';
  if (m.includes('rate') || m.includes('too many') || m.includes('security purposes'))
    return 'محاولات كثيرة، حاول لاحقًا.';
  if (m.includes('password')) return 'كلمة المرور ضعيفة أو غير صالحة.';
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

const readOnlyBoxStyle = {
  minHeight: 46,
  justifyContent: 'center' as const,
  borderWidth: 1,
  borderColor: colors.borderSand2,
  borderRadius: radius.input,
  backgroundColor: colors.surfaceInset,
  paddingHorizontal: 14,
  paddingVertical: 8,
};
