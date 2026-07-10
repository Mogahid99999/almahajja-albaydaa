/**
 * Admin dashboard landing — /admin  (admin only; publishers are redirected).
 *
 * Calm number tiles from live SECURITY DEFINER RPCs (no charts, no competitive
 * framing) + two short "top" lists, then quick links and the latest lectures.
 * All numerals via arNum. Cards flex-wrap so the page never scrolls sideways
 * on a phone.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useAdminLectures, useUnclassifiedLectures } from '@/hooks/useAdmin';
import { useAdminStats } from '@/hooks/useAdminStats';
import { useAdminOnly } from '@/hooks/useAdminGuard';
import { useAdminReports } from '@/hooks/useReports';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { arDuration, arNum, toArabicDigits } from '@/lib/format';

function arHours(h: number): string {
  return `${toArabicDigits(String(h).replace('.', '٫'))} ساعة`;
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
  accent?: boolean;
  href?: string;
}

function StatCard({ label, value, icon, accent = false, href }: StatCardProps) {
  const router = useRouter();
  const inner = (
    <Card style={styles.statCard}>
      <View
        style={[
          styles.statIcon,
          { backgroundColor: accent ? colors.primaryTeal : colors.surfaceInset },
        ]}
      >
        <Feather name={icon} size={18} color={accent ? colors.onTealPrimary : colors.textMuted} />
      </View>
      <Txt weight="display" size={26} color={colors.primaryTeal} style={styles.statValue}>
        {value}
      </Txt>
      <Txt size={12} color={colors.textMuted}>
        {label}
      </Txt>
    </Card>
  );
  if (!href) return inner;
  return (
    <Pressable
      onPress={() => router.push(href as Parameters<typeof router.push>[0])}
      style={({ pressed }) => [styles.statPressable, pressed && { opacity: 0.85 }]}
    >
      {inner}
    </Pressable>
  );
}

// ─── Urgent reports banner ─────────────────────────────────────────────────────

function UrgentReportsBanner({ count }: { count: number }) {
  const router = useRouter();
  if (count === 0) return null;
  return (
    <Pressable
      onPress={() => router.push('/admin/reports' as Parameters<typeof router.push>[0])}
      style={({ pressed }) => [styles.urgentBanner, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.urgentIcon}>
        <Feather name="flag" size={18} color={colors.onTealPrimary} />
      </View>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Txt weight="semibold" size={14} color={colors.stateDanger}>
          {arNum(count)} {count === 1 ? 'بلاغ مفتوح' : 'بلاغات مفتوحة'} بحاجة إلى مراجعة
        </Txt>
        <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
          اضغط لمراجعة البلاغات الآن
        </Txt>
      </View>
      <Feather name="chevron-left" size={16} color={colors.stateDanger} />
    </Pressable>
  );
}

// ─── Top list card ────────────────────────────────────────────────────────────

function TopList({
  title,
  icon,
  rows,
  empty,
}: {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  rows: { label: string; value: string }[];
  empty: string;
}) {
  return (
    <Card padded={false} style={styles.topCard}>
      <View style={styles.topHeader}>
        <Feather name={icon} size={16} color={colors.primaryTeal} />
        <Txt weight="semibold" size={14} color={colors.textInk} style={{ marginRight: 8 }}>
          {title}
        </Txt>
      </View>
      <Divider />
      {rows.length === 0 ? (
        <Txt size={12} color={colors.textMuted} align="center" style={{ padding: 16 }}>
          {empty}
        </Txt>
      ) : (
        rows.map((r, i) => (
          <React.Fragment key={`${r.label}-${i}`}>
            <View style={styles.topRow}>
              <Txt size={12} color={colors.textFaint} tabular>
                {r.value}
              </Txt>
              <Txt size={13} color={colors.textInk} numberOfLines={1} style={{ flex: 1 }}>
                {r.label}
              </Txt>
            </View>
            {i < rows.length - 1 && <Divider />}
          </React.Fragment>
        ))
      )}
    </Card>
  );
}

// ─── Quick link ───────────────────────────────────────────────────────────────

function QuickLink({
  title,
  desc,
  href,
  icon,
}: {
  title: string;
  desc: string;
  href: string;
  icon: keyof typeof Feather.glyphMap;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(href as Parameters<typeof router.push>[0])}
      style={({ pressed }) => [styles.quickLink, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.quickLinkIcon}>
        <Feather name={icon} size={20} color={colors.onTealPrimary} />
      </View>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Txt weight="semibold" size={14} color={colors.textInk}>
          {title}
        </Txt>
        <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
          {desc}
        </Txt>
      </View>
      <Feather name="chevron-left" size={16} color={colors.textGhost} />
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const DASH = '—';

export default function AdminHome() {
  const role = useAdminOnly();
  const { data: stats, refetch: refetchStats } = useAdminStats(role === 'admin');
  const { data: lectures = [], refetch: refetchLectures } = useAdminLectures();
  const { data: unclassified = [], refetch: refetchUnclassified } = useUnclassifiedLectures();
  const { data: openReports = [], refetch: refetchReports } = useAdminReports('open', role === 'admin');
  const { refreshing, onRefresh } = usePullToRefresh([
    refetchLectures,
    refetchUnclassified,
    ...(role === 'admin' ? [refetchStats, refetchReports] : []),
  ]);

  const draftCount = lectures.filter((l) => l.status === 'draft').length;
  const incomingCount = unclassified.length;
  const latest = lectures.filter((l) => l.status === 'published').slice(0, 5);

  const n = (v: number | undefined) => (v === undefined ? DASH : arNum(v));
  const h = (v: number | undefined) => (v === undefined ? DASH : arHours(v));

  return (
    <AdminShell
      active="dashboard"
      breadcrumb="لوحة المعلومات"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        لوحة المعلومات
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        نظرة عامة على المنصة والطلاب
      </Txt>

      <UrgentReportsBanner count={openReports.length} />

      {/* People */}
      <Txt weight="semibold" size={14} color={colors.textInk} style={styles.groupHeading}>
        الطلاب
      </Txt>
      <View style={styles.statsRow}>
        <StatCard label="إجمالي الطلاب" value={n(stats?.totalUsers)} icon="users" accent href="/admin/users" />
        <StatCard label="المسجّلون" value={n(stats?.registeredUsers)} icon="user-check" href="/admin/users" />
        <StatCard label="النشطون اليوم" value={n(stats?.activeToday)} icon="activity" href="/admin/users" />
        <StatCard label="الجدد هذا الأسبوع" value={n(stats?.newUsersWeek)} icon="user-plus" href="/admin/users" />
        <StatCard label="الجدد هذا الشهر" value={n(stats?.newUsersMonth)} icon="calendar" href="/admin/users" />
      </View>

      {/* Content + listening */}
      <Txt weight="semibold" size={14} color={colors.textInk} style={styles.groupHeading}>
        المحتوى والاستماع
      </Txt>
      <View style={styles.statsRow}>
        <StatCard label="محاضرات منشورة" value={n(stats?.lecturesPublished)} icon="headphones" href="/admin/lectures" />
        <StatCard label="الأقسام" value={n(stats?.sectionsCount)} icon="folder" href="/admin/sections" />
        <StatCard label="اختبارات منشورة" value={n(stats?.publishedQuizzes)} icon="check-square" href="/admin/quizzes" />
        <StatCard label="مسودة" value={arNum(draftCount)} icon="edit-3" href="/admin/lectures" />
        <StatCard label="واردة للمراجعة" value={arNum(incomingCount)} icon="inbox" href="/admin/unclassified" />
        <StatCard label="ساعات الاستماع" value={h(stats?.listenHoursTotal)} icon="clock" />
        <StatCard label="الاستماع هذا الشهر" value={h(stats?.listenHoursMonth)} icon="trending-up" />
      </View>

      {/* Top lists */}
      <View style={styles.topGrid}>
        <TopList
          title="أكثر الأقسام استماعًا"
          icon="bar-chart-2"
          empty="لا استماع بعد."
          rows={(stats?.topSections ?? []).map((s) => ({ label: s.title, value: arHours(s.hours) }))}
        />
        <TopList
          title="أكثر الاختبارات حلًّا"
          icon="award"
          empty="لا محاولات بعد."
          rows={(stats?.topQuizzes ?? []).map((q) => ({
            label: q.title,
            value: `${arNum(q.attempts)} محاولة`,
          }))}
        />
      </View>

      {/* Quick links */}
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.sectionHeading}>
        إجراءات سريعة
      </Txt>
      <Card padded={false} style={styles.quickLinksCard}>
        <QuickLink title="إدارة المحاضرات" desc="المنشورة والمسودات والواردة" href="/admin/lectures" icon="headphones" />
        <Divider />
        <QuickLink title="رفع محاضرة جديدة" desc="أضف محاضرة صوتية وصنّفها في الشجرة" href="/admin/upload" icon="upload" />
        <Divider />
        <QuickLink title="تحليلات التقدم العلمي" desc="إكمال الطلاب ومتوسط التقدم في الأقسام" href="/admin/analytics" icon="trending-up" />
        <Divider />
        <QuickLink title="مساحة الأسئلة" desc="أسئلة الطلاب: أجب أو أخفِ أو احذف أو احظر" href="/admin/questions" icon="help-circle" />
        <Divider />
        <QuickLink title="ملاحظات الطلاب" desc="بلاغات مشكلات واقتراحات تحسين مع معلومات الجهاز" href="/admin/feedback" icon="message-circle" />
        <Divider />
        <QuickLink title="إدارة المستخدمين" desc="الحسابات والحالة وكلمات السر" href="/admin/users" icon="user-check" />
      </Card>

      {/* Latest lectures */}
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.sectionHeading}>
        أحدث المحاضرات
      </Txt>
      {latest.length === 0 ? (
        <Card>
          <Txt size={13} color={colors.textMuted} align="center">
            لا توجد محاضرات منشورة بعد.
          </Txt>
        </Card>
      ) : (
        <Card padded={false}>
          {latest.map((lec, idx) => (
            <React.Fragment key={lec.id}>
              <View style={styles.lectureRow}>
                <Txt size={12} color={colors.textGhost} tabular style={styles.lectureDuration}>
                  {arDuration(lec.durationSec)}
                </Txt>
                <View style={{ flex: 1 }}>
                  <Txt size={13} weight="semibold" color={colors.textInk} numberOfLines={1}>
                    {lec.title}
                  </Txt>
                  {lec.sheikhName && (
                    <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
                      {lec.sheikhName}
                    </Txt>
                  )}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: 'rgba(31,138,91,0.1)' }]}>
                  <Txt size={11} color={colors.stateSuccess} weight="semibold">
                    منشورة
                  </Txt>
                </View>
              </View>
              {idx < latest.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </Card>
      )}
    </AdminShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 24 } as TextStyle,

  urgentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(184,92,74,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(184,92,74,0.3)',
    borderRadius: radius.card,
    padding: 14,
    marginBottom: 20,
    ...shadows.button,
  } as ViewStyle,

  urgentIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.stateDanger,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  groupHeading: { marginBottom: 12, marginTop: 4 } as TextStyle,

  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  } as ViewStyle,

  // Responsive: 2-up on a phone, more per row on wide — never a fixed width.
  statPressable: {
    flexBasis: 150,
    flexGrow: 1,
    minWidth: 140,
    maxWidth: 260,
  } as ViewStyle,

  statCard: {
    flexBasis: 150,
    flexGrow: 1,
    minWidth: 140,
    maxWidth: 260,
    gap: 8,
    alignItems: 'flex-end',
  } as ViewStyle,

  statIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  statValue: { lineHeight: 32 } as TextStyle,

  topGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 28,
  } as ViewStyle,

  topCard: {
    flexBasis: 260,
    flexGrow: 1,
    minWidth: 240,
    overflow: 'hidden',
  } as ViewStyle,

  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  } as ViewStyle,

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  } as ViewStyle,

  sectionHeading: { marginBottom: 12, marginTop: 4 } as TextStyle,

  quickLinksCard: { marginBottom: 28, overflow: 'hidden' } as ViewStyle,

  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  } as ViewStyle,

  quickLinkIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  } as ViewStyle,

  lectureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  } as ViewStyle,

  lectureDuration: { width: 52, textAlign: 'left' } as TextStyle,

  statusBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  } as ViewStyle,
});
