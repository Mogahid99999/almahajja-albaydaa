/**
 * supabase/functions/_shared/liveRules.ts — who gets what in a live «الحلقة»
 * (PLAN_LIVE_V23 §5.1/§5.2, decisions D1–D4), shared by live-token/live-control.
 */
import {
  auditAction,
  authorizeLiveAction,
  canJoin,
  canTarget,
  envFromRoomPrefix,
  hostAbsenceExpired,
  isBanned,
  isEnvRoom,
  isLiveIdentity,
  jwtRoleClaim,
  LIVE_ACTIONS,
  LIVE_ERROR_STATUS,
  LIVE_GRANTS,
  type LiveAction,
  type LiveActor,
  liveGender,
  liveRoleFor,
  livekitWsUrl,
  parseLiveControlRequest,
  parseLiveTokenRequest,
  participantAttributes,
  preauthorizeLiveAction,
  participantDisplayName,
  realDisplayName,
  RECORDING_AUDIO,
  recordingFilepath,
  resolveHiddenName,
  safeEqual,
  speakerPermission,
  statusAfter,
  statusRpcErrorCode,
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
  test('listeners only subscribe and set their own hand/name; nobody is roomAdmin', () => {
    expect(LIVE_GRANTS.listener).toEqual({
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canUpdateOwnMetadata: true,
      roomAdmin: false,
    });
    for (const role of ['host', 'moderator'] as const) {
      expect(LIVE_GRANTS[role]).toEqual({
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
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
      canUpdateMetadata: true,
      hidden: false,
    });
    expect(speakerPermission(false)).toMatchObject({ canSubscribe: true, canPublish: false });
  });
});

describe('role in the session', () => {
  test('host, moderators (admin/publisher/sheikh), approved speaker, listener', () => {
    const base = { userId: USER, isGuest: false, hostUserId: HOST };
    expect(liveRoleFor({ ...base, userId: HOST, appRole: 'sheikh' })).toBe('host');
    for (const r of ['admin', 'publisher', 'sheikh']) {
      expect(liveRoleFor({ ...base, appRole: r })).toBe('moderator');
    }
    expect(liveRoleFor({ ...base, appRole: 'student', storedRole: 'speaker' })).toBe('speaker');
    expect(liveRoleFor({ ...base, appRole: 'student' })).toBe('listener');
    expect(liveRoleFor({ ...base, appRole: null, isGuest: true, storedRole: 'speaker' })).toBe('speaker');
  });

  test('a guest is never staff, whatever the profile says', () => {
    expect(liveRoleFor({ userId: HOST, appRole: 'admin', isGuest: true, hostUserId: HOST })).toBe('listener');
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
    });
  });

  test('identity is the 16-hex SQL live_identity — never a raw user id', () => {
    expect(isLiveIdentity('0123456789abcdef')).toBe(true);
    expect(isLiveIdentity(USER)).toBe(false);
    expect(isLiveIdentity('0123456789ABCDEF')).toBe(false);
  });
});

describe('§5.2 action → permission (D1)', () => {
  test('students and guests may only leave (or a speaker step himself down)', () => {
    for (const action of LIVE_ACTIONS) {
      const expected = action === 'leave' ? { ok: true } : { ok: false, code: 'forbidden' };
      expect(authorizeLiveAction(action, user())).toEqual(expected);
      expect(authorizeLiveAction(action, user({ isGuest: true, appRole: null }))).toEqual(expected);
    }
    expect(authorizeLiveAction('demote', user({ liveRole: 'speaker' }), { targetIsSelf: true })).toEqual({ ok: true });
    expect(authorizeLiveAction('demote', user({ isGuest: true, liveRole: 'speaker' }), { targetIsSelf: true })).toEqual({
      ok: true,
    });
  });

  test('first gate: students/guests are refused everything but leave/step-down before any lookup', () => {
    for (const action of LIVE_ACTIONS) {
      const ok = action === 'leave' || action === 'demote';
      expect(preauthorizeLiveAction(action, { appRole: 'student', isGuest: false }).ok).toBe(ok);
      expect(preauthorizeLiveAction(action, { appRole: null, isGuest: true }).ok).toBe(ok);
      expect(preauthorizeLiveAction(action, { appRole: 'admin', isGuest: true }).ok).toBe(ok);
      expect(preauthorizeLiveAction(action, { appRole: 'sheikh', isGuest: false }).ok).toBe(action !== 'auto_end');
    }
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

  test('auto_end is the service role\'s ONLY action, and nobody else\'s (D4)', () => {
    for (const action of LIVE_ACTIONS) {
      expect(authorizeLiveAction(action, { kind: 'system' }).ok).toBe(action === 'auto_end');
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

  test('audit names match the 0135 live_moderation_log check list', () => {
    const allowed = [
      'open_green', 'start', 'end', 'cancel', 'approve', 'reject', 'mute', 'demote',
      'step_down', 'set_allow_requests', 'host_leave', 'auto_end',
    ];
    for (const action of LIVE_ACTIONS) {
      for (const ctx of [{}, { targetIsSelf: true }, { next: 'cancelled' as const }]) {
        const a = auditAction(action, ctx);
        if (a !== null) expect(allowed).toContain(a);
      }
    }
    expect(auditAction('leave')).toBeNull();
    expect(auditAction('demote', { targetIsSelf: true })).toBe('step_down');
    expect(auditAction('end', { next: 'cancelled' })).toBe('cancel');
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
});
