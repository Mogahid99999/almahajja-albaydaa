/**
 * «التعليقات والأسئلة» — the room's comments during a live majlis (migration
 * 0147). Everyone present reads the list (oldest at the top, the newest at the
 * bottom, next to the composer); it follows the room live (useLiveComments).
 *
 * Composer: one box «اكتب تعليقاً أو سؤالاً» (owner 2026-09-30: no «تعليق» /
 * «سؤال» choice in the UI — the post goes as kind 'comment'), up to 300
 * characters (the remainder shows near the limit), then the name rules (owner, final):
 *  - a brother writes with his name, or ticks «بدون اسم» («طالب» for everyone);
 *  - a sister who sits in the room WITHOUT her name is always nameless — no
 *    option, one quiet line says so;
 *  - a sister in the room WITH her name is warned before every named send
 *    («سيظهر ما تكتبينه باسمك لجميع الحاضرين») → «أرسل باسمي» / «أرسل بدون اسم» / «إلغاء».
 * A guest reads only: «أضف تعليقاً أو سؤالاً» asks to register (`onGuestGate`).
 *
 * Rows: no «تمت الإجابة» mark (owner 2026-09-30: every question is answered).
 * Tapping a row I may act on opens its actions inline: my own → «حذف»; the
 * room's moderators / content managers → «حذف»,
 * «منع من التعليق» (after a confirm; the author is never shown). live-control
 * takes 2–5 s: every write shows its busy state, the list stays usable.
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { LIVE_COMMENT_MAX_CHARS, liveCommentLength, type LiveComment } from '@/api/liveComments';
import { Txt } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import { useLiveCommentAction, usePostLiveComment, type LiveCommentAction } from '@/hooks/useLiveComments';
import {
  LIVE_COMMENTS_COPY as COPY,
  LIVE_COPY,
  arClock,
  commentAuthorLabel,
  commentErrorText,
  commentNameLine,
  commentRemainingLine,
  namedCommentWarning,
  sexOf,
  type Sex,
} from '../liveUi';
import { LiveSheet } from './LiveSheet';
import { SheetButton, SheetError } from './sheetParts';

/**
 * Who is writing: 'ok' (a registered participant, live and connected), 'guest'
 * (reads only), 'not_live' (the green room — posting needs `live`), 'offline'
 * (reconnecting: the list stays, sending waits).
 */
export type CommentsWriteState = 'ok' | 'guest' | 'not_live' | 'offline';

