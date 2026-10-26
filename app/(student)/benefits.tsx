/**
 * فوائد الدارسين — one unified page (Concept 1): every visible benefit,
 * newest first, lecture-linked or «فائدة عامة». Anonymous as before; the
 * existing report / delete-own / admin hide+delete+ban paths are unchanged.
 * Registered users add a GENERAL benefit in the box at the top (BenefitComposer);
 * lesson benefits are added inside the lesson, as before.
 * Route: /(student)/benefits (Home door).
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BenefitFeedKind, FeedBenefit } from '@/api/benefits';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { BenefitComposer } from '@/components/benefits/BenefitComposer';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { SourceLink } from '@/components/questions/SourceLink';
import { ReportSheet } from '@/components/reports/ReportSheet';
import { Card, IconButton, Screen, Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useBenefitsFeed, useDeleteMyBenefit } from '@/hooks/useBenefits';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useReportContent } from '@/hooks/useReports';
import { arSince } from '@/lib/format';

const KINDS: { key: BenefitFeedKind; label: string; registeredOnly?: boolean }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'lecture', label: 'من المحاضرات' },
  { key: 'general', label: 'فوائد عامة' },
  { key: 'mine', label: 'فوائدي', registeredOnly: true },
];

function BenefitCard({ b, onReport, onDelete }: { b: FeedBenefit; onReport: () => void; onDelete: () => void }) {
  const fromLesson = !!b.lectureId;
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={styles.meta}>
        <View style={[styles.kindIc, fromLesson ? styles.kindLesson : styles.kindGeneral]}>
          <Feather name={fromLesson ? 'headphones' : 'feather'} size={12} color={fromLesson ? colors.accentBrassMuted : colors.primaryTeal600} />
        </View>
        <Txt size={11.5} color={colors.textGhost} style={{ flex: 1 }}>
          {fromLesson ? 'من درس' : 'فائدة عامة'} · {arSince(b.createdAt)}
        </Txt>
        {b.isMine ? (
          <Pressable onPress={onDelete} accessibilityLabel="حذف فائدتي" hitSlop={6}>
            <Feather name="trash-2" size={14} color={colors.textGhost} />
          </Pressable>
        ) : (
          <Pressable onPress={onReport} accessibilityLabel="الإبلاغ عن هذه الفائدة" hitSlop={6}>
            <Feather name="flag" size={14} color={colors.textGhost} />
          </Pressable>
        )}
      </View>
      <Txt size={14} color={colors.textInk} style={{ marginTop: 8, lineHeight: 27 }}>
        {b.body}
      </Txt>
      {fromLesson ? (
        <SourceLink
          src={{
            lectureId: b.lectureId,
            lectureTitle: b.lectureTitle,
            sectionId: null,
            sectionTitle: b.sectionTitle,
            parentTitle: b.parentTitle,
          }}
        />
      ) : null}
    </Card>
  );
}

export default function BenefitsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const miniPad = useMiniPlayerPad();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const [kind, setKind] = useState<BenefitFeedKind>('all');
  const [reportTarget, setReportTarget] = useState<FeedBenefit | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FeedBenefit | null>(null);
  const feed = useBenefitsFeed(kind);
  const del = useDeleteMyBenefit();
  const report = useReportContent();
  const { refreshing, onRefresh } = usePullToRefresh([() => feed.refetch()]);
  const rows = feed.data?.pages.flat() ?? [];

  const header = (
    <>
      <Txt size={12.5} color={colors.textMuted} style={{ marginBottom: 12, lineHeight: 20 }}>
        ما يقيّده إخوانك من الدروس ومن غيرها، الأحدث أولاً، وتُنشر دون أسماء
      </Txt>
      {!isGuest ? (
        <BenefitComposer
          onPosted={() => {
            if (kind === 'lecture') setKind('all');
          }}
        />
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {KINDS.filter((k) => !(k.registeredOnly && isGuest)).map((k) => {
          const on = k.key === kind;
          return (
            <Pressable
              key={k.key}
              onPress={() => setKind(k.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Txt size={12.5} weight={on ? 'semibold' : 'medium'} color={on ? colors.onTealPrimary : colors.textSlate}>
                {k.label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
      {isGuest ? (
        <Card style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Feather name="user-plus" size={16} color={colors.accentBrassMuted} />
            <Txt size={12.5} color={colors.textMuted} style={{ flex: 1, lineHeight: 20 }}>
              القراءة متاحة للجميع، ومشاركة فائدة تتطلب حساباً — وتُنشر دون اسمك دائماً.
            </Txt>
            <Pressable onPress={() => router.push('/(auth)/register')} hitSlop={6}>
              <Txt size={12.5} weight="semibold" color={colors.primaryTeal}>
                إنشاء حساب
              </Txt>
            </Pressable>
          </View>
        </Card>
      ) : null}
    </>
  );

  return (
    <Screen scroll={false} bottomPad={0} padded>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
          فوائد الدارسين
        </Txt>
      </View>

      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: miniPad + insets.bottom + 24 + BOTTOM_NAV_CLEARANCE }}
        data={rows}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <BenefitCard b={item} onReport={() => setReportTarget(item)} onDelete={() => setPendingDelete(item)} />
        )}
        initialNumToRender={8}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryTeal} colors={[colors.primaryTeal]} />
        }
        ListEmptyComponent={
          feed.isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primaryTeal} />
            </View>
          ) : feed.isError ? (
            <View style={styles.empty}>
              <Feather name="wifi-off" size={22} color={colors.textGhost} />
              <Txt size={13} color={colors.textMuted} align="center">
                تعذّر تحميل الفوائد. اسحب للتحديث.
              </Txt>
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name="feather" size={24} color={colors.textGhost} />
              <Txt size={14} weight="semibold" color={colors.textMuted} align="center">
                {kind === 'mine' ? 'لم تضف فائدة بعد' : 'لا فوائد بعد'}
              </Txt>
              <Txt size={12} color={colors.textGhost} align="center" style={{ lineHeight: 19 }}>
                كن أول من يقيّد فائدة. تُنشر دون اسمك، ويستطيع كل دارس أن ينتفع بها.
              </Txt>
            </View>
          )
        }
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={colors.primaryTeal} style={{ marginVertical: 12 }} /> : null}
      />

      <ReportSheet
        visible={!!reportTarget}
        pending={report.isPending}
        error={report.error instanceof Error ? report.error.message : undefined}
        onClose={() => setReportTarget(null)}
        onSubmit={(reason) => {
          if (!reportTarget) return;
          report.mutate(
            { contentType: 'benefit', contentId: reportTarget.id, reason: reason || undefined },
            { onSuccess: () => setReportTarget(null) },
          );
        }}
      />
      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف الفائدة"
        message="ستُحذف فائدتك نهائياً."
        confirmLabel="حذف"
        pending={del.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          del.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindIc: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  kindLesson: { backgroundColor: 'rgba(201,164,99,0.16)' },
  kindGeneral: { backgroundColor: colors.surfaceInset },
  chips: { gap: 8, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand,
  },
  chipOn: { backgroundColor: colors.primaryTeal, borderColor: colors.primaryTeal },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 16 },
});
