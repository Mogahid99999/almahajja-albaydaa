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
 */
import { useMemo } from 'react';
import { Pressable, SectionList, View } from 'react-native';

import { Divider, Txt, cardRowStyle } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useLiveStaffParticipants } from '@/hooks/useLive';
import { arNum } from '@/lib/format';
import { HandGlyph, LiveAvatar, SheikhAvatar } from '../LiveAvatar';
import type { LiveCounts, LivePerson } from '../liveTypes';
import { asList, roleKind, sexOf, staffNameMap, visibleName, type Sex } from '../liveUi';
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
}) {
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
    const sisterFooter = [
      moreS > 0 ? `و${arNum(moreS)} أخريات` : null,
      hiddenSisters > 0 ? `منهن ${arNum(hiddenSisters)} بدون اسم` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const out: Group[] = [];
    if (front.length) out.push({ key: 'front', title: 'في صدر المجلس', data: front, footer: null });
    if (speakers.length) {
      out.push({ key: 'speakers', title: `المتحدثون · ${arNum(speakers.length)}`, data: speakers, footer: null });
    }
    out.push({
      key: 'brothers',
      title: `الإخوة · ${arNum(bTotal)}`,
      data: brothers,
      footer: moreB > 0 ? `و${arNum(moreB)} آخرون` : null,
    });
    out.push({ key: 'sisters', title: `الأخوات · ${arNum(sTotal)}`, data: sisters, footer: sisterFooter || null });
    return { groups: out, total: bTotal + sTotal + hostCount };
  }, [people, counts, isStaff, staff]);

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
          sisterMe ? (
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
          ) : null
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
          </Pressable>
        )}
      />
    </LiveSheet>
  );
}
