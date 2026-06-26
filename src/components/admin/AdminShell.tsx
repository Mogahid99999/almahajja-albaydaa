/**
 * AdminShell — RTL two-pane app shell wrapping every admin screen.
 *
 * Layout (flexDirection:'row', RTL puts sidebar on the right automatically):
 *   [content area] [right sidebar 252px]
 *
 * Sidebar:  teal, 252px, logo + nav + user chip pinned bottom.
 * Topbar:   64px sand-raised, breadcrumb + bell + avatar.
 * Content:  scrollable, 30px padding, bgSand.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { Divider, IconButton, Logo, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useSignOut } from '@/hooks/useAuth';

// ─── Nav item config ─────────────────────────────────────────────────────────

type NavKey = 'dashboard' | 'upload' | 'sections' | 'unclassified';

const NAV_ITEMS: { key: NavKey; label: string; href: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'dashboard', label: 'لوحة المعلومات', href: '/admin', icon: 'grid' },
  { key: 'upload', label: 'رفع محاضرة', href: '/admin/upload', icon: 'upload' },
  { key: 'sections', label: 'الأقسام والشجرة', href: '/admin/sections', icon: 'folder' },
  { key: 'unclassified', label: 'المحاضرات الواردة', href: '/admin/unclassified', icon: 'inbox' },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface AdminShellProps {
  active: NavKey;
  breadcrumb: string;
  children: ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AdminShell({ active, breadcrumb, children }: AdminShellProps) {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const signOut = useSignOut();

  return (
    <View style={styles.root}>
      {/* ── Left content area (fills remaining space) ── */}
      <View style={styles.main}>
        {/* Topbar */}
        <View style={styles.topbar}>
          <View style={styles.topbarLeft}>
            <IconButton icon="bell" variant="ghost" size={40} iconSize={18} color={colors.textMuted} />
            <View style={styles.avatar} />
          </View>
          <Txt weight="semibold" size={14} color={colors.textSlate} style={styles.breadcrumb}>
            {breadcrumb}
          </Txt>
        </View>

        {/* Scrollable content */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>

      {/* ── Right sidebar (teal, 252px) ── */}
      <View style={styles.sidebar}>
        {/* Logo + title */}
        <View style={styles.sidebarHeader}>
          <Logo size={36} />
          <View style={{ marginRight: 10, flex: 1 }}>
            <Txt weight="display" size={16} color={colors.onTealPrimary}>
              رِواق العِلم
            </Txt>
            <Txt weight="regular" size={11} color={colors.onTealSecondary}>
              لوحة الإدارة
            </Txt>
          </View>
        </View>

        <Divider />

        {/* Nav items */}
        <View style={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === active;
            return (
              <Pressable
                key={item.key}
                onPress={() => router.push(item.href as Parameters<typeof router.push>[0])}
                style={({ pressed }) => [
                  styles.navItem,
                  isActive && styles.navItemActive,
                  pressed && !isActive && styles.navItemPressed,
                ]}
                accessibilityRole="button"
              >
                {isActive ? (
                  <Rhombus size={8} color={colors.accentBrass} filled />
                ) : (
                  <Rhombus size={8} color={colors.accentBrass} filled={false} />
                )}
                <Feather
                  name={item.icon}
                  size={16}
                  color={isActive ? colors.onTealPrimary : colors.onTealSecondary}
                  style={{ marginRight: 10 }}
                />
                <Txt
                  weight={isActive ? 'semibold' : 'regular'}
                  size={13}
                  color={isActive ? colors.onTealPrimary : colors.onTealSecondary}
                >
                  {item.label}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        {/* User chip pinned at bottom */}
        <View style={styles.userChip}>
          <Divider />
          <View style={styles.userRow}>
            <Pressable
              onPress={() => signOut.mutate()}
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
                مدير
              </Txt>
            </View>
            <View style={styles.userAvatar}>
              <Feather name="user" size={14} color={colors.onTealPrimary} />
            </View>
          </View>
        </View>
      </View>
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
    minWidth: 700,
  } as ViewStyle,

  // ── Sidebar ──
  sidebar: {
    width: SIDEBAR_W,
    backgroundColor: colors.primaryTeal,
    flexDirection: 'column',
  } as ViewStyle,

  sidebarHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  } as ViewStyle,

  nav: {
    flex: 1,
    paddingTop: 8,
    paddingHorizontal: 12,
    gap: 2,
  } as ViewStyle,

  navItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    gap: 0,
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
    flexDirection: 'row-reverse',
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
    width: 32,
    height: 32,
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
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSand,
    justifyContent: 'space-between',
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

  breadcrumb: {
    flex: 1,
    marginRight: 0,
  } as ViewStyle,

  scroll: {
    flex: 1,
  } as ViewStyle,

  scrollContent: {
    padding: spacing.adminContent,
    paddingBottom: 60,
  } as ViewStyle,
});
