/**
 * رفقاء الدراسة — /admin/buddies (admin only, V14 item 5).
 *
 * Read-only visibility into رفيق الدراسة: three calm stat tiles (من فعّل
 * الميزة = students with a set gender · الثنائيات النشطة · دعوات قيد الانتظار)
 * and the list of active pairs with both display names. One DEFINER RPC
 * (admin_buddy_overview, migration 0079) returns everything; names never cross
 * the wire outside it. Plain counts + a list — no ranking, no comparison,
 * matching the platform's non-competitive tone.
 */
import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Divider, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useAdminOnly } from '@/hooks/useAdminGuard';
import { useAdminBuddyOverview } from '@/hooks/useBuddy';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { arNum, arSince } from '@/lib/format';

function StatCard({
  label,
  value,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
  accent?: boolean;
}) {
  return (
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
}

export default function AdminBuddies() {
  useAdminOnly();
  const { data, isLoading, refetch } = useAdminBuddyOverview();
  const { refreshing, onRefresh } = usePullToRefresh([refetch]);

  return (
    <AdminShell
      active="buddies"
      breadcrumb="رفقاء الدراسة"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        رفقاء الدراسة
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        نظرة هادئة على ميزة رفيق الدراسة — أعداد وثنائيات، دون أي مقارنة بين الطلاب
      </Txt>

      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primaryTeal} />
        </View>
      ) : (
        <>
          <View style={styles.statsRow}>
            <StatCard
              label="فعّلوا الميزة"
              value={arNum(data?.enabledCount ?? 0)}
              icon="user-check"
              accent
            />
            <StatCard
              label="ثنائيات نشطة"
              value={arNum(data?.activePairsCount ?? 0)}
              icon="users"
            />
            <StatCard
              label="دعوات قيد الانتظار"
              value={arNum(data?.pendingCount ?? 0)}
              icon="clock"
            />
          </View>

          <Card padded={false} style={styles.pairsCard}>
            <View style={styles.pairsHeader}>
              <Feather name="users" size={16} color={colors.primaryTeal} />
              <Txt weight="semibold" size={14} color={colors.textInk} style={{ marginRight: 8 }}>
                الثنائيات النشطة
              </Txt>
            </View>
            <Divider />
            {(data?.pairs ?? []).length === 0 ? (
              <Txt size={12} color={colors.textMuted} align="center" style={{ padding: 20 }}>
                لا ثنائيات نشطة بعد
              </Txt>
            ) : (
              (data?.pairs ?? []).map((p, i) => (
                <View
                  key={`${p.aName}-${p.bName}-${i}`}
                  style={[styles.pairRow, i > 0 && styles.pairRowBorder]}
                >
                  <View style={styles.pairNames}>
                    <Txt size={13.5} weight="medium" color={colors.textInk} numberOfLines={1}>
                      {p.aName}
                    </Txt>
                    <Feather name="repeat" size={13} color={colors.accentBrassMuted} />
                    <Txt size={13.5} weight="medium" color={colors.textInk} numberOfLines={1}>
                      {p.bName}
                    </Txt>
                  </View>
                  {p.since ? (
                    <Txt size={11.5} color={colors.textGhost}>
                      {arSince(p.since)}
                    </Txt>
                  ) : null}
                </View>
              ))
            )}
          </Card>
        </>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  pageTitle: { marginBottom: 4 } as TextStyle,
  pageSubtitle: { marginBottom: 22 } as TextStyle,

  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 22,
  } as ViewStyle,

  statCard: {
    flexGrow: 1,
    flexBasis: 160,
    maxWidth: 260,
  } as ViewStyle,

  statIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  } as ViewStyle,

  statValue: { marginBottom: 2 } as TextStyle,

  pairsCard: {
    maxWidth: 640,
  } as ViewStyle,

  pairsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  } as ViewStyle,

  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  } as ViewStyle,

  pairRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSand,
  } as ViewStyle,

  pairNames: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  } as ViewStyle,

  loadingBox: { paddingVertical: 60, alignItems: 'center' } as ViewStyle,
});
