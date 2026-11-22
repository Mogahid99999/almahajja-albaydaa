/**
 * «التعليقات والأسئلة أثناء البث» — comments and questions during a live
 * «مجلس» (V23, migration 0147). The only place that talks to the comments
 * backend:
 *  - reads: rpc get_live_comments (the room's list — refetch on join) and the
 *    staff-only admin_live_comments (the admin page after the majlis, deleted
 *    ones included);
 *  - writes: the `live-control` edge function actions comment /
 *    comment_delete / comment_answered / comment_block. Every refusal is a
 *    {@link LiveControlError} with the server's code (see below) so the UI maps
 *    it to Arabic copy;
 *  - live updates: LiveKit data messages on topic {@link LIVE_COMMENTS_TOPIC}
 *    — decode them with {@link parseCommentsMessage}.
 *
 * Privacy (owner, final): «بدون اسم» is hidden from EVERYONE — sheikh and admins
 * included. `name === null` means nameless; the server never sends a user id or
 * a nameless author's name. `mine` is only ever set on the caller's own reads.
 *
 * live-control error codes (HTTP status):
 *   guest_cannot_comment 403 («سجّل أولاً») · not_live 409 (green or over) ·
 *   not_present 409 (not in the room) · blocked 403 (blocked from commenting in
 *   this majlis) · blocked_words 400 · empty 400 · too_long 400 (> 1000; 300 before 0182) ·
 *   comments_closed 409 (0182: a moderator closed the comments) ·
 *   rate_limited 429 (one per 10 s) · forbidden 403 · not_found 404 ·
 *   invalid_target 409 (blocking one's own comment) · bad_request 400 ·
 *   banned 403 · unauthorized 401 · server_error 500 · network (no response).
 */
import { invokeLiveControl, LiveControlError } from '@/api/live';
import { supabase } from '@/lib/supabase';

export type LiveCommentKind = 'comment' | 'question';

export type LiveComment = {
  id: string;
  kind: LiveCommentKind;
  text: string;
  /** null = «بدون اسم» (nameless). */
  name: string | null;
  gender: 'm' | 'f';
  answered: boolean;
  /** 0182: its author edited it («معدّل»). */
  edited?: boolean;
  /** Server time of posting, 'YYYY-MM-DDTHH:MM:SS.mmmZ' (UTC) — `new Date(at)` works on Hermes. */
  at: string;
  /** Reads only: the caller wrote it. Never part of a broadcast. */
  mine?: boolean;
  /** admin_live_comments only. */
  deleted?: boolean;
};

export type LiveCommentsMessage =
  | { t: 'add'; c: LiveComment }
  | { t: 'del'; id: string }
  | { t: 'ans'; id: string; answered: boolean }
  // 0182
  | { t: 'edit'; c: LiveComment }
  | { t: 'closed'; closed: boolean }
  // 0183: the pinned comment, or null when the pin was cleared
  | { t: 'pin'; c: LiveComment | null };

/** 0182/0183: what the room needs beside the list. */
export type LiveCommentsState = { closed: boolean; pinned: LiveComment | null };

/** LiveKit data topic of the comment stream (live-control broadcasts, RELIABLE). */
export const LIVE_COMMENTS_TOPIC = 'comments';
/** Same as the server (live_comments.body check): 1–1000 characters after trimming (300 before 0182). */
export const LIVE_COMMENT_MAX_CHARS = 1000;
/** Server rate limit: one comment per 10 s per user per majlis (429 rate_limited). */
export const LIVE_COMMENT_RATE_LIMIT_MS = 10_000;
/** A comment data message is < 2 KB; anything this big is not ours. */
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_NAME_CHARS = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ISO 8601 date-time with a zone. The server sends 'YYYY-MM-DDTHH:MM:SS.mmmZ' (UTC). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** Characters as the server counts them (code points — an emoji is one). */
export function liveCommentLength(text: string): number {
  return Array.from(text.trim()).length;
}

const isId = (x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x);

/**
 * One comment from a read or a broadcast → {@link LiveComment}; null when
 * malformed. `mine` / `deleted` are kept only when they are booleans.
 */
export function toLiveComment(raw: unknown): LiveComment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isId(r.id)) return null;
  if (r.kind !== 'comment' && r.kind !== 'question') return null;
  if (typeof r.text !== 'string') return null;
  const len = liveCommentLength(r.text);
  if (len < 1 || len > LIVE_COMMENT_MAX_CHARS) return null;
  if (r.name !== null && r.name !== undefined && typeof r.name !== 'string') return null;
  if (typeof r.name === 'string' && Array.from(r.name).length > MAX_NAME_CHARS) return null;
  if (r.gender !== 'm' && r.gender !== 'f') return null;
  if (typeof r.answered !== 'boolean') return null;
  if (typeof r.at !== 'string' || !ISO_RE.test(r.at)) return null;
  const c: LiveComment = {
    id: r.id,
    kind: r.kind,
    text: r.text,
    // An empty name is treated as nameless — never show a blank author.
    name: typeof r.name === 'string' && r.name.trim() ? r.name : null,
    gender: r.gender,
    answered: r.answered,
    at: r.at,
  };
  if (r.edited === true) c.edited = true;
  if (typeof r.mine === 'boolean') c.mine = r.mine;
  if (typeof r.deleted === 'boolean') c.deleted = r.deleted;
  return c;
}

