/**
 * supabase/functions/_shared/liveRules.ts — who gets what in a live «الحلقة»
 * (PLAN_LIVE_V23 §5.1/§5.2, decisions D1–D4), shared by live-token/live-control.
 */
import {
  auditAction,
  authorizeCommentAction,
  authorizeLiveAction,
  canJoin,
  canModerateComments,
  canSpeak,
  canTarget,
  COMMENT_ACTIONS,
  COMMENT_MAX_CHARS,
  commentAuditAction,
  commentLength,
  commentRpcErrorCode,
  COMMENTS_TOPIC,
  commentsMessage,
  commentStatusVerdict,
  commentTextVerdict,
  envFromRoomPrefix,
  isCommentAction,
  parseLiveCommentRequest,
  preauthorizeCommentAction,
  shouldBroadcastComments,
  toPublicComment,
  HAND_RATE_LIMIT_MS,
  handAttribute,
  handRateLimited,
  handVerdict,
  hostAbsenceExpired,
  isBanned,
  isEnvRoom,
  isLiveIdentity,
  jwtHeaderAlg,
  jwtRoleClaim,
  liveGrantsFor,
  LIVE_ACTIONS,
  LIVE_ERROR_STATUS,
  LIVE_GRANTS,
  type LiveAction,
  type LiveActor,
  liveEnabledFor,
  liveGender,
  liveRoleFor,
  livekitWsUrl,
  parseLiveControlRequest,
  parseLiveEnabledLevel,
  parseLiveJoinContext,
  parseLiveTokenRequest,
  participantAttributes,
  preauthorizeLiveAction,
  participantDisplayName,
  realDisplayName,
  RECORDING_AUDIO,
  recordingFilepath,
  recordingPartRpcErrorCode,
  resolveHiddenName,
  RESUME_REASONS,
  safeEqual,
  speakerPermission,
  statusAfter,
  statusRpcErrorCode,
  SYSTEM_ACTIONS,
} from '../../supabase/functions/_shared/liveRules';

const SESSION = '3f2b8c1e-9a4d-4c7e-8b1a-2d5e6f708192';
const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const HOST = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const user = (over: Partial<Extract<LiveActor, { kind: 'user' }>> = {}): LiveActor => ({
  kind: 'user',
  appRole: 'student',
  isGuest: false,
  isHost: false,
  liveRole: 'listener',
  ...over,
});

describe('§5.1 grants table', () => {
  test('listeners only subscribe; nobody is roomAdmin', () => {
    expect(LIVE_GRANTS.listener).toEqual({
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      roomAdmin: false,
    });
    for (const role of ['host', 'moderator'] as const) {
      expect(LIVE_GRANTS[role]).toEqual({
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canUpdateOwnMetadata: false,
        roomAdmin: false,
      });
    }
    // An approved speaker who reconnects keeps the mic, but no data channel.
    expect(LIVE_GRANTS.speaker).toMatchObject({ canPublish: true, canPublishData: false, roomAdmin: false });
  });

  test('approve/demote spell out the WHOLE permission (LiveKit replaces it)', () => {
    expect(speakerPermission(true)).toEqual({
      canSubscribe: true,
      canPublish: true,
      canPublishData: false,
      canUpdateMetadata: false,
      hidden: false,
    });
    expect(speakerPermission(false)).toMatchObject({ canSubscribe: true, canPublish: false });
  });

  test('the P4 attribute-spoofing regression: no token or permission lets a participant write attributes or his name', () => {
    // LiveKit lets a holder of canUpdateOwnMetadata / canUpdateMetadata set ANY
    // attribute and his own name — a listener could claim r=host (the client
    // seats the sheikh by attribute r) or rename himself.
    for (const role of ['listener', 'speaker', 'host', 'moderator'] as const) {
      expect(LIVE_GRANTS[role].canUpdateOwnMetadata).toBe(false);
      expect(LIVE_GRANTS[role].roomAdmin).toBe(false);
    }
    for (const canPublish of [true, false]) {
      expect(speakerPermission(canPublish).canUpdateMetadata).toBe(false);
    }
  });
});

describe('role in the session', () => {
  test('host, moderators (admin/publisher/sheikh), approved speaker, listener', () => {
    const base = { userId: USER, isGuest: false, hostUserId: HOST };
    expect(liveRoleFor({ ...base, userId: HOST, appRole: 'sheikh' })).toBe('host');
    for (const r of ['admin', 'publisher', 'sheikh']) {
      expect(liveRoleFor({ ...base, appRole: r })).toBe('moderator');
    }
    expect(liveRoleFor({ ...base, appRole: 'student' })).toBe('listener');
  });

  test('a speaker re-joining after a network drop keeps the mic (new token from the stored role)', () => {
    // live-token reads live_participants.role; only an explicit leave/demote resets it.
    const role = liveRoleFor({ userId: USER, appRole: 'student', isGuest: false, hostUserId: HOST, storedRole: 'speaker' });
    expect(role).toBe('speaker');
    expect(LIVE_GRANTS[role].canPublish).toBe(true);
    expect(participantAttributes({ gender: 'm', role, hiddenName: false })).toMatchObject({ r: 'speaker', h: '0' });
  });

  test('a guest is never staff, whatever the profile says', () => {
    expect(liveRoleFor({ userId: HOST, appRole: 'admin', isGuest: true, hostUserId: HOST })).toBe('listener');
  });

  test('guests listen only (owner 2026-09-28): a stored speaker role never gives a guest the mic', () => {
    // e.g. a guest approved by a P2 server, before the rule was enforced.
    expect(liveRoleFor({ userId: USER, appRole: null, isGuest: true, hostUserId: HOST, storedRole: 'speaker' })).toBe(
      'listener',
    );
  });

  test('green admits host/moderators only; live admits everyone; over is over', () => {
    expect(canJoin('green', 'host')).toEqual({ ok: true });
    expect(canJoin('green', 'moderator')).toEqual({ ok: true });
    expect(canJoin('green', 'listener')).toEqual({ ok: false, code: 'not_open' });
    expect(canJoin('live', 'listener')).toEqual({ ok: true });
    expect(canJoin('scheduled', 'host')).toEqual({ ok: false, code: 'not_open' });
    for (const s of ['ended', 'processing', 'ready', 'failed', 'cancelled']) {
      expect(canJoin(s, 'host')).toEqual({ ok: false, code: 'ended' });
    }
  });
});

