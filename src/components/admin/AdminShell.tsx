/**
 * AdminShell — RTL responsive app shell wrapping every admin screen.
 *
 * Wide (≥ COMPACT_BREAKPOINT): two-pane — scrollable content + a fixed teal
 *   sidebar (logo + nav + user chip).
 * Compact (< COMPACT_BREAKPOINT, e.g. a phone browser): no fixed sidebar; the
 *   top bar gains a hamburger that opens the same nav as an overlay drawer, and
 *   content fills the full width (single column). No horizontal overflow.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { type ReactNode, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Divider, IconButton, Logo, Rhombus, Txt } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useSignOut } from '@/hooks/useAuth';

// ─── Nav item config ─────────────────────────────────────────────────────────

type NavKey =
  | 'dashboard'
  | 'lectures'
  | 'upload'
  | 'sections'
  | 'sheikhs'
  | 'featured'
  | 'unclassified'
  | 'quizzes'
  | 'reminders'
  | 'questions'
  | 'contributions'
  | 'reports'
  | 'feedback'
  | 'ratings'
  | 'analytics'
  | 'users'
  | 'settings';

// `adminOnly` items are hidden from a ناشر (publisher): analytics, users, and
// settings touch student data / platform config, which publishers never see.
const NAV_ITEMS: {
  key: NavKey;
  label: string;
  href: string;
  icon: keyof typeof Feather.glyphMap;
  adminOnly?: boolean;
}[] = [
  { key: 'dashboard', label: 'لوحة المعلومات', href: '/admin', icon: 'grid', adminOnly: true },
  { key: 'lectures', label: 'المحاضرات', href: '/admin/lectures', icon: 'headphones' },
  { key: 'upload', label: 'رفع محاضرة', href: '/admin/upload', icon: 'upload' },
  { key: 'sections', label: 'الأقسام والشجرة', href: '/admin/sections', icon: 'folder' },
  { key: 'sheikhs', label: 'المشايخ', href: '/admin/sheikhs', icon: 'users' },
  { key: 'featured', label: 'المختارات', href: '/admin/featured', icon: 'bookmark' },
  { key: 'quizzes', label: 'الاختبارات', href: '/admin/quizzes', icon: 'check-square' },
  { key: 'unclassified', label: 'المحاضرات الواردة', href: '/admin/unclassified', icon: 'inbox' },
  { key: 'reminders', label: 'التذكيرات النافعة', href: '/admin/reminders', icon: 'star' },
  { key: 'questions', label: 'مساحة الأسئلة', href: '/admin/questions', icon: 'help-circle', adminOnly: true },
  { key: 'contributions', label: 'مشاركات الدارسين', href: '/admin/contributions', icon: 'message-square', adminOnly: true },
  { key: 'reports', label: 'البلاغات', href: '/admin/reports', icon: 'flag', adminOnly: true },
  { key: 'feedback', label: 'ملاحظات الطلاب', href: '/admin/feedback', icon: 'message-circle', adminOnly: true },
  { key: 'ratings', label: 'تقييمات التطبيق', href: '/admin/ratings', icon: 'thumbs-up', adminOnly: true },
  { key: 'analytics', label: 'تحليلات التقدم', href: '/admin/analytics', icon: 'trending-up', adminOnly: true },
  { key: 'users', label: 'إدارة المستخدمين', href: '/admin/users', icon: 'user-check', adminOnly: true },
  { key: 'settings', label: 'الإعدادات وعن المنصة', href: '/admin/settings', icon: 'settings', adminOnly: true },
];

/** Below this width the sidebar collapses into a drawer + single-column content. */
const COMPACT_BREAKPOINT = 900;

// ─── Props ───────────────────────────────────────────────────────────────────

interface AdminShellProps {
  active: NavKey;
  breadcrumb: string;
  children: ReactNode;
  /** false when the page hosts its own FlatList — avoids nesting it inside this ScrollView. */
  scroll?: boolean;
  /** Only apply to the `scroll` branch — pages hosting their own FlatList wire refresh onto it directly. */
  refreshing?: boolean;
  onRefresh?: () => void;
}