function toLiveCommentList(data: unknown): LiveComment[] {
  if (!Array.isArray(data)) return [];
  const out: LiveComment[] = [];
  for (const row of data) {
    const c = toLiveComment(row);
    if (c) out.push(c);
  }
  return out;
}

// ─── Reads ─────────────────────────────────────────────────────────────────────
// `as never`: the 0147 RPCs reach database.generated.ts only at the next regen.

/**
 * get_live_comments (0147) — the room's list, oldest first: the 500 newest
 * non-deleted comments, each with `mine`. Allowed for staff (any session) and
 * for a participant of the session (guests included) while it is green or
 * live; anyone else gets the RPC's error (42501 «غير مصرح»), thrown as is.
 */
export async function getLiveComments(sessionId: string): Promise<LiveComment[]> {
  const { data, error } = await supabase.rpc(
    'get_live_comments' as never,
    { p_session: sessionId } as never,
  );
  if (error) throw error;
  return toLiveCommentList(data);
}

/**
 * admin_live_comments (0147) — staff only (admin / publisher / sheikh): every
 * comment of a session incl. deleted ones (`deleted: true`), oldest first
 * (the 5000 newest). Nameless stays nameless here too.
 */
export async function getAdminLiveComments(sessionId: string): Promise<LiveComment[]> {
  const { data, error } = await supabase.rpc(
    'admin_live_comments' as never,
    { p_session: sessionId } as never,
  );
  if (error) throw error;
  return toLiveCommentList(data);
}

// ─── Writes (live-control) ─────────────────────────────────────────────────────

/**
 * Post a comment / question (live sessions only; registered participants).
 * `anonymous: true` = «بدون اسم». A sister who joined without her name is
 * always nameless, whatever is sent. Empty / over-long text is refused locally
 * with the server's own codes (no round trip). Resolves to the stored comment
 * (`mine: true`) — the same one the room receives.
 */
export async function postLiveComment(input: {
  sessionId: string;
  kind: LiveCommentKind;
  text: string;
  anonymous: boolean;
}): Promise<LiveComment> {
  const len = liveCommentLength(input.text);
  if (len === 0) throw new LiveControlError('empty');
  if (len > LIVE_COMMENT_MAX_CHARS) throw new LiveControlError('too_long');
  const d = await invokeLiveControl('comment', {
    sessionId: input.sessionId,
    kind: input.kind,
    text: input.text,
    anonymous: input.anonymous,
  });
  const c = toLiveComment(d.comment);
  if (!c) throw new LiveControlError('unknown');
  return { ...c, mine: true };
}

/** 0182: the author edits his own comment while live → the updated comment (mine: true). */
export async function editLiveComment(sessionId: string, commentId: string, text: string): Promise<LiveComment> {
  const len = liveCommentLength(text);
  if (len === 0) throw new LiveControlError('empty');
  if (len > LIVE_COMMENT_MAX_CHARS) throw new LiveControlError('too_long');
  const d = await invokeLiveControl('comment_edit', { sessionId, commentId, text });
  const c = toLiveComment(d.comment);
  if (!c) throw new LiveControlError('unknown');
  return { ...c, mine: true };
}

/** 0182: close / reopen the comments of a majlis — host / moderators / content managers. */
export async function setLiveCommentsClosed(sessionId: string, closed: boolean): Promise<void> {
  await invokeLiveControl('comments_close', { sessionId, closed });
}

/**
 * 0182: whether the comments are closed; 0183: the pinned comment (same access as
 * get_live_comments; closed false / pinned null when unknown).
 */
export async function getLiveCommentsState(sessionId: string): Promise<LiveCommentsState> {
  const { data, error } = await supabase.rpc('get_live_comments_state' as never, { p_session: sessionId } as never);
  if (error) throw error;
  const d = data as { closed?: unknown; pinned?: unknown } | null;
  const pinned = d?.pinned ? toLiveComment(d.pinned) : null;
  if (pinned) {
    delete pinned.mine;
    delete pinned.deleted;
  }
  return { closed: d?.closed === true, pinned };
}

/** 0183: pin a comment of this majlis for everyone (null = clear the pin) — host / moderators / content managers. */
export async function setLiveCommentPinned(sessionId: string, commentId: string | null): Promise<LiveComment | null> {
  const d = await invokeLiveControl('comment_pin', { sessionId, commentId });
  if (d.pinned === null || d.pinned === undefined) return null;
  const c = toLiveComment(d.pinned);
  if (!c) throw new LiveControlError('unknown');
  delete c.mine;
  delete c.deleted;
  return c;
}

