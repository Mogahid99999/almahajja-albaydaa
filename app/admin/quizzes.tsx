/**
 * Admin quizzes list — /admin/quizzes (PRD §12.1/§12.5 entry point).
 *
 * Quizzes grouped by section with status pills, quick publish/unpublish,
 * results link, edit and delete. Creation happens in /admin/quiz-edit.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import type { AdminQuizRow } from '@/api/types';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useAdminQuizzes, useDeleteQuiz, useSetQuizStatus } from '@/hooks/useQuizzes';
import { arNum, arQuestionCount } from '@/lib/format';

function StatusPill({ status }: { status: 'draft' | 'published' }) {
  const published = status === 'published';
  return (
    <View
      style={{
        backgroundColor: published ? 'rgba(31,138,91,0.12)' : colors.surfaceInset,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <Txt size={11} weight="semibold" color={published ? colors.stateSuccess : colors.textMuted}>
        {published ? 'منشور' : 'مسودة'}
      </Txt>
    </View>
  );
}

function QuizRow({
  quiz,
  onTogglePublish,
  onDelete,
}: {
  quiz: AdminQuizRow;
  onTogglePublish: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();

  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt size={14} weight="semibold" color={colors.textInk} numberOfLines={1} style={{ flexShrink: 1 }}>
            {quiz.title}
          </Txt>
          <StatusPill status={quiz.status} />
        </View>
        <Txt size={11.5} color={colors.textMuted} tabular>
          {`${arQuestionCount(quiz.questionCount)} · درجة النجاح: ${arNum(quiz.passScore)}`}
        </Txt>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onTogglePublish}
          accessibilityLabel={quiz.status === 'published' ? 'إلغاء النشر' : 'نشر'}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <Feather
            name={quiz.status === 'published' ? 'eye-off' : 'send'}
            size={15}
            color={quiz.status === 'published' ? colors.textMuted : colors.stateSuccess}
          />
        </Pressable>
        <Pressable
          onPress={() =>
            router.push(`/admin/quiz-results?id=${quiz.id}` as Parameters<typeof router.push>[0])
          }
          accessibilityLabel="النتائج"
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <Feather name="bar-chart-2" size={15} color={colors.accentBrassMuted} />
        </Pressable>
        <Pressable
          onPress={() =>
            router.push(`/admin/quiz-edit?id=${quiz.id}` as Parameters<typeof router.push>[0])
          }
          accessibilityLabel="تعديل"
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <Feather name="edit-2" size={15} color={colors.primaryTeal} />
        </Pressable>
        <Pressable
          onPress={onDelete}
          accessibilityLabel="حذف"
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <Feather name="trash-2" size={15} color={colors.stateDanger} />
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminQuizzesScreen() {
  const router = useRouter();
  const { data: quizzes = [], isLoading } = useAdminQuizzes();
  const deleteQuiz = useDeleteQuiz();
  const setStatus = useSetQuizStatus();
  const [pendingDelete, setPendingDelete] = useState<AdminQuizRow | null>(null);
  // Publishing fans out a real push notification to every opted-in student
  // (0018_quiz_publish_notify.sql) — confirm before that transition, same as
  // lectures. Unpublishing never notifies, so it goes through immediately.
  const [pendingPublish, setPendingPublish] = useState<AdminQuizRow | null>(null);

  function handleTogglePublish(quiz: AdminQuizRow) {
    if (quiz.status === 'published') {
      setStatus.mutate({ quizId: quiz.id, status: 'draft' });
      return;
    }
    setPendingPublish(quiz);
  }

  const groups = useMemo(() => {
    const bySection = new Map<string, { title: string; rows: AdminQuizRow[] }>();
    for (const quiz of quizzes) {
      const key = quiz.sectionId;
      if (!bySection.has(key)) {
        bySection.set(key, { title: quiz.sectionTitle ?? 'بدون قسم', rows: [] });
      }
      bySection.get(key)!.rows.push(quiz);
    }
    return [...bySection.values()];
  }, [quizzes]);

  const renderGroup = useCallback(
    ({ item: group }: { item: { title: string; rows: AdminQuizRow[] } }) => (
      <View>
        <Txt weight="semibold" size={15} color={colors.textInk} style={{ marginBottom: 10 }}>
          {group.title}
        </Txt>
        <Card padded={false} style={{ overflow: 'hidden', maxWidth: 860 }}>
          {group.rows.map((quiz, idx) => (
            <React.Fragment key={quiz.id}>
              {idx > 0 ? <Divider /> : null}
              <QuizRow
                quiz={quiz}
                onTogglePublish={() => handleTogglePublish(quiz)}
                onDelete={() => setPendingDelete(quiz)}
              />
            </React.Fragment>
          ))}
        </Card>
      </View>
    ),
    [],
  );

  const header = (
    <View style={styles.pageHeader}>
      <Pressable
        onPress={() => router.push('/admin/quiz-edit' as Parameters<typeof router.push>[0])}
        style={({ pressed }) => [styles.createBtn, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
      >
        <Feather name="plus" size={16} color={colors.onTealPrimary} style={{ marginLeft: 6 }} />
        <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
          اختبار جديد
        </Txt>
      </Pressable>
      <View>
        <Txt weight="display" size={27} color={colors.primaryTeal}>
          الاختبارات
        </Txt>
        <Txt size={13} color={colors.textMuted} style={{ marginTop: 4 }}>
          {`${arNum(quizzes.length)} اختبار · تُعرض للطلاب على صفحة القسم بعد النشر`}
        </Txt>
      </View>
    </View>
  );

  return (
    <AdminShell active="quizzes" breadcrumb="الاختبارات" scroll={false}>
      <FlatList
        style={{ flex: 1 }}
        data={groups}
        keyExtractor={(group) => group.title + group.rows[0].id}
        renderItem={renderGroup}
        ItemSeparatorComponent={() => <View style={{ height: 24 }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          isLoading ? (
            <Card>
              <Txt size={13} color={colors.textGhost} align="center">
                جارٍ التحميل...
              </Txt>
            </Card>
          ) : (
            <Card>
              <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
                <Feather name="check-square" size={26} color={colors.accentBrassSoft} />
                <Txt size={13.5} weight="semibold" color={colors.textMuted} align="center">
                  لا توجد اختبارات بعد
                </Txt>
                <Txt size={12} color={colors.textGhost} align="center">
                  أنشئ أول اختبار وعلّقه على قسم أو عنصر داخلي.
                </Txt>
              </View>
            </Card>
          )
        }
      />

      <ConfirmDialog
        visible={!!pendingDelete}
        title="حذف الاختبار"
        message={`سيتم حذف «${pendingDelete?.title ?? ''}» مع أسئلته ونتائج الطلاب المرتبطة به.`}
        confirmLabel="حذف"
        pending={deleteQuiz.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteQuiz.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        visible={!!pendingPublish}
        destructive={false}
        title="نشر الاختبار؟"
        message={`سيصل إشعار فوري إلى جميع الدارسين بأن اختبار «${pendingPublish?.title ?? ''}» متاح الآن.`}
        confirmLabel="نشر"
        cancelLabel="تراجع"
        pending={setStatus.isPending}
        onConfirm={() => {
          if (!pendingPublish) return;
          setStatus.mutate(
            { quizId: pendingPublish.id, status: 'published' },
            { onSettled: () => setPendingPublish(null) },
          );
        }}
        onCancel={() => setPendingPublish(null)}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
  } as ViewStyle,

  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    ...shadows.button,
  } as ViewStyle,

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 60,
  } as ViewStyle,

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  } as ViewStyle,

  iconBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  } as ViewStyle,
});
