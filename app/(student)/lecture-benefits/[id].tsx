/**
 * فوائد الدارسين — anonymous shared benefits per lesson (V6 Feature C).
 * Route: /(student)/lecture-benefits/[id] (player «أدوات الدرس»).
 *
 * Everyone sees the benefit text with NO author name («تُنشر دون اسمك»). The
 * author may delete their own (is_mine resolved server-side); admin moderation
 * lives in /admin/contributions. Posting is registered-only.
 */
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { LectureBenefit } from '@/api/benefits';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { ReportSheet } from '@/components/reports/ReportSheet';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card, IconButton, Screen, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useAddBenefit, useDeleteOwnBenefit, useLectureBenefits } from '@/hooks/useBenefits';
import { useLecturePlayback } from '@/hooks/useLecture';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { useReportContent } from '@/hooks/useReports';
import { arSince } from '@/lib/format';

function RegisterNudge() {
  const router = useRouter();
  return (
    <Card style={{ marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Feather name="user-plus" size={16} color={colors.accentBrassMuted} />
        <Txt size={12.5} color={colors.textMuted} style={{ flex: 1, lineHeight: 20 }}>
          مشاركة فائدة تتطلب حساباً — وتُنشر دون اسمك دائماً.
        </Txt>
      </View>
      <Pressable
        onPress={() => router.push('/(auth)/register')}
        style={({ pressed }) => [styles.registerBtn, pressed && { opacity: 0.85 }]}
      >
        <Txt size={13.5} weight="semibold" color={colors.onTealPrimary}>
          إنشاء حساب
        </Txt>
      </Pressable>
    </Card>
  );
}

function Composer({ lectureId }: { lectureId: string }) {
  const add = useAddBenefit(lectureId);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  function submit() {
    const text = body.trim();
    if (!text) return;
    setError('');
    add.mutate(text, {
      onSuccess: () => setBody(''),
      onError: (e) => setError(e instanceof Error ? e.message : 'تعذّر نشر الفائدة'),
    });
  }

  return (
    <Card style={{ marginBottom: 18 }}>
      <Txt weight="semibold" size={14} color={colors.textInk}>
        شارك فائدة استفدتها من الدرس
      </Txt>
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="اكتب الفائدة هنا..."
        placeholderTextColor={colors.textGhost}
        multiline
        textAlign="right"
        textAlignVertical="top"
        style={styles.composerInput}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <Feather name="eye-off" size={12} color={colors.textGhost} />
        <Txt size={11.5} color={colors.textGhost}>
          تُنشر دون اسمك
        </Txt>
      </View>
      {error ? (
        <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
          {error}
        </Txt>
      ) : null}
      <Pressable
        onPress={submit}
        disabled={add.isPending || !body.trim()}
        style={({ pressed }) => [
          styles.submitBtn,
          { opacity: pressed || add.isPending || !body.trim() ? 0.7 : 1 },
        ]}
      >
        {add.isPending ? (
          <ActivityIndicator size="small" color={colors.onTealPrimary} />
        ) : (
          <Txt size={13.5} weight="semibold" color={colors.onTealPrimary}>
            نشر الفائدة
          </Txt>
        )}
      </Pressable>
    </Card>
  );
}

function BenefitCard({
  b,
  onDelete,
  onReport,
}: {
  b: LectureBenefit;
  onDelete?: () => void;
  onReport: () => void;
}) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={styles.benefitMark}>
          <Feather name="award" size={13} color={colors.accentBrassMuted} />
        </View>
        <Txt size={11.5} color={colors.textGhost} style={{ flex: 1 }}>
          {b.isMine ? 'فائدتك · دون اسم' : 'أحد الدارسين'} · {arSince(b.createdAt)}
        </Txt>
        <Pressable
          onPress={onReport}
          accessibilityLabel="الإبلاغ عن هذه الفائدة"
          style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
        >
          <Feather name="flag" size={14} color={colors.textGhost} />
        </Pressable>
        {onDelete ? (
          <Pressable
            onPress={onDelete}
            accessibilityLabel="حذف فائدتي"
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
          >
            <Feather name="trash-2" size={14} color={colors.stateDanger} />
          </Pressable>
        ) : null}
      </View>
      <Txt size={14} color={colors.textInk} style={{ marginTop: 8, lineHeight: 24 }}>
        {b.body}
      </Txt>
    </Card>
  );
}

export default function LectureBenefitsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: lecture } = useLecturePlayback(id ?? '');
  const { data: benefits, isLoading } = useLectureBenefits(id ?? '');
  const deleteOwn = useDeleteOwnBenefit(id ?? '');
  const [pendingDelete, setPendingDelete] = useState<LectureBenefit | null>(null);
  const [reportTarget, setReportTarget] = useState<LectureBenefit | null>(null);
  const reportContent = useReportContent();
  const miniPad = useMiniPlayerPad();

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          فوائد الدارسين
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>
      {lecture?.title ? (
        <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 18 }} numberOfLines={2}>
          {lecture.title}
        </Txt>
      ) : (
        <View style={{ marginBottom: 18 }} />
      )}

      {isGuest ? <RegisterNudge /> : id ? <Composer lectureId={id} /> : null}

      {isLoading ? (
        <View style={{ paddingVertical: 50, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
      ) : (benefits ?? []).length === 0 ? (
        <View style={{ paddingVertical: 50, alignItems: 'center', gap: 8 }}>
          <Feather name="award" size={24} color={colors.textGhost} />
          <Txt size={13.5} color={colors.textMuted} align="center">
            لا فوائد بعد
          </Txt>
          <Txt size={12} color={colors.textGhost} align="center">
            شارك أول فائدة — تُنشر دون اسمك
          </Txt>
        </View>
      ) : (
        (benefits ?? []).map((b) => (
          <BenefitCard
            key={b.id}
            b={b}
            onDelete={b.isMine ? () => setPendingDelete(b) : undefined}
            onReport={() => setReportTarget(b)}
          />
        ))
      )}

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف الفائدة"
        message="ستُحذف فائدتك نهائياً. هل أنت متأكد؟"
        confirmLabel="حذف"
        pending={deleteOwn.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteOwn.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <ReportSheet
        visible={!!reportTarget}
        pending={reportContent.isPending}
        error={reportContent.error instanceof Error ? reportContent.error.message : undefined}
        onClose={() => setReportTarget(null)}
        onSubmit={(reason) => {
          if (!reportTarget) return;
          reportContent.mutate(
            { contentType: 'benefit', contentId: reportTarget.id, reason: reason || undefined },
            { onSuccess: () => setReportTarget(null) },
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  composerInput: {
    minHeight: 80,
    marginTop: 12,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textInk,
  } as TextStyle,

  submitBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  registerBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,

  benefitMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(176,137,79,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  deleteBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  } as ViewStyle,
});
