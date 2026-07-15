/**
 * Edit profile — تعديل الملف الشخصي (Task 2 / V7, extended for phone registration).
 *
 * Name and gender are entered once at registration under an identity oath
 * (Item 10) and are permanently read-only afterward for every account, shown
 * here for reference only.
 *
 * Phone, email, and password are collapsed-by-default rows (tap to expand) so
 * the screen reads as a calm settings list instead of three forms stacked on
 * top of each other — only one section is open at a time.
 *
 * Phone is a self-service, INSTANT change — no OTP is ever sent (project has
 * `sms_autoconfirm` on), unlike email. Email is a two-step change: saving a
 * new address sends a 6-digit code to it (does NOT apply immediately — email
 * is the password-recovery channel, so an unverified/typo'd address must
 * never silently become it), and entering that code completes the change.
 *
 * Password change requires the CURRENT password (re-authenticates before
 * writing the new one) — unlike the admin's "set new password with no old"
 * action, the session alone isn't treated as sufficient proof here.
 *
 * Only reachable by registered users (the profile screen gates the entry on
 * !isGuest).
 *
 * Route: /(student)/edit-profile
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { Gender } from '@/api/types';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import {
  useChangePassword,
  useChangePhone,
  useCurrentUser,
  useRequestEmailChange,
  useVerifyEmailChange,
} from '@/hooks/useAuth';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { arabicAuthError } from '@/lib/authErrors';
import { arNum } from '@/lib/format';

const GENDER_LABEL: Record<Gender, string> = { male: 'ذكر', female: 'أنثى' };
const OTP_LENGTH = 6; // must match Supabase `mailer_otp_length` — see reset-password.tsx

type Section = 'phone' | 'email' | 'password' | null;

export default function EditProfileScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const requestEmailChange = useRequestEmailChange();
  const verifyEmailChange = useVerifyEmailChange();
  const changePassword = useChangePassword();
  const changePhone = useChangePhone();
  const miniPad = useMiniPlayerPad();

  // Only one of phone/email/password is open at a time — keeps the screen a
  // calm list of rows instead of three forms competing for attention.
  const [open, setOpen] = useState<Section>(null);
  const toggle = (s: Exclude<Section, null>) => setOpen((cur) => (cur === s ? null : s));

  const [email, setEmail] = useState(user?.email ?? '');
  // Non-null once a code has been sent — the address it was sent to.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [emailNotice, setEmailNotice] = useState<{ msg: string; type: 'success' | 'error' } | null>(
    null,
  );

  const [phone, setPhone] = useState(user?.phone ?? '');
  const [phoneNotice, setPhoneNotice] = useState<{ msg: string; type: 'success' | 'error' } | null>(
    null,
  );

  const [currentPassword, setCurrentPassword] = useState('');
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
      onError: (e) => setEmailNotice({ msg: arabicAuthError(e), type: 'error' }),
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
          setOpen(null);
        },
        onError: (e) => setEmailNotice({ msg: arabicAuthError(e), type: 'error' }),
      },
    );
  };

  const phoneDigits = phone.replace(/[^0-9]/g, '');
  const phoneChanged = phoneDigits.length >= 8 && phoneDigits !== (user?.phone ?? '');
  const onSavePhone = () => {
    if (!phoneChanged) return;
    setPhoneNotice(null);
    changePhone.mutate(phoneDigits, {
      onSuccess: () => {
        setPhoneNotice({ msg: 'تم تحديث رقم الهاتف بنجاح', type: 'success' });
        setOpen(null);
      },
      onError: (e) => setPhoneNotice({ msg: arabicAuthError(e), type: 'error' }),
    });
  };

  // Min 8 matches the server (Supabase password_min_length) — a shorter gate
  // here let 6–7-char passwords through to a server rejection after the
  // current-password re-auth had already succeeded.
  const passwordValid =
    currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;
  const onSavePassword = () => {
    if (!passwordValid) return;
    setPasswordNotice(null);
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setPasswordNotice({ msg: 'تم تغيير كلمة المرور بنجاح', type: 'success' });
          setOpen(null);
        },
        onError: (e) => setPasswordNotice({ msg: arabicAuthError(e), type: 'error' }),
      },
    );
  };

  return (
    // Keyboard-avoid (same fix as sign-in/register/reset-password): the app is
    // edge-to-edge, so the keyboard OVERLAYS the screen instead of resizing it —
    // without this the password section's lower fields + save button sit under
    // the keyboard with no scroll escape.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    {/* Extra bottom padding (beyond the usual mini-player clearance) — the
        password section is the tallest expandable row (3 fields + button) and
        without this its Save button could land under the system nav bar with
        no more room to scroll past it. */}
    <Screen bottomPad={(miniPad || 24) + 60 + BOTTOM_NAV_CLEARANCE} padded>
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
        <View>
          <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
            النوع
          </Txt>
          <View style={readOnlyBoxStyle}>
            <Txt size={14} color={colors.textInk}>
              {user?.gender ? GENDER_LABEL[user.gender] : '—'}
            </Txt>
          </View>
        </View>

        <Txt size={11} color={colors.textGhost} style={{ marginTop: 12 }}>
          لا يمكن تعديل الاسم أو الجنس من هنا — تواصل مع الإدارة عند الحاجة
        </Txt>
      </Card>

      <Card padded={false} style={{ marginTop: 16, overflow: 'hidden' }}>
        {/* ── Phone ── */}
        <SettingRow
          label="رقم الهاتف"
          value={user?.phone || '—'}
          expanded={open === 'phone'}
          onToggle={() => toggle('phone')}
        />
        {open === 'phone' ? (
          <View style={sectionBodyStyle}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="09xxxxxxxx"
              placeholderTextColor={colors.textGhost}
              keyboardType="phone-pad"
              style={inputStyle}
            />
            <Pressable
              onPress={onSavePhone}
              disabled={changePhone.isPending || !phoneChanged}
              style={[saveButtonStyle, { opacity: changePhone.isPending || !phoneChanged ? 0.6 : 1 }]}
            >
              <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
                {changePhone.isPending ? 'جارٍ الحفظ…' : 'حفظ رقم الهاتف'}
              </Txt>
            </Pressable>
          </View>
        ) : null}
        {phoneNotice ? <NoticeRow notice={phoneNotice} /> : null}

        <Divider />

        {/* ── Email — two-step: a code is sent to the new address and must be
              confirmed before it takes effect (email is the password-recovery
              channel). ── */}
        <SettingRow
          label="البريد الإلكتروني"
          value={user?.email || '—'}
          expanded={open === 'email'}
          onToggle={() => toggle('email')}
        />
        {open === 'email' ? (
          <View style={sectionBodyStyle}>
            {pendingEmail ? (
              <>
                <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 10, lineHeight: 19 }}>
                  أرسلنا رمزاً مكوّناً من {arNum(OTP_LENGTH)} أرقام إلى{' '}
                  <Txt size={12.5} weight="semibold" color={colors.textSlate}>
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
                  style={[inputStyle, { textAlign: 'center', letterSpacing: 8, fontSize: 18 }]}
                />
                <Pressable
                  onPress={onConfirmCode}
                  disabled={verifyEmailChange.isPending || emailCode.trim().length < OTP_LENGTH}
                  style={[
                    saveButtonStyle,
                    { opacity: verifyEmailChange.isPending || emailCode.trim().length < OTP_LENGTH ? 0.6 : 1 },
                  ]}
                >
                  <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
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
                  style={{ alignItems: 'center', marginTop: 10 }}
                >
                  <Txt size={12} weight="semibold" color={colors.textMuted}>
                    رجوع
                  </Txt>
                </Pressable>
              </>
            ) : (
              <>
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
                    تغيير البريد يتطلب تأكيد رمز يُرسل إليه
                  </Txt>
                )}
                <Pressable
                  onPress={onSendCode}
                  disabled={requestEmailChange.isPending || !emailChanged}
                  style={[
                    saveButtonStyle,
                    { opacity: requestEmailChange.isPending || !emailChanged ? 0.6 : 1 },
                  ]}
                >
                  <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
                    {requestEmailChange.isPending ? 'جارٍ الإرسال…' : 'إرسال رمز التأكيد'}
                  </Txt>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
        {emailNotice ? <NoticeRow notice={emailNotice} /> : null}

        <Divider />

        {/* ── Password — requires the current password first ── */}
        <SettingRow
          label="كلمة المرور"
          value="تغيير كلمة المرور"
          expanded={open === 'password'}
          onToggle={() => toggle('password')}
        />
        {open === 'password' ? (
          <View style={sectionBodyStyle}>
            <TextInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="كلمة المرور الحالية"
              placeholderTextColor={colors.textGhost}
              secureTextEntry
              autoCapitalize="none"
              style={[inputStyle, { marginBottom: 10 }]}
            />
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="كلمة المرور الجديدة (٨ أحرف على الأقل)"
              placeholderTextColor={colors.textGhost}
              secureTextEntry
              autoCapitalize="none"
              style={[inputStyle, { marginBottom: 10 }]}
            />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="أعد كتابة كلمة المرور الجديدة"
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
            <Pressable
              onPress={onSavePassword}
              disabled={changePassword.isPending || !passwordValid}
              style={[saveButtonStyle, { opacity: changePassword.isPending || !passwordValid ? 0.6 : 1 }]}
            >
              <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
                {changePassword.isPending ? 'جارٍ الحفظ…' : 'تغيير كلمة المرور'}
              </Txt>
            </Pressable>
          </View>
        ) : null}
        {passwordNotice ? <NoticeRow notice={passwordNotice} /> : null}
      </Card>
    </Screen>
    </KeyboardAvoidingView>
  );
}

