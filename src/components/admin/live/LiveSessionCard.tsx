/**
 * One session on the staff «البث المباشر» screen — live now, green/scheduled,
 * or recently ended with its recording job (PLAN_LIVE_V23 §8).
 *
 * Actions depend on the platform (D7: the room and the green room open only in
 * the phone app) and the role (content managers: retry / raw download / open in
 * «الواردة» / cancel any; a sheikh: cancel and host his own). «إنهاء البث
 * للجميع» (a live session: its host or a content manager) works on the web too,
 * so a forgotten live can be closed from the browser.
 */
import Feather from '@expo/vector-icons/Feather';
import { Platform, View } from 'react-native';

import type { LiveAdminSession } from '@/api/liveAdmin';
import { Card, Rhombus, Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { arDateTime, arDuration } from '@/lib/format';
import {
  ADMIN_LIVE_COPY,
  attendeesLine,
  canCancel,
  canEndLive,
  peakLine,
  sessionState,
  startedAgo,
} from './liveAdminUi';
import { LiveCommentsList } from './LiveCommentsList';
import { ActionButton, InlineNote, JobProgress, StatePill } from './parts';

/** Sessions that went on air — they may have «التعليقات والأسئلة» (0147). */
const HAD_COMMENTS = new Set(['live', 'ended', 'processing', 'ready', 'failed']);

export interface LiveSessionCardProps {
  session: LiveAdminSession;
  nowMs: number;
  /** is_content_manager (admin | publisher). */
  manager: boolean;
  onOpenRoom: (s: LiveAdminSession) => void;
  onOpenGreen: (s: LiveAdminSession) => void;
  onCancel: (s: LiveAdminSession) => void;
  /** «إنهاء البث للجميع» (the screen confirms first). */
  onEnd?: (s: LiveAdminSession) => void;
  onRetry: (s: LiveAdminSession) => void;
  onOpenInbox: (s: LiveAdminSession) => void;
  onDownload: (s: LiveAdminSession) => void;
  retrying?: boolean;
  downloading?: boolean;
  /** live-control `end` in flight for this session. */
  endingLive?: boolean;
  /** A per-card error / notice (retry, download…). */
  note?: { text: string; tone: 'danger' | 'ok' | 'muted' } | null;
}

function MetaDot() {
  return <Rhombus size={4} color={colors.accentBrassSoft} />;
}

export function LiveSessionCard({
  session: s,
  nowMs,
  manager,
  onOpenRoom,
  onOpenGreen,
  onCancel,
  onEnd,
  onRetry,
  onOpenInbox,
  onDownload,
  retrying = false,
  downloading = false,
  endingLive = false,
  note = null,
}: LiveSessionCardProps) {
  const isWeb = Platform.OS === 'web';
  const state = sessionState(s, nowMs);
  const isLive = s.status === 'live';
  const isGreen = s.status === 'green';
  const isScheduled = s.status === 'scheduled';
  const hostCanOpenGreen = (isGreen || isScheduled) && s.isMine;

  const meta: string[] = [];
  if (s.sectionTitle) meta.push(s.sectionTitle);
  if (s.sheikhName) meta.push(s.sheikhName);

  const when: string[] = [];
  if (isLive) {
    const ago = startedAgo(s.startedAt, nowMs);
    if (ago) when.push(ago);
    when.push(attendeesLine(s.attendees));
  } else if (isGreen) {
    when.push(s.isMine ? 'غرفة التجهيز مفتوحة لك' : `المضيف: ${s.hostName ?? '—'}`);
  } else if (!isScheduled) {
    if (s.endedAt) when.push(`انتهى ${arDateTime(s.endedAt)}`);
    if (s.durationSec && s.durationSec > 0) when.push(`المدة ${arDuration(s.durationSec)}`);
    const peak = peakLine(s.peakListeners);
    if (peak) when.push(peak);
  } else if (s.hostName) {
    when.push(`المضيف: ${s.hostName}`);
  }

  const showRetry = manager && s.status === 'failed';
  const showInbox = manager && s.status === 'ready' && s.lectureNeedsTitle && !!s.lectureId;
  const showDownload =
    manager && !['scheduled', 'green', 'live', 'cancelled'].includes(s.status) && (s.rawLocal || s.rawBackup);
  const showCancel = canCancel(s, manager);
  const showEnd = !!onEnd && canEndLive(s, manager);
  const hasActions =
    isLive || hostCanOpenGreen || showInbox || showRetry || showDownload || showCancel || showEnd;

  return (
    <Card
      style={[
        { marginBottom: 12 },
        isLive ? { borderColor: 'rgba(184,92,74,0.35)', borderWidth: 1.5 } : {},
      ]}
      accessibilityLabel={`${s.title} — ${state.label}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Txt weight="semibold" size={15} color={colors.textInk} numberOfLines={2} style={{ lineHeight: 24 }}>
            {s.title}
          </Txt>
          {meta.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {meta.map((m, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                  {i > 0 ? <MetaDot /> : null}
                  <Txt size={12.5} color={colors.textMuted} numberOfLines={1} style={{ flexShrink: 1 }}>
                    {m}
                  </Txt>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        <StatePill tone={state.tone} label={state.label} />
      </View>

      {when.length ? (
        <Txt size={12} color={colors.textGhost} style={{ marginTop: 8 }}>
          {when.join(' · ')}
        </Txt>
      ) : null}

      {state.progress !== null ? <JobProgress value={state.progress} /> : null}
      {state.note ? (
        <Txt size={12} color={s.status === 'failed' ? colors.stateDanger : colors.textMuted} style={{ marginTop: 8, lineHeight: 19 }}>
          {state.note}
        </Txt>
      ) : null}

      {/* Actions */}
      {hasActions ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14, alignItems: 'center' }}>
          {isLive ? (
            isWeb ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="smartphone" size={14} color={colors.textMuted} />
                <Txt size={12.5} color={colors.textMuted}>
                  {ADMIN_LIVE_COPY.webRoom}
                </Txt>
              </View>
            ) : (
              <ActionButton label={ADMIN_LIVE_COPY.openRoom} icon="headphones" tone="primary" onPress={() => onOpenRoom(s)} />
            )
          ) : null}

          {hostCanOpenGreen && !isWeb ? (
            <ActionButton label={ADMIN_LIVE_COPY.openGreen} icon="mic" tone="primary" onPress={() => onOpenGreen(s)} />
          ) : null}
          {hostCanOpenGreen && isWeb ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Feather name="smartphone" size={14} color={colors.textMuted} />
              <Txt size={12.5} color={colors.textMuted}>
                {ADMIN_LIVE_COPY.webStart}
              </Txt>
            </View>
          ) : null}

          {showInbox ? (
            <ActionButton label={ADMIN_LIVE_COPY.openInbox} icon="inbox" tone="primary" onPress={() => onOpenInbox(s)} />
          ) : null}
          {showRetry ? (
            <ActionButton
              label={ADMIN_LIVE_COPY.retry}
              icon="refresh-ccw"
              tone="primary"
              busy={retrying}
              onPress={() => onRetry(s)}
            />
          ) : null}
          {showDownload ? (
            <ActionButton
              label={downloading ? ADMIN_LIVE_COPY.downloading : ADMIN_LIVE_COPY.download}
              icon="download"
              busy={downloading}
              onPress={() => onDownload(s)}
            />
          ) : null}
          {showCancel ? (
            <ActionButton label={ADMIN_LIVE_COPY.cancel} icon="x" tone="danger" onPress={() => onCancel(s)} />
          ) : null}
          {showEnd && onEnd ? (
            <ActionButton
              label={endingLive ? ADMIN_LIVE_COPY.ending : ADMIN_LIVE_COPY.endLive}
              icon="square"
              tone="danger"
              busy={endingLive}
              onPress={() => onEnd(s)}
            />
          ) : null}
        </View>
      ) : null}

      <InlineNote text={note?.text ?? null} tone={note?.tone ?? 'danger'} />

      {HAD_COMMENTS.has(s.status) ? <LiveCommentsList sessionId={s.id} /> : null}
    </Card>
  );
}