/** Soft-delete: the author, or the session's host / moderators / a content manager. Idempotent. */
export async function deleteLiveComment(sessionId: string, commentId: string): Promise<void> {
  await invokeLiveControl('comment_delete', { sessionId, commentId });
}

/** «تمت الإجابة» on / off — host / moderators / content managers. */
export async function setLiveCommentAnswered(
  sessionId: string,
  commentId: string,
  answered: boolean,
): Promise<void> {
  await invokeLiveControl('comment_answered', { sessionId, commentId, answered });
}

/**
 * «منع من التعليق»: the comment's author may not comment again in this majlis,
 * and that comment is deleted — host / moderators / content managers. The
 * server never says who the author was.
 */
export async function blockLiveCommentAuthor(sessionId: string, commentId: string): Promise<void> {
  await invokeLiveControl('comment_block', { sessionId, commentId });
}

// ─── Data messages (topic "comments") ──────────────────────────────────────────

/** Strict UTF-8 → string without TextDecoder; null on any invalid sequence. */
function decodeUtf8Strict(b: Uint8Array): string | null {
  const cps: number[] = [];
  let out = '';
  for (let i = 0; i < b.length; ) {
    const c0 = b[i];
    let cp: number;
    let n: number;
    if (c0 < 0x80) {
      cp = c0;
      n = 0;
    } else if (c0 >= 0xc2 && c0 <= 0xdf) {
      cp = c0 & 0x1f;
      n = 1;
    } else if (c0 >= 0xe0 && c0 <= 0xef) {
      cp = c0 & 0x0f;
      n = 2;
    } else if (c0 >= 0xf0 && c0 <= 0xf4) {
      cp = c0 & 0x07;
      n = 3;
    } else {
      return null;
    }
    if (i + n >= b.length && n > 0) return null;
    for (let k = 1; k <= n; k++) {
      const cc = b[i + k];
      if ((cc & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (cc & 0x3f);
    }
    if (n === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) return null;
    if (n === 3 && (cp < 0x10000 || cp > 0x10ffff)) return null;
    cps.push(cp);
    if (cps.length >= 4096) {
      out += String.fromCodePoint(...cps);
      cps.length = 0;
    }
    i += n + 1;
  }
  return out + (cps.length ? String.fromCodePoint(...cps) : '');
}

/** UTF-8 bytes → string: TextDecoder when the runtime has one, else the strict fallback. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  const TD = (globalThis as { TextDecoder?: new (label?: string, opts?: { fatal?: boolean }) => { decode(b: Uint8Array): string } })
    .TextDecoder;
  if (typeof TD === 'function') {
    try {
      return new TD('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // invalid bytes (fatal) or a partial implementation — the fallback decides
    }
  }
  return decodeUtf8Strict(bytes);
}

/**
 * A LiveKit data message on topic "comments" → the update, or null for
 * anything malformed (bad UTF-8 / JSON, unknown `t`, a comment that isn't the
 * public shape). An added comment never carries `mine` / `deleted` (the room
 * doesn't know who wrote it; compare ids with your own posts instead).
 */
export function parseCommentsMessage(payload: Uint8Array): LiveCommentsMessage | null {
  // isView, not instanceof: a Uint8Array from another realm (a polyfill, a test runner) is still bytes.
  if (!payload || !ArrayBuffer.isView(payload)) return null;
  const view: ArrayBufferView = payload;
  const bytes = view instanceof Uint8Array ? view : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (bytes.length === 0 || bytes.length > MAX_MESSAGE_BYTES) return null;
  const text = decodeUtf8(bytes);
  if (text === null) return null;
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const msg = m as Record<string, unknown>;
  switch (msg.t) {
    case 'add': {
      const c = toLiveComment(msg.c);
      if (!c) return null;
      delete c.mine;
      delete c.deleted;
      return { t: 'add', c };
    }
    case 'del':
      return isId(msg.id) ? { t: 'del', id: msg.id } : null;
    case 'ans':
      return isId(msg.id) && typeof msg.answered === 'boolean' ? { t: 'ans', id: msg.id, answered: msg.answered } : null;
    case 'edit': {
      const c = toLiveComment(msg.c);
      if (!c) return null;
      delete c.mine;
      delete c.deleted;
      return { t: 'edit', c };
    }
    case 'closed':
      return typeof msg.closed === 'boolean' ? { t: 'closed', closed: msg.closed } : null;
    case 'pin': {
      if (msg.c === null) return { t: 'pin', c: null };
      const c = toLiveComment(msg.c);
      if (!c) return null;
      delete c.mine;
      delete c.deleted;
      return { t: 'pin', c };
    }
    default:
      return null;
  }
}
