/**
 * Admin dashboard landing — /admin
 *
 * Stat cards from live hooks, quick-link cards, latest lectures list.
 * All numerals via arNum. Calm, no charts.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows, spacing } from '@/constants/theme';
import { useAdminLectures, useUnclassifiedLectures } from '@/hooks/useAdmin';
import { useSectionsFlat } from '@/hooks/useSections';
import { arDuration, arNum } from '@/lib/format';

// ─── Stat card ───────────────────────────────────────────────────────────────

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
        <Feather
          name={icon}
          size={18}
          color={accent ? colors.onTealPrimary : colors.textMuted}
        />
      </View>
      <Txt weight="display" size={28} color={colors.primaryTeal} style={styles.statValue}>
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
      style={({ pressed }) => pressed && { opacity: 0.85 }}
    >
      {inner}
    </Pressable>
  );
}

// ─── Quick link card ─────────────────────────────────────────────────────────

interface QuickLinkProps {
  title: string;
  desc: string;
  href: string;
  icon: keyof typeof Feather.glyphMap;
}

function QuickLink({ title, desc, href, icon }: QuickLinkProps) {
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

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function AdminHome() {
  const { data: lectures = [] } = useAdminLectures();
  const { data: unclassified = [] } = useUnclassifiedLectures();
  const { data: sections = [] } = useSectionsFlat();

  const totalLectures = lectures.length;
  const draftCount = lectures.filter((l) => l.status === 'draft').length;
  const publishedCount = lectures.filter((l) => l.status === 'published').length;
  const incomingCount = unclassified.length;
  const sectionsCount = sections.length;

  const latest = [...lectures]
    .filter((l) => l.status === 'published')
    .slice(0, 5);

  return (
    <AdminShell active="dashboard" breadcrumb="لوحة المعلومات">
      {/* Page heading */}
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        لوحة المعلومات
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        نظرة عامة على محتوى المنصة
      </Txt>

      {/* Stat cards */}
      <View style={styles.statsRow}>
        <StatCard label="إجمالي المحاضرات" value={arNum(totalLectures)} icon="headphones" accent href="/admin/lectures" />
        <StatCard label="منشورة" value={arNum(publishedCount)} icon="check-circle" href="/admin/lectures" />
        <StatCard label="مسودة" value={arNum(draftCount)} icon="edit-3" href="/admin/lectures" />
        <StatCard label="واردة للمراجعة" value={arNum(incomingCount)} icon="inbox" href="/admin/unclassified" />
        <StatCard label="الأقسام" value={arNum(sectionsCount)} icon="folder" href="/admin/sections" />
      </View>

      {/* Quick links */}
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.sectionHeading}>
        إجراءات سريعة
      </Txt>
      <Card padded={false} style={styles.quickLinksCard}>
        <QuickLink
          title="إدارة المحاضرات"
          desc="المنشورة والمسودات والواردة — شغّل وانشر وعدّل واحذف"
          href="/admin/lectures"
          icon="headphones"
        />
        <Divider />
        <QuickLink
          title="رفع محاضرة جديدة"
          desc="أضف محاضرة صوتية وصنّفها في الشجرة"
          href="/admin/upload"
          icon="upload"
        />
        <Divider />
        <QuickLink
          title="الأقسام والشجرة"
          desc="استعرض وأضف أقساماً للمحتوى"
          href="/admin/sections"
          icon="folder"
        />
        <Divider />
        <QuickLink
          title="المحاضرات الواردة"
          desc={`${arNum(incomingCount)} محاضرة تنتظر التصنيف`}
          href="/admin/unclassified"
          icon="inbox"
        />
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
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        lec.status === 'published'
                          ? 'rgba(31,138,91,0.1)'
                          : 'rgba(176,137,79,0.12)',
                    },
                  ]}
                >
                  <Txt
                    size={11}
                    color={lec.status === 'published' ? colors.stateSuccess : colors.accentBrassMuted}
                    weight="semibold"
                  >
                    {lec.status === 'published' ? 'منشورة' : 'مسودة'}
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
  pageTitle: {
    marginBottom: 4,
  } as TextStyle,

  pageSubtitle: {
    marginBottom: 28,
  } as TextStyle,

  statsRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 32,
  } as ViewStyle,

  statCard: {
    width: 160,
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

  statValue: {
    lineHeight: 34,
  } as TextStyle,

  sectionHeading: {
    marginBottom: 12,
    marginTop: 4,
  } as TextStyle,

  quickLinksCard: {
    marginBottom: 28,
    overflow: 'hidden',
  } as ViewStyle,

  quickLink: {
    flexDirection: 'row-reverse',
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
    flexDirection: 'row-reverse',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  } as ViewStyle,

  lectureDuration: {
    width: 52,
    textAlign: 'left',
  } as TextStyle,

  statusBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  } as ViewStyle,
});