// ─── Sidebar (shared by the fixed pane and the compact drawer) ────────────────

function SidebarBody({
  active,
  onNavigate,
}: {
  active: NavKey;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const signOut = useSignOut();
  const insets = useSafeAreaInsets();

  const isPublisher = user?.role === 'publisher';
  const navItems = NAV_ITEMS.filter((item) => !item.adminOnly || !isPublisher);

  return (
    <>
      {/* Logo + title */}
      <View style={[styles.sidebarHeader, { paddingTop: 20 + insets.top }]}>
        <Logo size={36} />
        <View style={{ marginRight: 10, flex: 1 }}>
          <Txt weight="display" size={16} color={colors.onTealPrimary}>
            المَحجّة البَيْضَاء
          </Txt>
          <Txt weight="regular" size={11} color={colors.onTealSecondary}>
            لوحة الإدارة
          </Txt>
        </View>
      </View>

      <Divider />

      {/* Nav items — scrollable so a long list never hides behind the nav bar */}
      <ScrollView
        style={styles.nav}
        contentContainerStyle={styles.navContent}
        showsVerticalScrollIndicator={false}
      >
        {navItems.map((item) => {
          const isActive = item.key === active;
          return (
            <Pressable
              key={item.key}
              onPress={() => {
                router.push(item.href as Parameters<typeof router.push>[0]);
                onNavigate?.();
              }}
              style={({ pressed }) => [
                styles.navItem,
                isActive && styles.navItemActive,
                pressed && !isActive && styles.navItemPressed,
              ]}
              accessibilityRole="button"
            >
            <View style={styles.navIcons}>
              <Rhombus size={8} color={colors.accentBrass} filled={isActive} />
              <Feather
                name={item.icon}
                size={16}
                color={isActive ? colors.onTealPrimary : colors.onTealSecondary}
              />
            </View>

            <Txt
              weight={isActive ? 'semibold' : 'regular'}
              size={13}
              color={isActive ? colors.onTealPrimary : colors.onTealSecondary}
              style={styles.navLabel}
            >
              {item.label}
            </Txt>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* User chip pinned at bottom (clears the Android nav bar via safe inset) */}
      <View style={[styles.userChip, { paddingBottom: 20 + insets.bottom }]}>
        <Divider />
        <View style={styles.userRow}>
          <Pressable
            onPress={async () => {
              // Close the drawer first so navigation isn't hidden under the Modal,
              // then navigate EXPLICITLY once the session flip completes — the
              // drawer unmounts this button, so nothing here may rely on
              // component lifetime (mutateAsync's promise survives unmount).
              onNavigate?.();
              try {
                await signOut.mutateAsync();
              } catch {
                // Session is cleared locally even on server errors.
              }
              router.replace(
                (Platform.OS === 'web' ? '/sign-in' : '/') as Parameters<
                  typeof router.replace
                >[0],
              );
            }}
            disabled={signOut.isPending}
            accessibilityRole="button"
            accessibilityLabel="تسجيل الخروج"
            style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.7 }]}
          >
            <Feather name="log-out" size={16} color={colors.onTealSecondary} />
          </Pressable>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Txt weight="semibold" size={12} color={colors.onTealPrimary} numberOfLines={1}>
              {user?.email ?? '—'}
            </Txt>
            <Txt weight="regular" size={11} color={colors.onTealSecondary}>
              {isPublisher ? 'ناشر' : 'مدير'}
            </Txt>
          </View>
          <View style={styles.userAvatar}>
            <Feather name="user" size={14} color={colors.onTealPrimary} />
          </View>
        </View>
      </View>
    </>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AdminShell({
  active,
  breadcrumb,
  children,
  scroll = true,
  refreshing,
  onRefresh,
}: AdminShellProps) {
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_BREAKPOINT;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      {/* ── Wide: fixed sidebar. First flex child = the START edge, which is the
          RIGHT side here (the document/root is RTL on every platform), exactly
          where an Arabic dashboard expects its nav. ── */}
      {!compact ? (
        <View style={styles.sidebar}>
          <SidebarBody active={active} />
        </View>
      ) : null}

      {/* ── Content area (fills remaining space) ── */}
      <View style={styles.main}>
        {/* Topbar */}
        <View style={[styles.topbar, { height: TOPBAR_H + insets.top, paddingTop: insets.top }]}>
          <View style={styles.topbarStart}>
            {compact ? (
              <IconButton
                icon="menu"
                variant="ghost"
                size={40}
                iconSize={20}
                color={colors.textSlate}
                onPress={() => setDrawerOpen(true)}
                accessibilityLabel="القائمة"
              />
            ) : null}
            <Txt weight="semibold" size={14} color={colors.textSlate} numberOfLines={1} style={{ flex: 1 }}>
              {breadcrumb}
            </Txt>
          </View>
          <View style={styles.topbarLeft}>
            <IconButton icon="bell" variant="ghost" size={40} iconSize={18} color={colors.textMuted} />
            <View style={styles.avatar} />
          </View>
        </View>

        {/* Scrollable content (or a plain flex frame when the page owns a FlatList) */}
        {scroll ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              compact && styles.scrollContentCompact,
              { paddingBottom: 60 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={refreshing ?? false}
                  onRefresh={onRefresh}
                  tintColor={colors.primaryTeal}
                  colors={[colors.primaryTeal]}
                />
              ) : undefined
            }
          >
            {children}
          </ScrollView>
        ) : (
          <View
            style={[
              styles.scroll,
              styles.scrollContent,
              compact && styles.scrollContentCompact,
              { paddingBottom: 60 + insets.bottom },
            ]}
          >
            {children}
          </View>
        )}
      </View>

      {/* ── Compact: drawer overlay ── */}
      {compact ? (
        <Modal
          visible={drawerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDrawerOpen(false)}
        >
          <View style={styles.drawerOverlay}>
            <Pressable
              style={styles.drawerBackdrop}
              onPress={() => setDrawerOpen(false)}
              accessibilityLabel="إغلاق القائمة"
            />
            <View style={styles.drawerPanel}>
              <SidebarBody active={active} onNavigate={() => setDrawerOpen(false)} />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const SIDEBAR_W = 252;
const TOPBAR_H = 64;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bgSand,
  } as ViewStyle,

  // ── Sidebar ──
  sidebar: {
    width: SIDEBAR_W,
    backgroundColor: colors.primaryTeal,
    flexDirection: 'column',
  } as ViewStyle,

  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  } as ViewStyle,

  nav: {
    flex: 1,
  } as ViewStyle,

  navContent: {
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 2,
  } as ViewStyle,

  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
  } as ViewStyle,

  navIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    width: 42,
  } as ViewStyle,

  navLabel: {
    flex: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginLeft: 12,
  } as ViewStyle,

  navItemActive: {
    backgroundColor: 'rgba(201,164,99,0.16)',
  } as ViewStyle,

  navItemPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  } as ViewStyle,

  userChip: {
    paddingBottom: 20,
  } as ViewStyle,

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 0,
  } as ViewStyle,

  userAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  signOutBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  } as ViewStyle,

  // ── Main area ──
  main: {
    flex: 1,
    flexDirection: 'column',
  } as ViewStyle,

  topbar: {
    height: TOPBAR_H,
    backgroundColor: colors.bgSandRaised,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSand,
    justifyContent: 'space-between',
    gap: 8,
  } as ViewStyle,

  topbarStart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  } as ViewStyle,

  topbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceInset,
  } as ViewStyle,

  scroll: {
    flex: 1,
  } as ViewStyle,

  scrollContent: {
    padding: spacing.adminContent,
    paddingBottom: 60,
  } as ViewStyle,

  // Phone: tighter gutters so wide content (rails, cards) never clips sideways.
  scrollContentCompact: {
    paddingHorizontal: 16,
    paddingTop: 18,
  } as ViewStyle,

  // ── Compact drawer ──
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
  } as ViewStyle,

  drawerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,40,36,0.45)',
  } as ViewStyle,

  drawerPanel: {
    width: SIDEBAR_W,
    maxWidth: '82%',
    backgroundColor: colors.primaryTeal,
    flexDirection: 'column',
    // Anchored to the start (right in RTL) via being first flex child.
  } as ViewStyle,
});
