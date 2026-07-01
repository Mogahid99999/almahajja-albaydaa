/**
 * Edit profile — تعديل الملف الشخصي (Task 2).
 *
 * Edits the display NAME (stored in the auth user's metadata, synced across
 * devices). The sign-in email is shown read-only: changing it requires an email
 * confirmation step (a security control we keep on) plus a reliable mail
 * provider, so it is intentionally not editable inline here.
 *
 * Route: /(student)/edit-profile
 */
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useCurrentUser, useUpdateProfile } from '@/hooks/useAuth';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { useRouter } from 'expo-router';

export default function EditProfileScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const update = useUpdateProfile();

  const [name, setName] = useState(user?.displayName ?? '');
  const email = user?.email ?? '';

  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed !== (user?.displayName ?? '');

  const onSave = () => {
    if (!changed) return;
    update.mutate({ displayName: trimmed }, { onSuccess: () => router.back() });
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
            placeholder="اسمك الكريم"
            placeholderTextColor={colors.textGhost}
            style={inputStyle}
          />
        </View>

        {/* Email — read-only (sign-in email) */}
        <View>
          <Txt size={13} weight="semibold" color={colors.textSlate} style={{ marginBottom: 7 }}>
            البريد الإلكتروني
          </Txt>
          <View style={[inputStyle, { justifyContent: 'center', backgroundColor: colors.bgSand }]}>
            <Txt size={13.5} color={colors.textMuted} numberOfLines={1}>
              {email}
            </Txt>
          </View>
          <Txt size={11} color={colors.textGhost} style={{ marginTop: 6 }}>
            بريد تسجيل الدخول
          </Txt>
        </View>

        {update.isError ? (
          <Txt size={12} color={colors.stateDanger} style={{ marginTop: 12 }}>
            {(update.error as Error).message}
          </Txt>
        ) : null}

        <Pressable
          onPress={onSave}
          disabled={update.isPending || !changed}
          style={[
            {
              marginTop: 22,
              backgroundColor: colors.primaryTeal,
              borderRadius: radius.input,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: update.isPending || !changed ? 0.6 : 1,
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
