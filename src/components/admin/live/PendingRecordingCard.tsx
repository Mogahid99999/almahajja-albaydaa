/**
 * A live recording that is still on its way into «المحاضرات الواردة»: the
 * session ended and the media worker is compressing it («جارٍ الضغط على
 * الخادم» + progress), or the job failed for good («إعادة المعالجة» — the raw
 * recording is kept, owner rule §1.1 #12).
 */
import { useState } from 'react';
import { View } from 'react-native';

import type { LiveAdminSession } from '@/api/liveAdmin';
import { rpcErrorText } from '@/components/live/liveUi';
import { Card, Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useRetryLiveRecording } from '@/hooks/useLiveAdmin';
import { arDateTime } from '@/lib/format';
import { ADMIN_LIVE_COPY, sessionState } from './liveAdminUi';
import { ActionButton, InlineNote, JobProgress, LiveSourceChip, StatePill } from './parts';

export function PendingRecordingCard({ session: s, nowMs }: { session: LiveAdminSession; nowMs: number }) {
  const retry = useRetryLiveRecording();
  const [error, setError] = useState<string | null>(null);
  const state = sessionState(s, nowMs);

  return (
    <Card style={{ maxWidth: 760 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <LiveSourceChip label={ADMIN_LIVE_COPY.fromLive} />
        <StatePill tone={state.tone} label={state.label} />
      </View>
      <Txt weight="semibold" size={14} color={colors.textInk} numberOfLines={2} style={{ marginTop: 10, lineHeight: 22 }}>
        {s.title}
      </Txt>
      <Txt size={12} color={colors.textGhost} style={{ marginTop: 4 }}>
        {[s.sectionTitle, s.endedAt ? `انتهى ${arDateTime(s.endedAt)}` : null].filter(Boolean).join(' · ')}
      </Txt>
      {state.progress !== null ? <JobProgress value={state.progress} /> : null}
      {state.note ? (
        <Txt size={12} color={s.status === 'failed' ? colors.stateDanger : colors.textMuted} style={{ marginTop: 8, lineHeight: 19 }}>
          {state.note}
        </Txt>
      ) : null}
      {s.status === 'failed' ? (
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          <ActionButton
            label={ADMIN_LIVE_COPY.retry}
            icon="refresh-ccw"
            tone="primary"
            compact
            busy={retry.isPending}
            onPress={() => {
              setError(null);
              retry.mutate(s.id, { onError: (e) => setError(rpcErrorText(e, 'تعذّرت إعادة المعالجة')) });
            }}
          />
        </View>
      ) : null}
      <InlineNote text={error} />
    </Card>
  );
}
