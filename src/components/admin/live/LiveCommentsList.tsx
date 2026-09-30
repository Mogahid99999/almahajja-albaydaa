/**
 * «التعليقات والأسئلة» of a majlis, kept after it (migration 0147) — shown with
 * the session on the staff «البث المباشر» screen and with its recording in
 * «الواردة». Collapsed to one «التعليقات» line; opening it loads
 * admin_live_comments (every comment, deleted ones marked «حُذف»). «بدون اسم»
 * stays nameless here too («طالب» / «طالبة») — the server never sends who.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import type { LiveComment } from '@/api/liveComments';
import { LIVE_COMMENTS_COPY, arClock, commentAuthorLabel, sexOf } from '@/components/live/liveUi';
import { Rhombus, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useAdminLiveComments } from '@/hooks/useLiveAdmin';
import { arNum } from '@/lib/format';

const COLLAPSED = 6;

export function LiveCommentsList({ sessionId }: { sessionId: string | null }) {
  const [open, setOpen] = useState(false);
  if (!sessionId) return null;
  return (
    <View
      style={{
        marginTop: 14,
        padding: 12,
        borderRadius: radius.sm,
        backgroundColor: colors.bgSandRaised,
        borderWidth: 1,
        borderColor: colors.borderSand,
      }}
    >
      {open ? (
        <CommentsBody sessionId={sessionId} onClose={() => setOpen(false)} />
      ) : (
        <Header label={LIVE_COMMENTS_COPY.title} open={false} onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

function Header({
  label,
  open,
  busy = false,
  onPress,
}: {
  label: string;
  open: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
    >
      <Feather name="message-circle" size={14} color={colors.textSlate} />
      <Txt size={12.5} weight="semibold" color={colors.textSlate}>
        {label}
      </Txt>
      {busy ? <ActivityIndicator size="small" color={colors.textGhost} /> : null}
      <View style={{ flex: 1 }} />
      <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textGhost} />
    </Pressable>
  );
}

/** Mounted only when opened — the read runs then, never for every card on the screen. */
function CommentsBody({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const q = useAdminLiveComments(sessionId);
  const [all, setAll] = useState(false);
  const rows: readonly LiveComment[] = q.data ?? [];
  const shown = all ? rows : rows.slice(0, COLLAPSED);
  const label = q.data ? `${LIVE_COMMENTS_COPY.title} (${arNum(rows.length)})` : LIVE_COMMENTS_COPY.title;

  return (
    <>
      <Header label={label} open busy={q.isLoading} onPress={onClose} />
      {q.isError ? (
        <Txt size={12} color={colors.textGhost} style={{ marginTop: 6 }}>
          {LIVE_COMMENTS_COPY.loadFailed}
        </Txt>
      ) : !q.isLoading && rows.length === 0 ? (
        <Txt size={12} color={colors.textGhost} style={{ marginTop: 6 }}>
          لم يُكتب في هذا المجلس تعليق ولا سؤال
        </Txt>
      ) : (
        <View style={{ marginTop: 8, gap: 8 }}>
          {shown.map((c) => (
            <AdminCommentRow key={c.id} c={c} />
          ))}
          {rows.length > COLLAPSED ? (
            <Pressable onPress={() => setAll((v) => !v)} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
              <Txt size={12} weight="semibold" color={colors.primaryTeal600}>
                {all ? 'عرض أقل' : `عرض الكل (${arNum(rows.length)})`}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      )}
    </>
  );
}

function AdminCommentRow({ c }: { c: LiveComment }) {
  const f = sexOf(c.gender) === 'f';
  const deleted = !!c.deleted;
  const tags: string[] = [];
  if (deleted) tags.push('حُذف');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, opacity: deleted ? 0.6 : 1 }}>
      <View style={{ paddingTop: 7 }}>
        <Rhombus size={5} color={f ? colors.accentBrassMuted : colors.primaryTeal600} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt size={12} color={colors.textGhost}>
          <Txt size={12} weight="semibold" color={colors.textSlate}>
            {commentAuthorLabel(c)}
          </Txt>
          {` · ${arClock(c.at)}${tags.length ? ` · ${tags.join(' · ')}` : ''}`}
        </Txt>
        <Txt
          size={12.5}
          color={deleted ? colors.textGhost : colors.textInk}
          style={{ lineHeight: 20, marginTop: 1, textDecorationLine: deleted ? 'line-through' : 'none' }}
        >
          {c.text}
        </Txt>
      </View>
    </View>
  );
}
