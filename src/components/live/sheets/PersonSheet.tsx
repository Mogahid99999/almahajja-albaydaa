/**
 * One attendee, opened by a moderator from «في الحلقة», the requests strip or
 * the halaqa (PLAN_LIVE_V23 §7.4/§7.6). The name is the one the room resolved —
 * the REAL name for staff (D2, useLiveStaffParticipants).
 *
 * Actions follow the target's role (liveRules canTarget):
 *  - listener with a raised hand → «السماح بالتحدث» / «الاعتذار»
 *  - speaker   → «إغلاق الميكروفون» (while it is open) · «إعادته/إعادتها إلى الاستماع»
 *  - moderator → «إغلاق الميكروفون» only (staff are never demoted)
 *  - the host  → nothing (never muted)
 */
import { useEffect } from 'react';
import { View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useNow } from '../LiveHomeCard';
import type { LivePerson } from '../liveTypes';
import {
  handLine,
  moderationActionsFor,
  moderationLabel,
  roleKind,
  sexOf,
  type ModerationAction,
} from '../liveUi';
import { LiveSheet } from './LiveSheet';
import { PersonHeader, SheetButton, SheetError, useModeration } from './sheetParts';

function roleLine(p: LivePerson, nowMs: number): string {
  const f = sexOf(p.gender) === 'f';
  switch (roleKind(p.role)) {
    case 'host':
      return 'الشيخ';
    case 'moderator':
      return `${f ? 'مشرفة' : 'مشرف'} · ${p.micOn ? 'الميكروفون مفتوح' : 'الميكروفون مغلق'}`;
    case 'speaker':
      return `${f ? 'من المتحدثات' : 'من المتحدثين'} · ${p.micOn ? 'الميكروفون مفتوح' : 'الميكروفون مغلق'}`;
    default:
      return p.hand ? handLine(f ? 'f' : 'm', p.handAt, nowMs) : f ? 'مستمعة' : 'مستمع';
  }
}

export function PersonSheet({
  visible,
  onClose,
  identity,
  person,
  name,
  canModerate,
}: {
  visible: boolean;
  onClose: () => void;
  identity: string | null;
  /** Live from the store — null once they left. */
  person: LivePerson | null;
  name: string;
  /** I am the host or a moderator of this room. */
  canModerate: boolean;
}) {
  const g = sexOf(person?.gender);
  const { run, busy, error, reset } = useModeration(g);
  const now = useNow(30_000);
  useEffect(() => {
    if (visible) reset();
  }, [visible, identity, reset]);

  const actions: ModerationAction[] = canModerate ? moderationActionsFor(person) : [];
  const kind = roleKind(person?.role);

  const act = async (action: ModerationAction) => {
    if (!identity) return;
    if (await run(action, identity)) onClose();
  };

  return (
    <LiveSheet visible={visible} onClose={onClose} title={name || (g === 'f' ? 'مستمعة' : 'مستمع')}>
      {person ? (
        <PersonHeader
          gender={g}
          host={kind === 'host'}
          moderator={kind === 'moderator'}
          sub={roleLine(person, now)}
        />
      ) : (
        <Txt size={13} color={colors.textMuted} style={{ lineHeight: 22, marginBottom: 8 }}>
          {g === 'f' ? 'غادرت الحلقة' : 'غادر الحلقة'}
        </Txt>
      )}
      {actions.length ? (
        <View style={{ gap: 10 }}>
          {actions.map((a, i) => (
            <SheetButton
              key={a}
              label={moderationLabel(a, g)}
              tone={i === 0 && (a === 'approve' || a === 'mute') ? 'primary' : 'secondary'}
              grow={false}
              busy={busy === a}
              disabled={!!busy && busy !== a}
              onPress={() => void act(a)}
            />
          ))}
        </View>
      ) : null}
      <SheetError text={error} />
    </LiveSheet>
  );
}