export function CommentsSheet({
  visible,
  onClose,
  sessionId,
  comments,
  isLoading,
  isError,
  onRetry,
  writeState,
  me,
  myName,
  canModerate,
  onGuestGate,
}: {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  /** Oldest first (useLiveComments). */
  comments: readonly LiveComment[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  writeState: CommentsWriteState;
  /** liveStore `me`: gender + whether I sit in the room without my name. */
  me: { gender: Sex; hidden: boolean } | null;
  myName?: string | null;
  /** Host / moderator / content manager: delete any, block. */
  canModerate: boolean;
  /** A guest wants to write → «سجّل أولاً». */
  onGuestGate: () => void;
}) {
  const action = useLiveCommentAction(sessionId);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);

  const listRef = useRef<FlatList<LiveComment>>(null);
  const atEnd = useRef(true);

  useEffect(() => {
    if (!visible) return;
    atEnd.current = true;
    setSelected(null);
    setConfirmBlock(null);
    setRowError(null);
    // Open on the newest: a reopen with the same list never changes the
    // content size, and the first one can measure before the list has a height.
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToEnd({ animated: false });
      } catch {
        /* not laid out yet */
      }
    }, 60);
    return () => clearTimeout(t);
  }, [visible]);

  // An opened row (its actions, the block confirm) scrolls fully into view:
  // the last row's actions opened below the list's edge on the device.
  const revealKey = selected ? `${selected}:${confirmBlock === selected ? 'confirm' : 'actions'}` : null;
  useEffect(() => {
    if (!revealKey || !selected) return;
    const index = comments.findIndex((c) => c.id === selected);
    if (index < 0) return;
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index, viewPosition: 1, animated: true });
      } catch {
        /* not measured yet */
      }
    }, 60);
    return () => clearTimeout(t);
    // Only when a row opens / its confirm toggles — not on every list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  // A comment deleted meanwhile (by its author, a moderator) closes its actions.
  useEffect(() => {
    if (selected && !comments.some((c) => c.id === selected)) {
      setSelected(null);
      setConfirmBlock(null);
    }
  }, [comments, selected]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    atEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
  };
  const followEnd = () => {
    if (!atEnd.current) return;
    try {
      listRef.current?.scrollToEnd({ animated: false });
    } catch {
      /* not laid out yet */
    }
  };

  const run = (a: LiveCommentAction) => {
    if (action.isPending) return;
    setRowError(null);
    action.mutate(a, {
      onSuccess: () => {
        setConfirmBlock(null);
        setSelected(null);
      },
      onError: (e) => setRowError({ id: a.id, text: commentErrorText(e, 'act') }),
    });
  };

  const busyFor = (id: string) => (action.isPending && action.variables?.id === id ? action.variables.type : null);

  return (
    <LiveSheet visible={visible} onClose={onClose} title={COPY.title} sub={COPY.sub} heightRatio={0.82}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={comments as LiveComment[]}
          // Rows read the open row / confirm / busy state too.
          extraData={[selected, confirmBlock, rowError, action.isPending, action.variables]}
          keyExtractor={(c) => c.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 8, paddingBottom: 8, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={20}
          onScroll={onScroll}
          scrollEventThrottle={100}
          onContentSizeChange={followEnd}
          onLayout={followEnd}
          onScrollToIndexFailed={() => undefined}
          ListEmptyComponent={
            <ListState
              loading={isLoading}
              error={isError}
              onRetry={onRetry}
              emptyText={canModerate ? COPY.emptyStaff : COPY.empty}
            />
          }
          renderItem={({ item }) => {
            const mine = !!item.mine;
            const canDelete = mine || canModerate;
            const actionable = canDelete;
            const open = selected === item.id;
            return (
              <CommentRow
                c={item}
                open={open}
                onPress={
                  actionable
                    ? () => {
                        setRowError(null);
                        setConfirmBlock(null);
                        setSelected(open ? null : item.id);
                      }
                    : undefined
                }
              >
                {open ? (
                  confirmBlock === item.id ? (
                    <View style={{ marginTop: 10, gap: 8 }}>
                      <Txt size={12.5} color={colors.textSlate} style={{ lineHeight: 21 }}>
                        {COPY.blockConfirm}
                      </Txt>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <RowAction
                          label={COPY.blockDo}
                          tone="danger"
                          busy={busyFor(item.id) === 'block'}
                          disabled={action.isPending}
                          onPress={() => run({ type: 'block', id: item.id })}
                        />
                        <RowAction label={COPY.back} onPress={() => setConfirmBlock(null)} />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      {canDelete ? (
                        <RowAction
                          icon="trash-2"
                          label={COPY.delete}
                          busy={busyFor(item.id) === 'delete'}
                          disabled={action.isPending}
                          onPress={() => run({ type: 'delete', id: item.id })}
                        />
                      ) : null}
                      {canModerate && !mine ? (
                        <RowAction
                          icon="slash"
                          label={COPY.block}
                          tone="danger"
                          disabled={action.isPending}
                          onPress={() => {
                            setRowError(null);
                            setConfirmBlock(item.id);
                          }}
                        />
                      ) : null}
                    </View>
                  )
                ) : null}
                {rowError?.id === item.id ? <SheetError text={rowError.text} /> : null}
              </CommentRow>
            );
          }}
        />

        <Composer
          sessionId={sessionId}
          visible={visible}
          writeState={writeState}
          me={me}
          myName={myName}
          onGuestGate={onGuestGate}
          onSent={() => {
            // The cache already holds my post (it rendered before this runs):
            // follow it explicitly, a content-size change may have passed.
            atEnd.current = true;
            setTimeout(() => {
              try {
                listRef.current?.scrollToEnd({ animated: true });
              } catch {
                /* not laid out yet */
              }
            }, 60);
          }}
        />
      </KeyboardAvoidingView>
    </LiveSheet>
  );
}

// ─── List pieces ─────────────────────────────────────────────────────────────

function ListState({
  loading,
  error,
  onRetry,
  emptyText,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  emptyText: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 10 }}>
      {loading ? (
        <ActivityIndicator color={colors.primaryTeal} />
      ) : error ? (
        <>
          <Txt size={13} color={colors.textMuted} align="center" style={{ alignSelf: 'stretch' }}>
            {COPY.loadFailed}
          </Txt>
          <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
            <Txt size={13} weight="semibold" color={colors.primaryTeal} style={{ textDecorationLine: 'underline' }}>
              {COPY.retry}
            </Txt>
          </Pressable>
        </>
      ) : (
        <>
          <Feather name="message-circle" size={22} color={colors.accentBrassSoft} />
          <Txt size={13} color={colors.textFaint} align="center" style={{ alignSelf: 'stretch', lineHeight: 22 }}>
            {emptyText}
          </Txt>
        </>
      )}
    </View>
  );
}

