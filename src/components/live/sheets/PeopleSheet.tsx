/**
 * «في الحلقة» — who is in the room (PLAN_LIVE_V23 §7.3, §7.7, prototype `DD.people`).
 *
 * Names (decision D2):
 *  - staff (the app's admin/publisher/sheikh check) see every REAL name, also a
 *    sister who chose «بدون اسم», through the staff-only
 *    `useLiveStaffParticipants` (get_live_participants) — never through LiveKit;
 *  - everyone else sees the LiveKit names: «طالبة» for a hidden sister.
 * A sister also gets her own «ظهورك في الحلقة» row to change her choice.
 * Moderators (P4) tap a row → PersonSheet (`onSelectPerson`).
 *
 * Across the hijab (owner 2026-10-05, liveUi seesNameOf): an ordinary attendee
 * sees his own side's names — brothers the brothers, sisters the sisters (a
 * hidden sister stays «طالبة») — and the other side as a number only. The
 * sheikh is listed for everyone; the host, moderators and staff see all.
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, View } from 'react-native';

import { Divider, Txt, cardRowStyle } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useLiveStaffParticipants } from '@/hooks/useLive';
import { useLiveStore } from '@/stores/liveStore';
import { arNum } from '@/lib/format';
import { HandGlyph, LiveAvatar, SheikhAvatar } from '../LiveAvatar';
import type { LiveCounts, LivePerson } from '../liveTypes';
import { LIVE_P4_COPY, asList, controlErrorText, roleKind, seesNameOf, sexOf, staffNameMap, visibleName, type Sex } from '../liveUi';
import { LiveSheet } from './LiveSheet';

type Row = {
  id: string;
  name: string;
  sub: string;
  gender: Sex;
  host: boolean;
  me: boolean;
  moderator: boolean;
  hand: boolean;
  listener: boolean;
};

type Group = { key: 'front' | 'speakers' | 'brothers' | 'sisters'; title: string; data: Row[]; footer: string | null };

function subLine(p: LivePerson): string {
  const f = sexOf(p.gender) === 'f';
  const kind = roleKind(p.role);
  let sub =
    kind === 'host'
      ? 'الشيخ'
      : kind === 'moderator'
        ? f ? 'مشرفة' : 'مشرف'
        : kind === 'speaker'
          ? f ? 'من الأخوات' : 'من الإخوة'
          : f ? 'مستمعة' : 'مستمع';
  if (p.hand) sub += f ? ' · تطلب التحدث' : ' · يطلب التحدث';
  if (p.hidden && f) sub += ' · بدون اسم';
  return sub;
}

export function PeopleSheet({
  visible,
  onClose,
  sessionId,
  people,
  counts,
  isStaff,
  myIdentity,
  myName,
  onChangeIdentity,
  onSelectPerson,
  viewer = null,
  privileged = true,
  canInvite = false,
}: {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  people: Readonly<Record<string, LivePerson>>;
  counts: LiveCounts;
  isStaff: boolean;
  /** Mine, for a sister's «ظهورك في الحلقة» row. */
  myIdentity: { gender: Sex; hidden: boolean } | null;
  myName?: string | null;
  onChangeIdentity?: () => void;
  /** Moderators (P4): a row opens that person's sheet (approve / mute / demote). */
  onSelectPerson?: (identity: string) => void;
  /** My side ('m' brothers / 'f' sisters); null = not known yet (no names but the sheikh's). */
  viewer?: Sex | null;
  /** Host / moderator / staff: every name (default — the old behaviour). */
  privileged?: boolean;
  /** Moderators: a one-tap «السماح» beside every listener (owner 2026-10-25) — no raised hand needed. */
  canInvite?: boolean;
}) {
  const moderate = useLiveStore((s) => s.moderate);
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => {
    if (visible) setInviteError(null);
  }, [visible]);
  const invite = async (row: { id: string; gender: Sex }) => {
    if (inviting) return;
    setInviting(row.id);
    setInviteError(null);
    try {
      await moderate('approve', row.id);
    } catch (e) {
      if (alive.current) setInviteError(controlErrorText(e, row.gender));
    } finally {
      if (alive.current) setInviting(null);
    }
  };

  // D2: only staff ever ask for real names (the RPC refuses everyone else too).
  const staffRes: unknown = useLiveStaffParticipants(sessionId, isStaff && visible);
  const staffList = asList<unknown>(isStaff ? staffRes : null);
  const staff = useMemo(() => staffNameMap(staffList), [staffList]);

  const { groups, total } = useMemo(() => {
    const front: Row[] = [];
    const speakers: Row[] = [];
    const brothers: Row[] = [];
    const sisters: Row[] = [];
    let listed = { m: 0, f: 0 };
    let hiddenSisters = 0;
    let hostCount = 0;
    for (const [id, p] of Object.entries(people)) {
      const g = sexOf(p.gender);
      const kind = roleKind(p.role);
      const hidden = !!p.hidden && g === 'f';
      // The other side, for an ordinary attendee: counted, never listed.
      if (!p.isMe && !seesNameOf(viewer, privileged, p)) {
        listed = { ...listed, [g]: listed[g] + 1 };
        continue;
      }
      const name = p.isMe
        ? `أنت${hidden ? ' (بدون اسم)' : ''}`
        : visibleName(id, p, isStaff, staff);
      const row: Row = {
        id,
        name,
        sub: subLine(p),
        gender: g,
        host: kind === 'host',
        me: !!p.isMe,
        moderator: kind === 'moderator',
        hand: !!p.hand,
        listener: kind === 'listener',
      };
      if (kind === 'host') {
        hostCount++;
        front.unshift(row);
        continue;
      }
      listed = { ...listed, [g]: listed[g] + 1 };
      if (kind === 'moderator') front.push(row);
      else if (kind === 'speaker') speakers.push(row);
      else if (g === 'f') {
        sisters.push(row);
        if (hidden) hiddenSisters++;
      } else brothers.push(row);
    }
    const bTotal = Math.max(counts?.brothers ?? 0, listed.m);
    const sTotal = Math.max(counts?.sisters ?? 0, listed.f);
    const moreB = bTotal - listed.m;
    const moreS = sTotal - listed.f;
    const seesSisters = privileged || viewer === 'f';
    const seesBrothers = privileged || viewer === 'm';
    const sisterFooter = !seesSisters
      ? 'أسماء الأخوات تظهر للأخوات فقط'
      : [
          moreS > 0 ? `و${arNum(moreS)} أخريات` : null,
          hiddenSisters > 0 ? `منهن ${arNum(hiddenSisters)} بدون اسم` : null,
        ]
          .filter(Boolean)
          .join(' · ');
    const brotherFooter = !seesBrothers
      ? 'أسماء الإخوة تظهر للإخوة فقط'
      : moreB > 0
        ? `و${arNum(moreB)} آخرون`
        : null;
    const out: Group[] = [];
    if (front.length) out.push({ key: 'front', title: 'في صدر المجلس', data: front, footer: null });
    if (speakers.length) {
      out.push({ key: 'speakers', title: `المتحدثون · ${arNum(speakers.length)}`, data: speakers, footer: null });
    }
    out.push({
      key: 'brothers',
      title: `الإخوة · ${arNum(bTotal)}`,
      data: brothers,
      footer: brotherFooter,
    });
    out.push({ key: 'sisters', title: `الأخوات · ${arNum(sTotal)}`, data: sisters, footer: sisterFooter || null });
    return { groups: out, total: bTotal + sTotal + hostCount };
  }, [people, counts, isStaff, staff, viewer, privileged]);

  const sisterMe = myIdentity?.gender === 'f';

  return (
    <LiveSheet
      visible={visible}
      onClose={onClose}
      title="في الحلقة"
      sub={`${arNum(total)} حاضراً`}
      maxHeightRatio={0.85}
    >
      <SectionList
        sections={groups}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        style={{ flexGrow: 0 }}
        ListHeaderComponent={
          <>
          {inviteError ? (
            <Txt size={12} color={colors.stateDanger} align="center" style={{ marginBottom: 6 }}>
              {inviteError}
            </Txt>
          ) : null}
          {sisterMe ? (
            <Pressable
              onPress={onChangeIdentity}
              accessibilityRole="button"
              style={[
                cardRowStyle(true, true),
                { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 6 },
              ]}
            >
              <LiveAvatar gender="f" size={40} me />
              <View style={{ flex: 1 }}>
                <Txt size={14} weight="semibold">
                  ظهورك في الحلقة
                </Txt>
                <Txt size={12} color={colors.textFaint}>
                  {myIdentity?.hidden
                    ? 'بدون اسم · «طالبة»'
                    : `باسمك${myName ? ` · ${myName}` : ''}`}
                </Txt>
              </View>
              <Txt size={13} weight="medium" color={colors.primaryTeal} style={{ textDecorationLine: 'underline' }}>
                تغيير
              </Txt>
            </Pressable>
          ) : null}
          </>
        }
        renderSectionHeader={({ section }) => (
          <Txt size={12} weight="semibold" color={colors.textFaint} style={{ marginTop: 14, marginBottom: 6 }}>
            {section.title}
          </Txt>
        )}
        renderSectionFooter={({ section }) =>
          section.footer ? (
            <Txt size={12} color={colors.textFaint} align="center" style={{ marginTop: 6 }}>
              {section.footer}
            </Txt>
          ) : null
        }
        ItemSeparatorComponent={() => (
          <View style={{ backgroundColor: colors.surfaceCard, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.borderSand }}>
            <Divider />
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <Pressable
            onPress={onSelectPerson && !item.me ? () => onSelectPerson(item.id) : undefined}
            disabled={!onSelectPerson || item.me}
            accessibilityRole={onSelectPerson && !item.me ? 'button' : undefined}
            style={({ pressed }) => [
              cardRowStyle(index === 0, index === section.data.length - 1),
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            {item.host ? (
              <SheikhAvatar name={item.name} size={40} />
            ) : (
              <LiveAvatar gender={item.gender} size={40} me={item.me} moderator={item.moderator} />
            )}
            <View style={{ flex: 1 }}>
              <Txt size={14} weight="semibold" numberOfLines={1}>
                {item.name}
              </Txt>
              <Txt size={12} color={colors.textFaint} numberOfLines={1}>
                {item.sub}
              </Txt>
            </View>
            {item.hand ? <HandGlyph size={16} color={colors.accentBrassMuted} /> : null}
            {canInvite && item.listener && !item.me ? (
              <Pressable
                onPress={() => void invite(item)}
                disabled={!!inviting}
                accessibilityRole="button"
                accessibilityLabel={`${LIVE_P4_COPY.approve} · ${item.name}`}
                hitSlop={6}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: colors.primaryTeal,
                  opacity: pressed || (inviting && inviting !== item.id) ? 0.6 : 1,
                })}
              >
                {inviting === item.id ? (
                  <ActivityIndicator size="small" color={colors.onTealPrimary} />
                ) : (
                  <Feather name="mic" size={13} color={colors.onTealPrimary} />
                )}
                <Txt size={12} weight="semibold" color={colors.onTealPrimary}>
                  السماح
                </Txt>
              </Pressable>
            ) : null}
          </Pressable>
        )}
      />
    </LiveSheet>
  );
}