describe('names and privacy (decision 3, D2 as changed 2026-09-28)', () => {
  test('profiles gender → m/f; missing means ask first', () => {
    expect(liveGender('male')).toBe('m');
    expect(liveGender('female')).toBe('f');
    expect(liveGender(null)).toBeNull();
    expect(liveGender('x')).toBeNull();
  });

  test('only a sister may hide; undecided sisters are hidden by default', () => {
    expect(resolveHiddenName('m', 'hidden')).toBe(false);
    expect(resolveHiddenName('f', 'named', true)).toBe(false);
    expect(resolveHiddenName('f', 'hidden', false)).toBe(true);
    expect(resolveHiddenName('f', null, false)).toBe(false); // remembered choice
    expect(resolveHiddenName('f')).toBe(true);
  });

  test('«طالبة» for a hidden sister, «ضيف»/«ضيفة» for guests, the real name otherwise', () => {
    const base = { isGuest: false, hiddenName: false, role: 'listener' as const };
    expect(participantDisplayName({ ...base, gender: 'f', hiddenName: true, displayName: 'فاطمة' })).toBe('طالبة');
    expect(participantDisplayName({ ...base, gender: 'm', displayName: '  عبد   الله ' })).toBe('عبد الله');
    expect(participantDisplayName({ ...base, gender: 'f', displayName: 'مريم' })).toBe('مريم');
    expect(participantDisplayName({ ...base, isGuest: true, gender: 'm', displayName: 'x' })).toBe('ضيف');
    expect(participantDisplayName({ ...base, isGuest: true, gender: 'f' })).toBe('ضيفة');
    expect(participantDisplayName({ ...base, gender: 'm', displayName: '' })).toBe('طالب');
    expect(participantDisplayName({ ...base, role: 'moderator', gender: 'm', displayName: null })).toBe('مشرف');
  });

  test('D2: the DB keeps the REAL name even for a hidden sister; the room name stays «طالبة»', () => {
    // Stored for moderators (get_live_participants)…
    expect(realDisplayName('  مريم   بنت  محمد ')).toBe('مريم بنت محمد');
    expect(realDisplayName('')).toBeNull();
    expect(realDisplayName(null)).toBeNull();
    expect(realDisplayName('ا'.repeat(150))).toHaveLength(120);
    // …while the LiveKit name, broadcast to everyone, never carries it.
    expect(
      participantDisplayName({ isGuest: false, gender: 'f', hiddenName: true, role: 'listener', displayName: 'مريم' }),
    ).toBe('طالبة');
  });

  test('room attributes carry gender, role, lowered hand, hidden flag — no user id', () => {
    expect(participantAttributes({ gender: 'f', role: 'listener', hiddenName: true })).toEqual({
      g: 'f',
      r: 'listener',
      h: '0',
      hid: '1',
      rx: '1',
    });
    // 0157: a moderator stopped this attendee's reactions → rx '0'.
    expect(participantAttributes({ gender: 'm', role: 'speaker', hiddenName: false, reactionsBlocked: true }).rx).toBe('0');
  });

  test('identity is the 16-hex SQL live_identity — never a raw user id', () => {
    expect(isLiveIdentity('0123456789abcdef')).toBe(true);
    expect(isLiveIdentity(USER)).toBe(false);
    expect(isLiveIdentity('0123456789ABCDEF')).toBe(false);
  });
});

describe('§5.2 action → permission (D1)', () => {
  test('students and guests may only leave, toggle their own hand (or a speaker step himself down)', () => {
    for (const action of LIVE_ACTIONS) {
      if (action === 'hand') continue; // below
      const expected = action === 'leave' ? { ok: true } : { ok: false, code: 'forbidden' };
      expect(authorizeLiveAction(action, user())).toEqual(expected);
      expect(authorizeLiveAction(action, user({ isGuest: true, appRole: null }))).toEqual(expected);
    }
    expect(authorizeLiveAction('hand', user(), { up: true })).toEqual({ ok: true });
    expect(authorizeLiveAction('hand', user({ isGuest: true, appRole: null }), { up: true })).toEqual({
      ok: false,
      code: 'guest_cannot_speak',
    });
    expect(authorizeLiveAction('demote', user({ liveRole: 'speaker' }), { targetIsSelf: true })).toEqual({ ok: true });
    expect(authorizeLiveAction('demote', user({ isGuest: true, liveRole: 'speaker' }), { targetIsSelf: true })).toEqual({
      ok: true,
    });
  });

  test('first gate: students/guests are refused everything but leave/step-down/own hand before any lookup', () => {
    for (const action of LIVE_ACTIONS) {
      const ok = action === 'leave' || action === 'demote' || action === 'hand';
      const lower = { up: false };
      expect(preauthorizeLiveAction(action, { appRole: 'student', isGuest: false }, lower).ok).toBe(ok);
      expect(preauthorizeLiveAction(action, { appRole: null, isGuest: true }, lower).ok).toBe(ok);
      expect(preauthorizeLiveAction(action, { appRole: 'admin', isGuest: true }, lower).ok).toBe(ok);
      expect(preauthorizeLiveAction(action, { appRole: 'sheikh', isGuest: false }, lower).ok).toBe(!SYSTEM_ACTIONS.includes(action));
    }
    // Everything else is refused as `forbidden` — only a guest's raise has its own code.
    expect(preauthorizeLiveAction('approve', { appRole: 'student', isGuest: false })).toEqual({ ok: false, code: 'forbidden' });
    expect(preauthorizeLiveAction('approve', { appRole: null, isGuest: true })).toEqual({ ok: false, code: 'forbidden' });
  });

  test('D1: a speaker cannot demote ANOTHER speaker; moderators can', () => {
    expect(authorizeLiveAction('demote', user({ liveRole: 'speaker' }), { targetIsSelf: false })).toEqual({
      ok: false,
      code: 'forbidden',
    });
    for (const appRole of ['admin', 'publisher', 'sheikh']) {
      expect(authorizeLiveAction('demote', user({ appRole, liveRole: 'moderator' }))).toEqual({ ok: true });
      for (const a of ['approve', 'reject', 'mute', 'set_allow_requests'] as LiveAction[]) {
        expect(authorizeLiveAction(a, user({ appRole, liveRole: 'moderator' }))).toEqual({ ok: true });
      }
    }
  });

  test('lifecycle: the host or a content manager; a non-hosting sheikh cannot end it', () => {
    for (const a of ['open_green', 'start', 'end'] as LiveAction[]) {
      expect(authorizeLiveAction(a, user({ appRole: 'sheikh', isHost: true }))).toEqual({ ok: true });
      expect(authorizeLiveAction(a, user({ appRole: 'admin' }))).toEqual({ ok: true });
      expect(authorizeLiveAction(a, user({ appRole: 'publisher' }))).toEqual({ ok: true });
      expect(authorizeLiveAction(a, user({ appRole: 'sheikh', isHost: false }))).toEqual({ ok: false, code: 'forbidden' });
    }
  });

  test('host_leave is the host\'s alone', () => {
    expect(authorizeLiveAction('host_leave', user({ appRole: 'sheikh', isHost: true }))).toEqual({ ok: true });
    expect(authorizeLiveAction('host_leave', user({ appRole: 'admin' }))).toEqual({ ok: false, code: 'forbidden' });
  });

  test('auto_end / resume_recording are the service role\'s ONLY actions, and nobody else\'s (D4, 0146)', () => {
    expect([...SYSTEM_ACTIONS].sort()).toEqual(['auto_end', 'resume_recording']);
    for (const action of LIVE_ACTIONS) {
      expect(authorizeLiveAction(action, { kind: 'system' }).ok).toBe(SYSTEM_ACTIONS.includes(action));
    }
    for (const appRole of ['admin', 'publisher', 'sheikh', 'student']) {
      expect(authorizeLiveAction('auto_end', user({ appRole, isHost: true }))).toEqual({ ok: false, code: 'forbidden' });
    }
    expect(auditAction('auto_end', { next: 'ended' })).toBe('auto_end');
    expect(auditAction('end', { next: 'ended' })).toBe('end');
    expect(hostAbsenceExpired(Date.parse('2026-09-28T10:00:00Z'), Date.parse('2026-09-28T10:09:59Z'))).toBe(false);
    expect(hostAbsenceExpired(Date.parse('2026-09-28T10:00:00Z'), Date.parse('2026-09-28T10:10:00Z'))).toBe(true);
    expect(hostAbsenceExpired(null, Date.now())).toBe(false);
  });

  test('targets: approve/reject listeners, demote speakers only, never mute the host', () => {
    expect(canTarget('approve', 'listener').ok).toBe(true);
    expect(canTarget('approve', 'speaker').ok).toBe(false);
    expect(canTarget('reject', 'listener').ok).toBe(true);
    expect(canTarget('demote', 'speaker').ok).toBe(true);
    expect(canTarget('demote', 'moderator').ok).toBe(false);
    expect(canTarget('demote', 'host').ok).toBe(false);
    expect(canTarget('mute', 'speaker').ok).toBe(true);
    expect(canTarget('mute', 'host').ok).toBe(false);
    expect(canTarget('host_leave', 'moderator').ok).toBe(true);
    expect(canTarget('host_leave', 'speaker').ok).toBe(false);
  });

  test('audit names match the live_moderation_log check list (0135, + resume_recording in 0146)', () => {
    const allowed = [
      'open_green', 'start', 'end', 'cancel', 'approve', 'reject', 'mute', 'demote',
      'step_down', 'set_allow_requests', 'host_leave', 'auto_end', 'resume_recording',
      'react_block', // 0157
    ];
    for (const action of LIVE_ACTIONS) {
      for (const ctx of [{}, { targetIsSelf: true }, { next: 'cancelled' as const }]) {
        const a = auditAction(action, ctx);
        if (a !== null) expect(allowed).toContain(a);
      }
    }
    expect(auditAction('leave')).toBeNull();
    expect(auditAction('hand')).toBeNull(); // not in the 0135 check list — a request isn't a moderation act
    expect(auditAction('demote', { targetIsSelf: true })).toBe('step_down');
    expect(auditAction('end', { next: 'cancelled' })).toBe('cancel');
  });
});