function CommentRow({
  c,
  open,
  onPress,
  children,
}: {
  c: LiveComment;
  open: boolean;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const f = sexOf(c.gender) === 'f';
  const author = commentAuthorLabel(c);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { expanded: open } : undefined}
      style={({ pressed }) => ({
        padding: 12,
        borderRadius: 14,
        backgroundColor: c.mine ? colors.surfaceWhite : colors.surfaceCard,
        borderWidth: 1,
        borderColor: open ? colors.borderSand2 : colors.borderSand,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <Txt size={12.5} weight="semibold" color={f ? colors.accentBrassMuted : colors.primaryTeal600} numberOfLines={1} style={{ flexShrink: 1 }}>
          {c.mine ? `${author} · ${COPY.you}` : author}
        </Txt>
        <View style={{ flex: 1 }} />
        <Txt size={11} color={colors.textGhost} tabular>
          {arClock(c.at)}
        </Txt>
      </View>
      <Txt size={14} color={colors.textInk} selectable style={{ lineHeight: 23, marginTop: 4, alignSelf: 'stretch' }}>
        {c.text}
      </Txt>
      {children}
    </Pressable>
  );
}

function RowAction({
  label,
  icon,
  tone = 'plain',
  busy = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  tone?: 'plain' | 'primary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const fg = tone === 'primary' ? colors.onTealPrimary : tone === 'danger' ? colors.stateDanger : colors.textSlate;
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 34,
        paddingHorizontal: 12,
        borderRadius: radius.pill,
        backgroundColor: tone === 'primary' ? colors.primaryTeal : colors.surfaceInset,
        opacity: disabled && !busy ? 0.45 : pressed || busy ? 0.8 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Feather name={icon} size={13} color={fg} />
      ) : null}
      {/* simple: highQuality breaking mis-measures a fit-content Arabic label on
          Android and drops its last word onto a hidden line (seen on R5CX10P3BPL). */}
      <Txt size={12.5} weight="medium" color={fg} textBreakStrategy="simple">
        {label}
      </Txt>
    </Pressable>
  );
}

// ─── Composer ────────────────────────────────────────────────────────────────