/** Collapsed row: label + current value + chevron. Tap to expand/collapse. */
function SettingRow({
  label,
  value,
  expanded,
  onToggle,
}: {
  label: string;
  value: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 18,
          paddingVertical: 16,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Feather
        name={expanded ? 'chevron-up' : 'chevron-left'}
        size={18}
        color={colors.textFaint}
      />
      <View style={{ flex: 1, alignItems: 'flex-end', marginRight: 12 }}>
        <Txt size={14} weight="semibold" color={colors.textInk} numberOfLines={1}>
          {label}
        </Txt>
        {!expanded ? (
          <Txt size={12} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
            {value}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

function NoticeRow({ notice }: { notice: { msg: string; type: 'success' | 'error' } }) {
  return (
    <Txt
      size={12}
      color={notice.type === 'error' ? colors.stateDanger : colors.stateSuccess}
      style={{ paddingHorizontal: 18, paddingBottom: 14, marginTop: -6 }}
    >
      {notice.msg}
    </Txt>
  );
}

const sectionBodyStyle = {
  paddingHorizontal: 18,
  paddingBottom: 18,
};

const inputStyle = {
  minHeight: 44,
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

const saveButtonStyle = [
  {
    marginTop: 12,
    backgroundColor: colors.primaryTeal,
    borderRadius: radius.input,
    paddingVertical: 12,
    alignItems: 'center' as const,
  },
  shadows.button,
];

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