describe('P4 hand «طلب التحدث» and guests (owner 2026-09-28: guests listen only)', () => {
  test('guests listen only (owner 2026-09-28): a guest raising his hand is guest_cannot_speak, before any lookup', () => {
    for (const appRole of [null, 'student', 'admin']) {
      expect(preauthorizeLiveAction('hand', { appRole, isGuest: true }, { up: true })).toEqual({
        ok: false,
        code: 'guest_cannot_speak',
      });
      expect(authorizeLiveAction('hand', user({ appRole, isGuest: true }), { up: true })).toEqual({
        ok: false,
        code: 'guest_cannot_speak',
      });
    }
    // A missing `up` is treated as a raise (strict).
    expect(preauthorizeLiveAction('hand', { appRole: null, isGuest: true })).toEqual({ ok: false, code: 'guest_cannot_speak' });
    expect(authorizeLiveAction('hand', user({ isGuest: true }))).toEqual({ ok: false, code: 'guest_cannot_speak' });
    expect(LIVE_ERROR_STATUS.guest_cannot_speak).toBe(403);
  });

  test('a registered listener may raise; lowering is allowed for anyone (idempotent)', () => {
    expect(preauthorizeLiveAction('hand', { appRole: 'student', isGuest: false }, { up: true })).toEqual({ ok: true });
    expect(authorizeLiveAction('hand', user(), { up: true })).toEqual({ ok: true });
    expect(canTarget('hand', 'listener', { up: true })).toEqual({ ok: true });
    for (const [appRole, isGuest] of [['student', false], [null, true], ['sheikh', false]] as const) {
      expect(preauthorizeLiveAction('hand', { appRole, isGuest }, { up: false })).toEqual({ ok: true });
      expect(authorizeLiveAction('hand', user({ appRole, isGuest }), { up: false })).toEqual({ ok: true });
    }
    for (const role of ['listener', 'speaker', 'host', 'moderator']) {
      expect(canTarget('hand', role, { up: false })).toEqual({ ok: true });
    }
    // The service role (media worker) never touches hands.
    expect(authorizeLiveAction('hand', { kind: 'system' }, { up: false })).toEqual({ ok: false, code: 'forbidden' });
  });

  test('only a listener raises: a speaker (or staff) up:true is invalid_target', () => {
    for (const role of ['speaker', 'host', 'moderator', null]) {
      expect(canTarget('hand', role, { up: true })).toEqual({ ok: false, code: 'invalid_target' });
    }
    expect(canTarget('hand', 'speaker')).toEqual({ ok: false, code: 'invalid_target' }); // missing up = raise
  });

  test('live sessions only', () => {
    expect(statusAfter('hand', 'live')).toEqual({ ok: true, next: 'live' });
    for (const s of ['scheduled', 'green', 'ended', 'processing', 'cancelled']) {
      expect(statusAfter('hand', s)).toEqual({ ok: false, code: 'invalid_state' });
    }
  });

  test('rate limit edges: 4999 ms limited, 5000 ms free, never toggled free', () => {
    const now = Date.parse('2026-09-29T10:00:05Z');
    expect(HAND_RATE_LIMIT_MS).toBe(5000);
    expect(handRateLimited(now - 4999, now)).toBe(true);
    expect(handRateLimited(now - 5000, now)).toBe(false);
    expect(handRateLimited(now - 60_000, now)).toBe(false);
    expect(handRateLimited(null, now)).toBe(false);
    expect(handRateLimited(undefined, now)).toBe(false);
    expect(handRateLimited(Number.NaN, now)).toBe(false); // unparsable hand_at
    expect(LIVE_ERROR_STATUS.rate_limited).toBe(429);
  });

  test('raising needs «استقبال طلبات التحدث» and the rate limit; lowering is never refused', () => {
    const now = Date.parse('2026-09-29T10:00:05Z');
    const base = { up: true, allowRequests: true, lastToggleMs: null, nowMs: now };
    expect(handVerdict(base)).toEqual({ ok: true });
    expect(handVerdict({ ...base, allowRequests: false })).toEqual({ ok: false, code: 'requests_closed' });
    expect(handVerdict({ ...base, lastToggleMs: now - 4999 })).toEqual({ ok: false, code: 'rate_limited' });
    expect(handVerdict({ ...base, lastToggleMs: now - 5000 })).toEqual({ ok: true });
    // requests closed wins over the rate limit (the more useful message)
    expect(handVerdict({ ...base, allowRequests: false, lastToggleMs: now - 1 })).toEqual({ ok: false, code: 'requests_closed' });
    // A hand is never trapped up: lowering ignores both.
    expect(handVerdict({ ...base, up: false, allowRequests: false, lastToggleMs: now - 1 })).toEqual({ ok: true });
    expect(LIVE_ERROR_STATUS.requests_closed).toBe(409);
  });

  test('h = raise time in epoch seconds (> 1, parseHand orders by it) / "0" down', () => {
    const now = Date.parse('2026-09-29T10:00:05.987Z');
    expect(handAttribute(true, now)).toBe(String(Math.floor(now / 1000)));
    expect(Number(handAttribute(true, now))).toBeGreaterThan(1);
    expect(handAttribute(false, now)).toBe('0');
  });

  test('approve refuses a guest target (read fresh from auth.users.is_anonymous)', () => {
    expect(canSpeak({ isGuest: true })).toEqual({ ok: false, code: 'guest_cannot_speak' });
    expect(canSpeak({ isGuest: false })).toEqual({ ok: true });
  });
});