function Composer({
  sessionId,
  visible,
  writeState,
  me,
  myName,
  onGuestGate,
  onSent,
}: {
  sessionId: string;
  visible: boolean;
  writeState: CommentsWriteState;
  me: { gender: Sex; hidden: boolean } | null;
  myName?: string | null;
  onGuestGate: () => void;
  onSent: () => void;
}) {
  const post = usePostLiveComment(sessionId);
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [warn, setWarn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) return;
    // The draft stays for next time; the rest starts fresh.
    setWarn(false);
    setError(null);
  }, [visible]);

  if (writeState === 'guest') {
    return (
      <View style={{ paddingTop: 10, gap: 10, borderTopWidth: 1, borderColor: colors.borderSand }}>
        <Txt size={12.5} color={colors.textFaint} align="center" style={{ alignSelf: 'stretch', lineHeight: 20 }}>
          {COPY.guestLine}
        </Txt>
        <View style={{ flexDirection: 'row' }}>
          <SheetButton label={COPY.guestAction} tone="primary" onPress={onGuestGate} />
        </View>
      </View>
    );
  }
  if (writeState !== 'ok') {
    return (
      <View style={{ paddingTop: 12, borderTopWidth: 1, borderColor: colors.borderSand }}>
        <Txt size={12.5} color={colors.textFaint} align="center" style={{ alignSelf: 'stretch', lineHeight: 20 }}>
          {writeState === 'not_live' ? COPY.notLive : LIVE_COPY.reconnecting}
        </Txt>
      </View>
    );
  }

  const sister = me?.gender === 'f';
  const hiddenSister = sister && !!me?.hidden;
  const namedSister = sister && !me?.hidden;
  const length = liveCommentLength(text);
  const remaining = commentRemainingLine(length, LIVE_COMMENT_MAX_CHARS);
  const busy = post.isPending;
  const canSend = length >= 1 && length <= LIVE_COMMENT_MAX_CHARS && !busy;

  const send = (anon: boolean) => {
    if (busy) return;
    setWarn(false);
    setError(null);
    const body = text.trim();
    post.mutate(
      // One kind in the UI (owner 2026-09-30); the server still stores it.
      { kind: 'comment', text: body, anonymous: anon },
      {
        onSuccess: () => {
          setText('');
          onSent();
        },
        onError: (e) => setError(commentErrorText(e, 'send')),
      },
    );
  };

  const onSendPress = () => {
    if (!canSend) return;
    if (namedSister) {
      setWarn(true); // before EVERY named send (owner)
      return;
    }
    send(hiddenSister ? true : anonymous);
  };

  return (
    <View style={{ paddingTop: 10, gap: 8, borderTopWidth: 1, borderColor: colors.borderSand }}>
      {/* The remainder near the limit */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }} />
        {remaining ? (
          <Txt
            size={11.5}
            tabular
            color={length > LIVE_COMMENT_MAX_CHARS ? colors.stateDanger : colors.textFaint}
            accessibilityLiveRegion="polite"
          >
            {remaining}
          </Txt>
        ) : null}
      </View>

      {warn ? (
        <View
          style={{
            padding: 12,
            gap: 10,
            borderRadius: 14,
            backgroundColor: colors.surfaceCard,
            borderWidth: 1,
            borderColor: 'rgba(176,137,79,0.45)',
          }}
        >
          <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22, alignSelf: 'stretch' }}>
            {namedCommentWarning()}
          </Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SheetButton label={COPY.sendNamed} grow onPress={() => send(false)} />
            <SheetButton label={COPY.sendAnonymous} grow onPress={() => send(true)} />
          </View>
          <Pressable onPress={() => setWarn(false)} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'center' }}>
            <Txt size={13} weight="medium" color={colors.textMuted}>
              {COPY.cancel}
            </Txt>
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(t);
              if (error) setError(null);
            }}
            editable={!busy}
            multiline
            maxLength={1000}
            placeholder={COPY.placeholder}
            placeholderTextColor={colors.textGhost}
            textAlign="right"
            accessibilityLabel={COPY.placeholder}
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 110,
              backgroundColor: colors.surfaceWhite,
              borderWidth: 1.5,
              borderColor: length > LIVE_COMMENT_MAX_CHARS ? colors.accentBrassMuted : colors.borderSand2,
              borderRadius: radius.input,
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: 10,
              fontFamily: fonts.body,
              fontSize: 15,
              color: colors.textInk,
              writingDirection: 'rtl',
              textAlignVertical: 'top',
            }}
          />
          <Pressable
            onPress={onSendPress}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={COPY.send}
            accessibilityState={{ disabled: !canSend, busy }}
            style={({ pressed }) => ({
              width: 46,
              height: 44,
              borderRadius: radius.input,
              backgroundColor: colors.primaryTeal,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !canSend && !busy ? 0.45 : pressed || busy ? 0.8 : 1,
            })}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.onTealPrimary} />
            ) : (
              // RTL: the paper plane points to the reading direction's end.
              <Feather name="send" size={18} color={colors.onTealPrimary} style={{ transform: [{ scaleX: -1 }] }} />
            )}
          </Pressable>
        </View>
      )}

      {/* Name rules */}
      {!warn && me && !sister ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            onPress={() => setAnonymous((v) => !v)}
            disabled={busy}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: anonymous }}
            accessibilityLabel={COPY.anonymous}
            hitSlop={6}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                borderWidth: 1.5,
                borderColor: anonymous ? colors.primaryTeal : colors.borderSand2,
                backgroundColor: anonymous ? colors.primaryTeal : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {anonymous ? <Feather name="check" size={12} color={colors.onTealPrimary} /> : null}
            </View>
            <Txt size={12.5} weight="medium" color={colors.textSlate}>
              {COPY.anonymous}
            </Txt>
          </Pressable>
          <Txt size={12} color={colors.textFaint} numberOfLines={1} style={{ flex: 1 }}>
            {commentNameLine(anonymous, myName)}
          </Txt>
        </View>
      ) : null}
      {!warn && hiddenSister ? (
        <Txt size={12} color={colors.textFaint} style={{ lineHeight: 19, alignSelf: 'stretch' }}>
          {COPY.hiddenSister}
        </Txt>
      ) : null}

      <SheetError text={error} />
    </View>
  );
}
