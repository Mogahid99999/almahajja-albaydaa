/**
 * Buddy search — اختيار رفيق الدراسة (26.2).
 *
 * Same-gender candidates only (the filter is enforced inside the
 * search_buddy_candidates SECURITY DEFINER SQL, never here). Debounced Arabic
 * search, candidate rows with streak days, and a confirmation sheet before the
 * invitation is sent. Students without a gender on their profile are asked to
 * set it in تعديل الملف first.
 *
 * Route: /(student)/buddy-search
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { BuddyCandidate } from '@/api/types';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { arDayCount } from '@/lib/format';
import { useCurrentUser } from '@/hooks/useAuth';
import { useBuddySearch, useSendBuddyRequest } from '@/hooks/useBuddy';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';

export default function BuddySearchScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const [query, setQuery] = useState('');
  const [candidate, setCandidate] = useState<BuddyCandidate | null>(null);
  const { data: candidates, isLoading } = useBuddySearch(query);
  const send = useSendBuddyRequest();
  const miniPad = useMiniPlayerPad();

  const isGuest = user?.isGuest ?? true;
  const hasGender = !!user?.gender;

  const onConfirmSend = () => {
    if (!candidate) return;
    send.mutate(candidate.id, {
      onSuccess: () => {
        setCandidate(null);
        router.back();
      },
    });
  };

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded>
      {/* ── Nav row ─────────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 22,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          اختيار رفيق الدراسة
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      {isGuest ? (
        /* Study-buddy pairing requires a registered account (same nudge as quizzes) */
        <Card style={{ alignItems: 'center', paddingVertical: 26, gap: 12 }}>
          <Feather name="user-plus" size={26} color={colors.accentBrassMuted} />
          <Txt size={14} color={colors.textSlate} align="center" style={{ lineHeight: 22 }}>
            اختيار رفيق دراسة يتطلب حسابًا — حتى تبقى الرفقة معك
          </Txt>
          <Pressable
            onPress={() => router.push('/(auth)/register')}
            accessibilityRole="button"
            style={({ pressed }) => [
              {
                backgroundColor: colors.primaryTeal,
                borderRadius: radius.input,
                paddingVertical: 12,
                paddingHorizontal: 26,
                opacity: pressed ? 0.85 : 1,
              },
              shadows.button,
            ]}
          >
            <Txt size={13.5} weight="semibold" color={colors.onTealPrimary}>
              إنشاء حساب
            </Txt>
          </Pressable>
        </Card>
      ) : !hasGender ? (
        /* Gender must be set before searching (segregation needs it) */
        <Card style={{ alignItems: 'center', paddingVertical: 26, gap: 12 }}>
          <Feather name="user-check" size={26} color={colors.accentBrassMuted} />
          <Txt size={14} color={colors.textSlate} align="center" style={{ lineHeight: 22 }}>
            لاختيار رفيق دراسة، يرجى تحديد الجنس أولاً من تعديل الملف الشخصي
          </Txt>
          <Pressable
            onPress={() => router.push('/(student)/edit-profile')}
            accessibilityRole="button"
            style={({ pressed }) => [
              {
                backgroundColor: colors.primaryTeal,
                borderRadius: radius.input,
                paddingVertical: 12,
                paddingHorizontal: 26,
                opacity: pressed ? 0.85 : 1,
              },
              shadows.button,
            ]}
          >
            <Txt size={13.5} weight="semibold" color={colors.onTealPrimary}>
              تعديل الملف الشخصي
            </Txt>
          </Pressable>
        </Card>
      ) : (
        <>
          {/* Search input */}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="ابحث بالاسم…"
            placeholderTextColor={colors.textGhost}
            style={{
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
              marginBottom: 16,
            }}
          />

          {isLoading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primaryTeal} />
            </View>
          ) : (candidates ?? []).length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', gap: 8 }}>
              <Feather name="users" size={24} color={colors.textGhost} />
              <Txt size={13} color={colors.textMuted} align="center">
                لا نتائج بعد — جرّب اسماً آخر
              </Txt>
            </View>
          ) : (
            (candidates ?? []).map((c) => (
              <Card key={c.id} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: 'rgba(31,74,66,0.09)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Txt weight="display" size={16} color={colors.primaryTeal} centerGlyph>
                      {c.displayName.trim().charAt(0)}
                    </Txt>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Txt size={14.5} weight="medium" color={colors.textInk}>
                      {c.displayName}
                    </Txt>
                    <Txt size={11.5} color={colors.textMuted} style={{ marginTop: 2 }}>
                      {c.currentStreak > 0
                        ? `مداومة: ${arDayCount(c.currentStreak)}`
                        : 'بدأ رحلته قريباً'}
                    </Txt>
                  </View>

                  <Pressable
                    onPress={() => setCandidate(c)}
                    accessibilityRole="button"
                    accessibilityLabel={`إرسال دعوة إلى ${c.displayName}`}
                    style={({ pressed }) => ({
                      paddingVertical: 9,
                      paddingHorizontal: 14,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: colors.primaryTeal,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Txt size={12.5} weight="semibold" color={colors.primaryTeal}>
                      إرسال دعوة
                    </Txt>
                  </Pressable>
                </View>
              </Card>
            ))
          )}
        </>
      )}

      {/* ── Confirmation sheet ─────────────────────────────────────────────── */}
      <Modal
        visible={!!candidate}
        transparent
        animationType="slide"
        onRequestClose={() => setCandidate(null)}
      >
        <Pressable
          onPress={() => setCandidate(null)}
          style={{ flex: 1, backgroundColor: 'rgba(22,53,47,0.35)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.bgSandRaised,
              borderTopLeftRadius: radius.artwork,
              borderTopRightRadius: radius.artwork,
              paddingHorizontal: 22,
              paddingTop: 18,
              paddingBottom: 34,
              gap: 14,
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 44,
                height: 5,
                borderRadius: 3,
                backgroundColor: colors.borderSand2,
              }}
            />

            <Txt weight="display" size={19} color={colors.primaryTeal} align="center">
              دعوة رفيق دراسة
            </Txt>

            <Txt size={13.5} color={colors.textSlate} align="center" style={{ lineHeight: 22 }}>
              {user?.gender === 'female'
                ? `هل تريدين دعوة ${candidate?.displayName ?? ''} لتكون رفيقتك في طلب العلم؟`
                : `هل تريد دعوة ${candidate?.displayName ?? ''} ليكون رفيقك في طلب العلم؟`}
            </Txt>

            {send.isError ? (
              <Txt size={12} color={colors.stateDanger} align="center">
                {(send.error as Error).message}
              </Txt>
            ) : null}

            <Pressable
              onPress={onConfirmSend}
              disabled={send.isPending}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingVertical: 14,
                borderRadius: radius.input,
                alignItems: 'center',
                backgroundColor: colors.primaryTeal,
                opacity: pressed || send.isPending ? 0.7 : 1,
              })}
            >
              <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
                {send.isPending ? 'جارٍ الإرسال…' : 'إرسال الدعوة'}
              </Txt>
            </Pressable>

            <Pressable
              onPress={() => setCandidate(null)}
              accessibilityRole="button"
              style={({ pressed }) => ({ alignItems: 'center', paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}
            >
              <Txt size={13} color={colors.textMuted}>
                إلغاء
              </Txt>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