describe('resume_recording (0146: a new egress after one died mid-session) — service role only', () => {
  test('only the service role may call it; no user — not an admin, not the host — ever', () => {
    expect(authorizeLiveAction('resume_recording', { kind: 'system' })).toEqual({ ok: true });
    for (const appRole of ['admin', 'publisher', 'sheikh', 'student', null]) {
      for (const isHost of [true, false]) {
        expect(authorizeLiveAction('resume_recording', user({ appRole, isHost, liveRole: isHost ? 'host' : 'moderator' }))).toEqual({
          ok: false,
          code: 'forbidden',
        });
      }
      // refused at the first gate, before any lookup
      expect(preauthorizeLiveAction('resume_recording', { appRole, isGuest: false })).toEqual({ ok: false, code: 'forbidden' });
      expect(preauthorizeLiveAction('resume_recording', { appRole, isGuest: true })).toEqual({ ok: false, code: 'forbidden' });
    }
    // and the service role still cannot do anything else
    for (const action of ['start', 'end', 'approve', 'demote', 'hand', 'open_green'] as LiveAction[]) {
      expect(authorizeLiveAction(action, { kind: 'system' })).toEqual({ ok: false, code: 'forbidden' });
    }
  });

  test('live sessions only; the status stays live', () => {
    expect(statusAfter('resume_recording', 'live')).toEqual({ ok: true, next: 'live' });
    for (const from of ['scheduled', 'green', 'ended', 'processing', 'ready', 'failed', 'cancelled']) {
      expect(statusAfter('resume_recording', from)).toEqual({ ok: false, code: 'invalid_state' });
    }
  });

  test('audited as resume_recording', () => {
    expect(auditAction('resume_recording', { next: 'live' })).toBe('resume_recording');
  });

  test('request: reason optional, from RESUME_REASONS only (and never an auto_end reason)', () => {
    expect(parseLiveControlRequest({ action: 'resume_recording', sessionId: SESSION })).toMatchObject({
      ok: true,
      value: { action: 'resume_recording', sessionId: SESSION, reason: null },
    });
    for (const reason of RESUME_REASONS) {
      expect(parseLiveControlRequest({ action: 'resume_recording', sessionId: SESSION, reason })).toMatchObject({
        ok: true,
        value: { reason },
      });
    }
    expect(parseLiveControlRequest({ action: 'resume_recording', sessionId: SESSION, reason: 'host_absent' }).ok).toBe(false);
    expect(parseLiveControlRequest({ action: 'auto_end', sessionId: SESSION, reason: 'egress_failed' }).ok).toBe(false);
    expect(parseLiveControlRequest({ action: 'resume_recording', sessionId: 'nope' }).ok).toBe(false);
  });

  test('add_live_recording_part errors map to 409 / 404 (the worker reads 409 as "nothing to resume")', () => {
    expect(recordingPartRpcErrorCode('live session is not live (status ended)')).toBe('invalid_state');
    expect(recordingPartRpcErrorCode('a recording is already running for this live session')).toBe('invalid_state');
    expect(recordingPartRpcErrorCode('too many recording parts for this live session')).toBe('invalid_state');
    expect(recordingPartRpcErrorCode('live session not found')).toBe('not_found');
    expect(recordingPartRpcErrorCode('invalid egress id')).toBe('server_error');
    expect(LIVE_ERROR_STATUS.invalid_state).toBe(409);
  });
});

describe('status transitions (same graph as set_live_session_status, 0138)', () => {
  test.each([
    ['open_green', 'scheduled', 'green'],
    ['open_green', 'green', 'green'],
    ['start', 'green', 'live'],
    ['end', 'live', 'ended'],
    ['end', 'green', 'cancelled'],
    ['end', 'scheduled', 'cancelled'],
    ['approve', 'live', 'live'],
    ['hand', 'live', 'live'],
    ['set_allow_requests', 'scheduled', 'scheduled'],
    ['leave', 'ended', 'ended'],
    ['auto_end', 'live', 'ended'],
    ['auto_end', 'green', 'cancelled'],
    // idempotent for the worker: already over (or never opened) → unchanged
    ['auto_end', 'ended', 'ended'],
    ['auto_end', 'processing', 'processing'],
    ['auto_end', 'cancelled', 'cancelled'],
    ['auto_end', 'scheduled', 'scheduled'],
  ] as [LiveAction, string, string][])('%s from %s → %s', (action, from, to) => {
    expect(statusAfter(action, from)).toEqual({ ok: true, next: to });
  });

  test.each([
    ['start', 'scheduled'],
    ['start', 'live'],
    ['end', 'ended'],
    ['open_green', 'live'],
    ['approve', 'green'],
    ['hand', 'green'],
    ['mute', 'ended'],
    ['set_allow_requests', 'ended'],
  ] as [LiveAction, string][])('%s from %s is refused', (action, from) => {
    expect(statusAfter(action, from)).toEqual({ ok: false, code: 'invalid_state' });
  });

  test('D3 and bad transitions from the RPC map to 409s', () => {
    expect(statusRpcErrorCode('يوجد بث مباشر قائم الآن، ولا يمكن فتح بث آخر في الوقت نفسه')).toBe('another_live_active');
    expect(statusRpcErrorCode('invalid live transition live → green')).toBe('invalid_state');
    expect(LIVE_ERROR_STATUS.another_live_active).toBe(409);
    expect(LIVE_ERROR_STATUS.gender_required).toBe(409);
    expect(LIVE_ERROR_STATUS.banned).toBe(403);
  });

  test('P4 error codes: guest_cannot_speak 403 · requests_closed 409 · rate_limited 429', () => {
    expect(LIVE_ERROR_STATUS).toMatchObject({ guest_cannot_speak: 403, requests_closed: 409, rate_limited: 429 });
  });
});

