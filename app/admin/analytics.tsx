/**
 * تحليلات التقدم العلمي — /admin/analytics  (admin only).
 *
 * Aggregate completion counts, per-section average progress, and two
 * admin-PRIVATE student lists (good progress / started-then-stopped). Calm,
 * never student-vs-student — the lists are only ever visible to the admin here.
 */
import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Divider, ProgressBar, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useAdminAnalytics } from '@/hooks/useAdminStats';
import { useAdminOnly } from '@/hooks/useAdminGuard';
import { arNum, arPercent, arSince } from '@/lib/format';
import type { AdminStudentBrief } from '@/api/types';

const DASH = '—';

function CountTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
}) {
  return (
    <Card style={styles.tile}>
      <View style={styles.tileIcon}>
        <Feather name={icon} size={16} color={colors.primaryTeal} />
      </View>
      <Txt weight="display" size={26} color={colors.primaryTeal} style={{ lineHeight: 32 }}>
        {value}
      </Txt>
      <Txt size={12} color={colors.textMuted}>
        {label}
      </Txt>
    </Card>
  );
}

function StudentList({
  title,
  hint,
  icon,
  rows,
  countSuffix,
  empty,
}: {
  title: string;
  hint: string;
  icon: keyof typeof Feather.glyphMap;
  rows: AdminStudentBrief[];
  countSuffix: (n: number) => string;
  empty: string;
}) {
  return (
    <Card padded={false} style={styles.listCard}>
      <View style={styles.listHeader}>
        <Feather name={icon} size={16} color={colors.primaryTeal} />
        <View style={{ marginRight: 8, flex: 1 }}>
          <Txt weight="semibold" size={14} color={colors.textInk}>
            {title}
          </Txt>
          <Txt size={11} color={colors.textFaint} style={{ marginTop: 2 }}>
            {hint}
          </Txt>
        </View>
      </View>
      <Divider />
      {rows.length === 0 ? (
        <Txt size={12} color={colors.textMuted} align="center" style={{ padding: 16 }}>
          {empty}
        </Txt>
      ) : (
        rows.map((r, i) => (
          <React.Fragment key={r.userId}>
            <View style={styles.listRow}>
              <Txt size={11} color={colors.textFaint}>
                {arSince(r.lastOpenedAt)}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt size={13} color={colors.textInk} numberOfLines={1}>
                  {r.displayName || 'طالب'}
                </Txt>
                <Txt size={11} color={colors.textMuted} style={{ marginTop: 1 }}>
                  {countSuffix(r.count)}
                </Txt>
              </View>
            </View>
            {i < rows.length - 1 && <Divider />}
          </React.Fragment>
        ))
      )}
    </Card>
  );
}

export default function AdminAnalytics() {
  useAdminOnly();
  const { data, isLoading } = useAdminAnalytics();

  const n = (v: number | undefined) => (v === undefined ? DASH : arNum(v));
  const sections = data?.sections ?? [];

  return (
    <AdminShell active="analytics" breadcrumb="تحليلات التقدم العلمي">
      <Txt weight="display" size={26} color={colors.primaryTeal} style={{ marginBottom: 4 }}>
        تحليلات التقدم العلمي
      </Txt>
      <Txt size={13} color={colors.textMuted} style={{ marginBottom: 24 }}>
        نظرة هادئة على إكمال الطلاب — لا مقارنة بين طالب وآخر
      </Txt>

      {/* Completion buckets */}
      <View style={styles.tilesRow}>
        <CountTile label="أكمل أول درس" value={n(data?.completedFirst)} icon="play-circle" />
        <CountTile label="أكمل ٥ دروس" value={n(data?.completed5)} icon="check-circle" />
        <CountTile label="أكمل ١٠ دروس" value={n(data?.completed10)} icon="award" />
        <CountTile label="أكمل قسمًا كاملًا" value={n(data?.completedSection)} icon="folder" />
      </View>

      {/* Per-section average progress */}
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
        متوسط التقدم في الأقسام
      </Txt>
      <Card padded={false} style={{ marginBottom: 28, overflow: 'hidden' }}>
        {sections.length === 0 ? (
          <Txt size={13} color={colors.textMuted} align="center" style={{ padding: 18 }}>
            {isLoading ? 'جارٍ التحميل…' : 'لا توجد أقسام فيها محاضرات بعد.'}
          </Txt>
        ) : (
          sections.map((s, i) => (
            <React.Fragment key={`${s.title}-${i}`}>
              <View style={styles.sectionRow}>
                <View style={styles.sectionRowHead}>
                  <Txt size={13} weight="semibold" color={colors.primaryTeal} tabular>
                    {arPercent(s.avgCompletion)}
                  </Txt>
                  <Txt size={13} color={colors.textInk} numberOfLines={1} style={{ flex: 1 }}>
                    {s.title}
                  </Txt>
                </View>
                <ProgressBar value={s.avgCompletion / 100} tint="teal" style={{ marginTop: 8 }} />
                <Txt size={11} color={colors.textFaint} style={{ marginTop: 6 }}>
                  {`${arNum(s.studentsStarted)} طالب بدأوا · ${arNum(s.totalLectures)} درساً`}
                </Txt>
              </View>
              {i < sections.length - 1 && <Divider />}
            </React.Fragment>
          ))
        )}
      </Card>

      {/* Admin-private student lists */}
      <View style={styles.listGrid}>
        <StudentList
          title="طلاب ذوو تقدم جيد"
          hint="أكملوا ٥ دروس فأكثر ونشطون خلال أسبوع"
          icon="thumbs-up"
          rows={data?.goodProgress ?? []}
          countSuffix={(c) => `${arNum(c)} درساً مكتملاً`}
          empty="لا أحد بعد."
        />
        <StudentList
          title="بدأوا ثم توقفوا"
          hint="لديهم دروس غير مكتملة ولم يدخلوا منذ أسبوعين"
          icon="pause-circle"
          rows={data?.startedStopped ?? []}
          countSuffix={(c) => `${arNum(c)} درساً قيد المتابعة`}
          empty="لا أحد بعد."
        />
      </View>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  tilesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 28,
  } as ViewStyle,

  tile: {
    flexBasis: 150,
    flexGrow: 1,
    minWidth: 140,
    maxWidth: 260,
    gap: 8,
    alignItems: 'flex-end',
  } as ViewStyle,

  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceInset,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  heading: { marginBottom: 12, marginTop: 4 } as TextStyle,

  sectionRow: { paddingHorizontal: 16, paddingVertical: 14 } as ViewStyle,

  sectionRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  } as ViewStyle,

  listGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  } as ViewStyle,

  listCard: {
    flexBasis: 280,
    flexGrow: 1,
    minWidth: 250,
    overflow: 'hidden',
  } as ViewStyle,

  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  } as ViewStyle,

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  } as ViewStyle,
});
