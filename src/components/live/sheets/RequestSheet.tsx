/**
 * A raised hand, for the moderators (PLAN_LIVE_V23 §7.6): who asks (the REAL
 * name for staff — D2, resolved by the room), since when, and
 * «السماح بالتحدث» (approve) / «الاعتذار» (reject). A refusal from
 * live-control shows as one short Arabic line (a guest: «الضيف يستمع فقط…»).
 */
import { useEffect } from 'react';
import { View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useNow } from '../LiveHomeCard';
import type { LivePerson } from '../liveTypes';
import { LIVE_P4_COPY, handLine, roleKind, sexOf } from '../liveUi';
import { LiveSheet } from './LiveSheet';
import { PersonHeader, SheetButton, SheetError, useModeration } from './sheetParts';

export function RequestSheet({
  visible,
  onClose,
  identity,
  person,
  name,
}: {
  visible: boolean;
  onClose: () => void;
  identity: string | null;
  /** Live from the store — null once they left. */
  person: LivePerson | null;
  name: string;
}) {
  const g = sexOf(person?.gender);
  const { run, busy, error, reset } = useModeration(g);
  const now = useNow(30_000);
  useEffect(() => {
    if (visible) reset();
  }, [visible, identity, reset]);

  const waiting = !!person && !!person.hand && roleKind(person.role) === 'listener';
  const gone = !person;

  const act = async (action: 'approve' | 'reject') => {
    if (!identity) return;
    if (await run(action, identity)) onClose();
  };

  return (
    <LiveSheet visible={visible} onClose={onClose} title={LIVE_P4_COPY.requests}>
      <PersonHeader
        name={name}
        gender={g}
        sub={waiting ? handLine(g, person?.handAt, now) : null}
      />
      {waiting ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <SheetButton
            label={LIVE_P4_COPY.approve}
            tone="primary"
            busy={busy === 'approve'}
            disabled={!!busy && busy !== 'approve'}
            onPress={() => void act('approve')}
          />
          <SheetButton
            label={LIVE_P4_COPY.reject}
            busy={busy === 'reject'}
            disabled={!!busy && busy !== 'reject'}
            onPress={() => void act('reject')}
          />
        </View>
      ) : (
        <Txt size={13} color={colors.textMuted} style={{ lineHeight: 22 }}>
          {gone
            ? g === 'f'
              ? 'غادرت الحلقة'
              : 'غادر الحلقة'
            : g === 'f'
              ? 'لم تعد تطلب التحدث'
              : 'لم يعد يطلب التحدث'}
        </Txt>
      )}
      <SheetError text={error} />
    </LiveSheet>
  );
}