describe('env, bans, egress', () => {
  test('only this env\'s rooms (stg_/prd_)', () => {
    expect(isEnvRoom('stg_ab12cd34ef56', 'stg_')).toBe(true);
    expect(isEnvRoom('prd_ab12cd34ef56', 'stg_')).toBe(false);
    expect(isEnvRoom('stg_', 'stg_')).toBe(false);
    expect(isEnvRoom('stg_x', '')).toBe(false);
  });

  test('a ban in force is refused; an expired one is not', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(isBanned('2026-09-29T00:00:00Z', now)).toBe(true);
    expect(isBanned('2026-09-27T00:00:00Z', now)).toBe(false);
    expect(isBanned(null, now)).toBe(false);
  });

  test('clients get the wss URL of the API host', () => {
    expect(livekitWsUrl('https://live.almahajja.app')).toBe('wss://live.almahajja.app');
    expect(livekitWsUrl('https://live.almahajja.app/')).toBe('wss://live.almahajja.app');
    expect(livekitWsUrl('http://almahajja-livekit:7880')).toBe('ws://almahajja-livekit:7880');
  });

  test('recordings go to the VPS disk per env — never straight to R2', () => {
    expect(envFromRoomPrefix('stg_')).toBe('stg');
    expect(envFromRoomPrefix('prd_')).toBe('prd');
    expect(envFromRoomPrefix('')).toBeNull();
    expect(envFromRoomPrefix('dev_')).toBeNull();
    expect(recordingFilepath('stg')).toBe('/recordings/stg/{room_name}-{time}.ogg');
    expect(recordingFilepath('prd')).toBe('/recordings/prd/{room_name}-{time}.ogg');
    expect(RECORDING_AUDIO).toEqual({ bitrateKbps: 64, frequencyHz: 48000 });
  });

  test('service-role hint: the JWT role claim (then proven server-side)', () => {
    const b64u = (o: object) =>
      require('buffer').Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = (payload: object) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.sig`;
    expect(jwtRoleClaim(jwt({ role: 'service_role', ref: 'x' }))).toBe('service_role');
    expect(jwtRoleClaim(jwt({ role: 'authenticated', name: 'مريم' }))).toBe('authenticated');
    expect(jwtRoleClaim(jwt({ sub: 'u' }))).toBeNull();
    expect(jwtRoleClaim('sb_secret_abc')).toBeNull();
    expect(jwtRoleClaim('a.!!!.c')).toBeNull();
    expect(jwtRoleClaim(null)).toBeNull();
  });

  test('service-role bearer comparison', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  test('LOAD V24: the JWT header alg picks local (ES256) vs GoTrue (legacy HS256) verification', () => {
    const b64u = (o: object) =>
      require('buffer').Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(jwtHeaderAlg(`${b64u({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64u({ sub: 'u' })}.sig`)).toBe('ES256');
    expect(jwtHeaderAlg(`${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ role: 'anon' })}.sig`)).toBe('HS256');
    expect(jwtHeaderAlg(`${b64u({ typ: 'JWT' })}.x.y`)).toBeNull();
    expect(jwtHeaderAlg('sb_publishable_abc')).toBeNull();
    expect(jwtHeaderAlg(null)).toBeNull();
  });
});

describe('0157 reactions: who may send them, and the moderator stop', () => {
  test('registered listeners and speakers may send (data grant); guests never; staff always', () => {
    expect(liveGrantsFor('listener', { isGuest: false, reactionsBlocked: false }).canPublishData).toBe(true);
    expect(liveGrantsFor('speaker', { isGuest: false, reactionsBlocked: false }).canPublishData).toBe(true);
    expect(liveGrantsFor('listener', { isGuest: true, reactionsBlocked: false }).canPublishData).toBe(false);
    expect(liveGrantsFor('host', { isGuest: false, reactionsBlocked: true }).canPublishData).toBe(true);
    expect(liveGrantsFor('moderator', { isGuest: false, reactionsBlocked: true }).canPublishData).toBe(true);
  });

  test('a stopped attendee loses only the data grant — listening and the mic stay as they were', () => {
    const l = liveGrantsFor('listener', { isGuest: false, reactionsBlocked: true });
    expect(l).toEqual({ ...LIVE_GRANTS.listener, canPublishData: false });
    const s = liveGrantsFor('speaker', { isGuest: false, reactionsBlocked: true });
    expect([s.canSubscribe, s.canPublish, s.canPublishData]).toEqual([true, true, false]);
    expect(speakerPermission(true, true).canPublishData).toBe(true);
    expect(speakerPermission(false).canPublishData).toBe(false);
  });

  test('react_block: moderators only, aimed at a listener or speaker — never the host or a moderator', () => {
    const mod = user({ appRole: 'admin', liveRole: 'moderator' });
    expect(authorizeLiveAction('react_block', mod).ok).toBe(true);
    expect(authorizeLiveAction('react_block', user()).ok).toBe(false);
    expect(authorizeLiveAction('react_block', user({ isGuest: true })).ok).toBe(false);
    expect(canTarget('react_block', 'listener').ok).toBe(true);
    expect(canTarget('react_block', 'speaker').ok).toBe(true);
    expect(canTarget('react_block', 'host').ok).toBe(false);
    expect(canTarget('react_block', 'moderator').ok).toBe(false);
  });

  test('react_block needs an identity and a boolean `blocked`', () => {
    const id = '0123456789abcdef';
    expect(parseLiveControlRequest({ action: 'react_block', sessionId: SESSION, identity: id, blocked: true })).toMatchObject({
      ok: true,
      value: { action: 'react_block', identity: id, blocked: true },
    });
    expect(parseLiveControlRequest({ action: 'react_block', sessionId: SESSION, identity: id })).toEqual({
      ok: false,
      error: 'blocked required',
    });
    expect(parseLiveControlRequest({ action: 'react_block', sessionId: SESSION, identity: id, blocked: 'yes' }).ok).toBe(false);
    expect(parseLiveControlRequest({ action: 'react_block', sessionId: SESSION, blocked: true }).ok).toBe(false);
  });

  test('the stop survives a re-join: live_join_context carries reactions_blocked', () => {
    expect(parseLiveJoinContext({ stored: { role: 'listener', hidden_name: null, reactions_blocked: true } })?.stored)
      .toEqual({ role: 'listener', hiddenName: null, reactionsBlocked: true });
  });

  test('regression (2026-10-05): hidden_name is a BOOLEAN — a sister who chose her name stays named on re-join', () => {
    const named = parseLiveJoinContext({ stored: { role: 'listener', hidden_name: false } })?.stored;
    expect(named?.hiddenName).toBe(false);
    expect(resolveHiddenName('f', null, named?.hiddenName)).toBe(false);
    const hidden = parseLiveJoinContext({ stored: { role: 'listener', hidden_name: true } })?.stored;
    expect(resolveHiddenName('f', null, hidden?.hiddenName)).toBe(true);
  });
});

describe('live_join_context (0155) — one round trip for live-token', () => {
  const raw = {
    user: { banned_until: null, is_anonymous: false },
    flag: 'all',
    profile: { role: 'student', gender: 'female', display_name: 'مريم' },
    session: {
      id: SESSION,
      status: 'live',
      room_name: 'prd_abc',
      host_user_id: HOST,
      section_id: 'sec-1',
      allow_requests: true,
    },
    stored: { role: 'speaker', hidden_name: true },
    visible: true,
    identity: '0123456789abcdef',
  };

  test('maps the jsonb to the fields live-token decides on', () => {
    expect(parseLiveJoinContext(raw)).toEqual({
      user: { bannedUntil: null, isAnonymous: false },
      flag: 'all',
      profile: { role: 'student', gender: 'female', displayName: 'مريم' },
      session: {
        id: SESSION,
        status: 'live',
        roomName: 'prd_abc',
        hostUserId: HOST,
        sectionId: 'sec-1',
        allowRequests: true,
      },
      stored: { role: 'speaker', hiddenName: true, reactionsBlocked: false },
      visible: true,
      identity: '0123456789abcdef',
    });
  });

  test('a deleted user, a missing session or no stored row stay null (→ 401 / 404 / first join)', () => {
    const ctx = parseLiveJoinContext({ ...raw, user: null, session: null, stored: null, profile: null });
    expect(ctx?.user).toBeNull();
    expect(ctx?.session).toBeNull();
    expect(ctx?.stored).toBeNull();
    expect(ctx?.profile).toBeNull();
  });

  test('fail closed: anything but a literal true is "not visible"; a guest flag must be literal true', () => {
    expect(parseLiveJoinContext({ ...raw, visible: null })?.visible).toBe(false);
    expect(parseLiveJoinContext({ ...raw, visible: 'true' })?.visible).toBe(false);
    expect(parseLiveJoinContext({ ...raw, user: { is_anonymous: 'yes' } })?.user?.isAnonymous).toBe(false);
    expect(parseLiveJoinContext({ ...raw, user: { is_anonymous: true } })?.user?.isAnonymous).toBe(true);
  });

  test('a session without its key fields is treated as not found; non-objects are a server error', () => {
    expect(parseLiveJoinContext({ ...raw, session: { id: SESSION } })?.session).toBeNull();
    expect(parseLiveJoinContext(null)).toBeNull();
    expect(parseLiveJoinContext([raw])).toBeNull();
    expect(parseLiveJoinContext('x')).toBeNull();
  });
});

describe('request parsing', () => {
  test('live-token', () => {
    expect(parseLiveTokenRequest({ sessionId: SESSION })).toEqual({
      ok: true,
      value: { sessionId: SESSION, identityChoice: null },
    });
    expect(parseLiveTokenRequest({ sessionId: SESSION, identityChoice: 'hidden' }).ok).toBe(true);
    expect(parseLiveTokenRequest({ sessionId: 'nope' })).toEqual({ ok: false, error: 'sessionId required' });
    expect(parseLiveTokenRequest({ sessionId: SESSION, identityChoice: 'anon' }).ok).toBe(false);
  });

  test('live-control', () => {
    expect(parseLiveControlRequest({ action: 'approve', sessionId: SESSION, identity: '0123456789abcdef' })).toEqual({
      ok: true,
      value: {
        action: 'approve',
        sessionId: SESSION,
        identity: '0123456789abcdef',
        trackSid: null,
        allow: null,
        reason: null,
        up: null,
        blocked: null,
      },
    });
    expect(parseLiveControlRequest({ action: 'auto_end', sessionId: SESSION, reason: 'host_absent' })).toMatchObject({
      ok: true,
      value: { action: 'auto_end', reason: 'host_absent' },
    });
    expect(parseLiveControlRequest({ action: 'auto_end', sessionId: SESSION, reason: 'room_finished' }).ok).toBe(true);
    expect(parseLiveControlRequest({ action: 'auto_end', sessionId: SESSION })).toEqual({
      ok: false,
      error: 'reason required',
    });
    expect(parseLiveControlRequest({ action: 'auto_end', sessionId: SESSION, reason: 'bored' }).ok).toBe(false);
    expect(parseLiveControlRequest({ action: 'approve', sessionId: SESSION })).toEqual({
      ok: false,
      error: 'identity required',
    });
    expect(parseLiveControlRequest({ action: 'approve', sessionId: SESSION, identity: USER }).ok).toBe(false);
    expect(parseLiveControlRequest({ action: 'nuke', sessionId: SESSION }).ok).toBe(false);
    expect(parseLiveControlRequest({ action: 'set_allow_requests', sessionId: SESSION }).ok).toBe(false);
    expect(parseLiveControlRequest({ action: 'set_allow_requests', sessionId: SESSION, allow: false })).toMatchObject({
      ok: true,
      value: { allow: false },
    });
    expect(parseLiveControlRequest({ action: 'mute', sessionId: SESSION, identity: '0123456789abcdef', trackSid: 'x' }).ok).toBe(false);
    expect(parseLiveControlRequest({ action: 'end', sessionId: SESSION }).ok).toBe(true);
  });

  test('live-control hand: `up` is a required boolean; the caller acts on himself', () => {
    expect(parseLiveControlRequest({ action: 'hand', sessionId: SESSION, up: true })).toEqual({
      ok: true,
      value: { action: 'hand', sessionId: SESSION, identity: null, trackSid: null, allow: null, reason: null, up: true, blocked: null },
    });
    expect(parseLiveControlRequest({ action: 'hand', sessionId: SESSION, up: false })).toMatchObject({
      ok: true,
      value: { up: false },
    });
    expect(parseLiveControlRequest({ action: 'hand', sessionId: SESSION })).toEqual({ ok: false, error: 'up required' });
    expect(parseLiveControlRequest({ action: 'hand', sessionId: SESSION, up: 'true' })).toEqual({
      ok: false,
      error: 'invalid up',
    });
    expect(parseLiveControlRequest({ action: 'hand', sessionId: SESSION, up: 1 }).ok).toBe(false);
    // Someone else's identity in the body is ignored — never "lower another's hand".
    expect(
      parseLiveControlRequest({ action: 'hand', sessionId: SESSION, up: false, identity: '0123456789abcdef' }),
    ).toMatchObject({ ok: true, value: { identity: null } });
    expect(parseLiveControlRequest({ action: 'hand', sessionId: 'nope', up: true }).ok).toBe(false);
  });
});

// P7 — app_config.live_enabled (migration 0145): ship dark, then staff, then all.
describe('P7 rollout flag: liveEnabledFor (same rule as SQL live_enabled_for_caller)', () => {
  test('levels parse like live_enabled_level(): trimmed, case-insensitive', () => {
    expect(parseLiveEnabledLevel('all')).toBe('all');
    expect(parseLiveEnabledLevel('staff')).toBe('staff');
    expect(parseLiveEnabledLevel('off')).toBe('off');
    expect(parseLiveEnabledLevel('  ALL ')).toBe('all');
    expect(parseLiveEnabledLevel('Staff')).toBe('staff');
  });

  test.each([undefined, null, '', 'true', 'on', 'yes', 'everyone', 'staff-only', 1, true, {}])(
    'a missing / unknown value (%p) is off — for everyone, staff included',
    (value) => {
      expect(parseLiveEnabledLevel(value)).toBe('off');
      for (const role of ['admin', 'publisher', 'sheikh', 'student', null]) {
        expect(liveEnabledFor(value, role)).toBe(false);
      }
    },
  );

  test("'off' refuses everyone", () => {
    for (const role of ['admin', 'publisher', 'sheikh', 'student', undefined]) {
      expect(liveEnabledFor('off', role)).toBe(false);
    }
  });

  test("'staff' admits admin / publisher / sheikh only — never students or guests", () => {
    expect(liveEnabledFor('staff', 'admin')).toBe(true);
    expect(liveEnabledFor('staff', 'publisher')).toBe(true);
    expect(liveEnabledFor('staff', 'sheikh')).toBe(true);
    expect(liveEnabledFor('staff', 'student')).toBe(false);
    expect(liveEnabledFor('staff', null)).toBe(false);
    expect(liveEnabledFor('staff', undefined)).toBe(false);
    expect(liveEnabledFor('staff', 'student', true)).toBe(false);
    // An anonymous session is a guest whatever its profile says.
    expect(liveEnabledFor('staff', 'admin', true)).toBe(false);
  });

  test("'all' admits everyone, guests included", () => {
    for (const role of ['admin', 'publisher', 'sheikh', 'student', null]) {
      expect(liveEnabledFor('all', role)).toBe(true);
    }
    expect(liveEnabledFor('all', 'student', true)).toBe(true);
  });

  test('live-token refuses with 403 live_disabled', () => {
    expect(LIVE_ERROR_STATUS.live_disabled).toBe(403);
  });
});

// «التعليقات والأسئلة أثناء البث» — migration 0147 + live-control comment actions.
describe('comments (0147): who may write, delete, answer, block', () => {
  const COMMENT = 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  test('comment actions are their own set — never in LIVE_ACTIONS, never the service role\'s', () => {
    expect([...COMMENT_ACTIONS]).toEqual(['comment', 'comment_delete', 'comment_answered', 'comment_block']);
    for (const a of COMMENT_ACTIONS) {
      expect(isCommentAction(a)).toBe(true);
      expect((LIVE_ACTIONS as readonly string[]).includes(a)).toBe(false);
      expect(authorizeCommentAction(a, { kind: 'system' })).toEqual({ ok: false, code: 'forbidden' });
    }
    expect(isCommentAction('leave')).toBe(false);
    expect(isCommentAction(undefined)).toBe(false);
  });

  test('guests read but never write (owner 2026-09-30): comment → guest_cannot_comment, before any lookup', () => {
    for (const appRole of [null, 'student', 'admin']) {
      expect(preauthorizeCommentAction('comment', { appRole, isGuest: true })).toEqual({
        ok: false,
        code: 'guest_cannot_comment',
      });
      expect(authorizeCommentAction('comment', user({ appRole, isGuest: true }))).toEqual({
        ok: false,
        code: 'guest_cannot_comment',
      });
      for (const a of ['comment_delete', 'comment_answered', 'comment_block'] as const) {
        expect(preauthorizeCommentAction(a, { appRole, isGuest: true })).toEqual({ ok: false, code: 'forbidden' });
        expect(authorizeCommentAction(a, user({ appRole, isGuest: true, isHost: true, liveRole: 'host' }))).toEqual({
          ok: false,
          code: 'forbidden',
        });
      }
    }
    expect(LIVE_ERROR_STATUS.guest_cannot_comment).toBe(403);
  });

  test('a registered participant writes; not joined → not_present', () => {
    expect(preauthorizeCommentAction('comment', { appRole: 'student', isGuest: false })).toEqual({ ok: true });
    expect(authorizeCommentAction('comment', user())).toEqual({ ok: true });
    expect(authorizeCommentAction('comment', user({ liveRole: null }))).toEqual({ ok: false, code: 'not_present' });
    // Staff comment like anyone else — but only from inside the room.
    expect(authorizeCommentAction('comment', user({ appRole: 'admin', liveRole: null }))).toEqual({
      ok: false,
      code: 'not_present',
    });
    expect(LIVE_ERROR_STATUS.not_present).toBe(409);
  });

  test('delete: any registered user passes the gates (author-or-moderator is SQL\'s call)', () => {
    expect(preauthorizeCommentAction('comment_delete', { appRole: 'student', isGuest: false })).toEqual({ ok: true });
    expect(authorizeCommentAction('comment_delete', user({ liveRole: null }))).toEqual({ ok: true });
  });

  test('answered / block: the host, the session\'s moderators, or a content manager — nobody else', () => {
    for (const a of ['comment_answered', 'comment_block'] as const) {
      // students (even an approved speaker) are refused at the first gate
      expect(preauthorizeCommentAction(a, { appRole: 'student', isGuest: false })).toEqual({ ok: false, code: 'forbidden' });
      expect(authorizeCommentAction(a, user({ liveRole: 'speaker' }))).toEqual({ ok: false, code: 'forbidden' });
      // the host (by row or by live role), a moderator who joined
      expect(authorizeCommentAction(a, user({ appRole: 'sheikh', isHost: true, liveRole: null }))).toEqual({ ok: true });
      expect(authorizeCommentAction(a, user({ appRole: 'sheikh', liveRole: 'host' }))).toEqual({ ok: true });
      expect(authorizeCommentAction(a, user({ appRole: 'sheikh', liveRole: 'moderator' }))).toEqual({ ok: true });
      // a sheikh who is not in this session cannot; content managers always can
      expect(authorizeCommentAction(a, user({ appRole: 'sheikh', liveRole: null }))).toEqual({ ok: false, code: 'forbidden' });
      for (const appRole of ['admin', 'publisher']) {
        expect(preauthorizeCommentAction(a, { appRole, isGuest: false })).toEqual({ ok: true });
        expect(authorizeCommentAction(a, user({ appRole, liveRole: null }))).toEqual({ ok: true });
      }
    }
    expect(canModerateComments({ appRole: 'admin', isGuest: true, isHost: true, liveRole: 'host' })).toBe(false);
  });

  test('writing needs a LIVE session (green → not_live); moderation works in any status', () => {
    expect(commentStatusVerdict('comment', 'live')).toEqual({ ok: true });
    for (const s of ['scheduled', 'green', 'ended', 'processing', 'ready', 'failed', 'cancelled']) {
      expect(commentStatusVerdict('comment', s)).toEqual({ ok: false, code: 'not_live' });
    }
    for (const a of ['comment_delete', 'comment_answered', 'comment_block'] as const) {
      for (const s of ['green', 'live', 'ended', 'ready']) expect(commentStatusVerdict(a, s)).toEqual({ ok: true });
    }
    expect(LIVE_ERROR_STATUS.not_live).toBe(409);
    // the room only exists while green / live — no LiveKit call otherwise
    expect(shouldBroadcastComments('live')).toBe(true);
    expect(shouldBroadcastComments('green')).toBe(true);
    expect(shouldBroadcastComments('ended')).toBe(false);
  });

  test('text: 1–300 characters after trimming, counted like Postgres (code points)', () => {
    expect(COMMENT_MAX_CHARS).toBe(300);
    expect(commentTextVerdict('   \n ')).toEqual({ ok: false, code: 'empty' });
    expect(commentTextVerdict('ما حكم صلاة الوتر؟')).toEqual({ ok: true });
    expect(commentTextVerdict(`  ${'ب'.repeat(300)}  `)).toEqual({ ok: true });
    expect(commentTextVerdict('ب'.repeat(301))).toEqual({ ok: false, code: 'too_long' });
    // 300 emoji are 600 UTF-16 units but 300 characters for the DB check.
    expect(commentLength('🌙'.repeat(300))).toBe(300);
    expect(commentTextVerdict('🌙'.repeat(300))).toEqual({ ok: true });
    expect(LIVE_ERROR_STATUS).toMatchObject({ empty: 400, too_long: 400, blocked_words: 400, blocked: 403, rate_limited: 429 });
  });

  test('SQL refusals (live_comment:<code>) map to their codes; anything else is a server error', () => {
    for (const code of [
      'not_found', 'not_live', 'guest_cannot_comment', 'not_present', 'blocked', 'empty', 'too_long',
      'blocked_words', 'rate_limited', 'forbidden', 'invalid_target', 'bad_request',
    ]) {
      expect(commentRpcErrorCode(`live_comment:${code}`)).toBe(code);
    }
    expect(commentRpcErrorCode('live_comment:drop_table')).toBe('server_error');
    expect(commentRpcErrorCode('permission denied for function live_post_comment')).toBe('server_error');
    expect(commentRpcErrorCode(null)).toBe('server_error');
  });

  test('audit: staff acts only — an author deleting his own comment and writing are not moderation', () => {
    expect(commentAuditAction('comment')).toBeNull();
    expect(commentAuditAction('comment_delete', { by: 'author' })).toBeNull();
    expect(commentAuditAction('comment_delete', { by: 'moderator' })).toBe('comment_delete');
    expect(commentAuditAction('comment_answered')).toBe('comment_answered');
    expect(commentAuditAction('comment_block')).toBe('comment_block');
  });

  test('request parsing', () => {
    expect(parseLiveCommentRequest({ action: 'comment', sessionId: SESSION, kind: 'question', text: 'سؤال', anonymous: true })).toEqual({
      ok: true,
      value: { action: 'comment', sessionId: SESSION, kind: 'question', text: 'سؤال', anonymous: true },
    });
    expect(parseLiveCommentRequest({ action: 'comment', sessionId: SESSION, kind: 'note', text: 'x', anonymous: false })).toEqual({
      ok: false,
      error: 'invalid kind',
    });
    expect(parseLiveCommentRequest({ action: 'comment', sessionId: SESSION, kind: 'comment', anonymous: false })).toEqual({
      ok: false,
      error: 'text required',
    });
    // «بدون اسم» must be an explicit choice.
    expect(parseLiveCommentRequest({ action: 'comment', sessionId: SESSION, kind: 'comment', text: 'x' })).toEqual({
      ok: false,
      error: 'anonymous required',
    });
    expect(parseLiveCommentRequest({ action: 'comment', sessionId: 'nope', kind: 'comment', text: 'x', anonymous: false }).ok).toBe(false);
    expect(parseLiveCommentRequest({ action: 'comment_delete', sessionId: SESSION, commentId: COMMENT })).toEqual({
      ok: true,
      value: { action: 'comment_delete', sessionId: SESSION, commentId: COMMENT },
    });
    expect(parseLiveCommentRequest({ action: 'comment_block', sessionId: SESSION, commentId: 'x' })).toEqual({
      ok: false,
      error: 'commentId required',
    });
    expect(parseLiveCommentRequest({ action: 'comment_answered', sessionId: SESSION, commentId: COMMENT, answered: true })).toEqual({
      ok: true,
      value: { action: 'comment_answered', sessionId: SESSION, commentId: COMMENT, answered: true },
    });
    expect(parseLiveCommentRequest({ action: 'comment_answered', sessionId: SESSION, commentId: COMMENT })).toEqual({
      ok: false,
      error: 'answered required',
    });
    expect(parseLiveCommentRequest({ action: 'leave', sessionId: SESSION }).ok).toBe(false);
  });

  test('broadcast: only the public fields, UTF-8 JSON on topic "comments" — never mine / a user id', () => {
    expect(COMMENTS_TOPIC).toBe('comments');
    const row = {
      id: COMMENT,
      kind: 'question',
      text: 'ما حكم الصلاة؟',
      name: null,
      gender: 'f',
      answered: false,
      at: '2026-09-30T18:00:00.123+00:00',
      mine: true,
      user_id: USER,
    };
    const c = toPublicComment(row)!;
    expect(c).toEqual({
      id: COMMENT,
      kind: 'question',
      text: 'ما حكم الصلاة؟',
      name: null,
      gender: 'f',
      answered: false,
      at: '2026-09-30T18:00:00.123+00:00',
    });
    const add = commentsMessage({ t: 'add', c });
    expect(JSON.parse(add)).toEqual({ t: 'add', c });
    expect(add).not.toContain(USER);
    expect(add).not.toContain('mine');
    expect(JSON.parse(commentsMessage({ t: 'del', id: COMMENT }))).toEqual({ t: 'del', id: COMMENT });
    expect(JSON.parse(commentsMessage({ t: 'ans', id: COMMENT, answered: true }))).toEqual({ t: 'ans', id: COMMENT, answered: true });
    // malformed rows are not broadcast
    expect(toPublicComment({ ...row, gender: 'x' })).toBeNull();
    expect(toPublicComment({ ...row, name: 5 })).toBeNull();
    expect(toPublicComment(null)).toBeNull();
  });
});
