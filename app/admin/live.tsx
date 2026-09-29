/**
 * «البث المباشر» — the staff live screen (V23 P6, PLAN_LIVE_V23 §8; D7).
 *
 *  - Start card: section picker → CreateLiveSheet → the host's green room, on
 *    the PHONE (staff can't reach the student section page). On web:
 *    «يبدأ البث من تطبيق الهاتف» (hosting from the browser comes later).
 *  - «مباشر الآن»: title, sheikh, section, started, attendees → «فتح الحلقة»
 *    (phone app only).
 *  - «قيد التجهيز والمجدولة»: green rooms + scheduled sessions → «فتح غرفة
 *    التجهيز» for its host, «إلغاء المجلس» (cancel_live_session).
 *  - «انتهت مؤخراً»: the recording job state/progress, «فتح في الواردة» for the
 *    draft lecture, «إعادة المعالجة» (retry_live_recording) after a failure,
 *    «تنزيل التسجيل الأصلي» (media worker, staff JWT).
 *
 * Admin, publisher and sheikh. A sheikh sees his own scheduled/ended sessions
 * (admin_live_overview, 0143) and has none of the content-manager actions.
 */
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { LiveAdminSession } from '@/api/liveAdmin';
import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { LiveSessionCard } from '@/components/admin/live/LiveSessionCard';
import { canHost, isContentManager } from '@/components/admin/live/liveAdminUi';
import { ActionButton, EmptyLine, GroupHeading } from '@/components/admin/live/parts';
import { StartLiveCard } from '@/components/admin/live/StartLiveCard';
import { liveGreenHref, liveRoomHref, rpcErrorText } from '@/components/live/liveUi';
import { Card, Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import {
  useCancelLiveAdminSession,
  useDownloadRawRecording,
  useLiveAdminOverview,
  useRefreshLiveAdmin,
  useRetryLiveRecording,
} from '@/hooks/useLiveAdmin';

type Note = { text: string; tone: 'danger' | 'ok' | 'muted' };

/** «بدأ منذ…» / scheduled day labels stay current without a refetch. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export default function AdminLiveScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const overview = useLiveAdminOverview();
  const cancel = useCancelLiveAdminSession();
  const retry = useRetryLiveRecording();
  const download = useDownloadRawRecording();
  const refresh = useRefreshLiveAdmin();
  const nowMs = useNow(30_000);

  const [pendingCancel, setPendingCancel] = useState<LiveAdminSession | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const setNote = (id: string, note: Note | null) =>
    setNotes((prev) => {
      const next = { ...prev };
      if (note) next[id] = note;
      else delete next[id];
      return next;
    });

  const data = overview.data;
  const manager = data?.isManager ?? isContentManager(user);
  const live = (data?.active ?? []).filter((s) => s.status === 'live');
  const upcoming = [...(data?.active ?? []).filter((s) => s.status === 'green'), ...(data?.scheduled ?? [])];
  const recent = data?.recent ?? [];
  const activeTitle = data?.active[0]?.title ?? null;

  const cardProps = {
    nowMs,
    manager,
    onOpenRoom: (s: LiveAdminSession) => router.push(liveRoomHref(s.id)),
    onOpenGreen: (s: LiveAdminSession) => router.push(liveGreenHref(s.id)),
    onCancel: (s: LiveAdminSession) => setPendingCancel(s),
    onRetry: (s: LiveAdminSession) => {
      setNote(s.id, null);
      retry.mutate(s.id, {
        onSuccess: () => setNote(s.id, { text: 'أُعيد التسجيل إلى المعالجة على الخادم', tone: 'ok' }),
        onError: (e) => setNote(s.id, { text: rpcErrorText(e, 'تعذّرت إعادة المعالجة'), tone: 'danger' }),
      });
    },
    onOpenInbox: (s: LiveAdminSession) =>
      router.push({ pathname: '/admin/unclassified', params: { live: s.lectureId ?? '' } } as unknown as Href),
    onDownload: (s: LiveAdminSession) => {
      setNote(s.id, null);
      download.mutate(
        { sessionId: s.id, title: s.title },
        {
          onError: (e) =>
            setNote(s.id, {
              text: e instanceof Error && /[؀-ۿ]/.test(e.message) ? e.message : 'تعذّر التنزيل',
              tone: 'danger',
            }),
        },
      );
    },
  };

  const renderCard = (s: LiveAdminSession) => (
    <LiveSessionCard
      key={s.id}
      session={s}
      {...cardProps}
      retrying={retry.isPending && retry.variables === s.id}
      downloading={download.isPending && download.variables?.sessionId === s.id}
      note={notes[s.id] ?? null}
    />
  );

  return (
    <AdminShell
      active="live"
      breadcrumb="البث المباشر"
      refreshing={overview.isRefetching}
      onRefresh={() => void overview.refetch()}
    >
      <Txt weight="display" size={27} color={colors.primaryTeal} style={{ marginBottom: 4 }}>
        البث المباشر
      </Txt>
      <Txt size={13} color={colors.textMuted} style={{ marginBottom: 22, lineHeight: 21 }}>
        ما يجري الآن، وما هو مجدول، وتسجيلات المجالس التي انتهت
      </Txt>

      <View style={{ maxWidth: 860 }}>
        <StartLiveCard
          canStart={canHost(user)}
          activeTitle={activeTitle}
          onCreated={(id) => {
            refresh();
            router.push(liveGreenHref(id));
          }}
        />

        {overview.isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primaryTeal} />
          </View>
        ) : overview.isError ? (
          <Card style={{ marginTop: 20 }}>
            <Txt size={13} color={colors.textMuted} align="center">
              {rpcErrorText(overview.error, 'تعذّر تحميل البث المباشر')}
            </Txt>
            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <ActionButton label="إعادة المحاولة" icon="refresh-cw" compact onPress={() => void overview.refetch()} />
            </View>
          </Card>
        ) : (
          <>
            <GroupHeading title="مباشر الآن" />
            {live.length ? live.map(renderCard) : <EmptyLine text="لا يوجد بث مباشر الآن" />}

            {upcoming.length ? (
              <>
                <GroupHeading title="قيد التجهيز والمجدولة" count={upcoming.length} />
                {upcoming.map(renderCard)}
              </>
            ) : null}

            <GroupHeading title="انتهت مؤخراً" count={recent.length} />
            {recent.length ? recent.map(renderCard) : <EmptyLine text="لم ينتهِ أي مجلس بعد" />}
          </>
        )}
      </View>

      <ConfirmDialog
        visible={!!pendingCancel}
        title="إلغاء المجلس؟"
        message={`لن يبدأ «${pendingCancel?.title ?? ''}»، ويُزال من المجالس المجدولة.`}
        confirmLabel="إلغاء المجلس"
        cancelLabel="تراجع"
        pending={cancel.isPending}
        onConfirm={() => {
          const s = pendingCancel;
          if (!s) return;
          setNote(s.id, null);
          cancel.mutate(s.id, {
            onError: (e) => setNote(s.id, { text: rpcErrorText(e, 'تعذّر إلغاء المجلس'), tone: 'danger' }),
            onSettled: () => setPendingCancel(null),
          });
        }}
        onCancel={() => setPendingCancel(null)}
      />
    </AdminShell>
  );
}
