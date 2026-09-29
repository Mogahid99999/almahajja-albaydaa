/**
 * src/lib/liveConnection.ts — «الحلقة» connection states (PLAN_LIVE_V23 §7.5)
 * and participant → person mapping (§5.1 attributes).
 *
 * Pins every event → `liveStore.conn` transition the UI copy depends on:
 * «جارٍ الدخول إلى الحلقة…» (connecting), «الاتصال ضعيف…» (poor),
 * «جارٍ إعادة الاتصال…» (reconnecting), «انقطع اتصال الشيخ مؤقتاً…» (hostdrop),
 * «انقطع اتصالك بالإنترنت…» (offline), «تعذّر الدخول إلى الحلقة» (failed),
 * «انتهى المجلس» (ended).
 */
import {
  classifyDisconnect,
  connReducer,
  countPeople,
  deriveConn,
  HOST_AUDIO_GRACE_MS,
  initialConnState,
  MAX_CONNECT_ATTEMPTS,
  sameIds,
  parseHand,
  toLivePerson,
  withSpeaking,
  type ConnEvent,
  type ConnState,
  type LivePerson,
} from '@/lib/liveConnection';

const run = (events: ConnEvent[], from: ConnState = initialConnState): ConnState =>
  events.reduce(connReducer, from);
const connOf = (events: ConnEvent[], from?: ConnState) => deriveConn(run(events, from));

const T0 = 1_000_000;
const hostOk: ConnEvent = { type: 'host', present: true, hasAudio: true, at: T0 };
/** Connected, host speaking — the steady «ok» state. */
const live = (): ConnState => run([{ type: 'connect' }, { type: 'connected' }, hostOk]);

describe('connect', () => {
  test('idle before anything happens', () => {
    expect(deriveConn(initialConnState)).toBe('idle');
  });

  test('Room.connect → connecting, then ok', () => {
    expect(connOf([{ type: 'connect' }])).toBe('connecting');
    expect(connOf([{ type: 'connect' }, { type: 'connected' }, hostOk])).toBe('ok');
  });

  test('a re-join after a drop reads as reconnecting, not a fresh entry', () => {
    expect(connOf([{ type: 'connect', rejoin: true }])).toBe('reconnecting');
  });

  test('connect errors retry (still connecting) and fail on the 3rd', () => {
    expect(MAX_CONNECT_ATTEMPTS).toBe(3);
    const s1 = run([{ type: 'connect' }, { type: 'connectError' }]);
    expect(deriveConn(s1)).toBe('connecting');
    const s2 = run([{ type: 'connect' }, { type: 'connectError' }], s1);
    expect(deriveConn(s2)).toBe('connecting');
    const s3 = run([{ type: 'connect' }, { type: 'connectError' }], s2);
    expect(s3.attempts).toBe(3);
    expect(deriveConn(s3)).toBe('failed');
  });

  test('weak network: a re-join after a drop never gives up (only a first entry fails at 3)', () => {
    const live = run([{ type: 'connect' }, { type: 'connected' }, { type: 'disconnected', kind: 'lost' }]);
    let s = live;
    for (let i = 0; i < 12; i++) s = run([{ type: 'connect', rejoin: true }, { type: 'connectError' }], s);
    expect(s.attempts).toBe(12);
    expect(deriveConn(s)).toBe('reconnecting');
    expect(deriveConn(run([{ type: 'connect', rejoin: true }, { type: 'connected' }], s))).toBe('ok');
  });

  test('a success resets the attempt count', () => {
    const s = run([{ type: 'connect' }, { type: 'connectError' }, { type: 'connect' }, { type: 'connected' }]);
    expect(s.attempts).toBe(0);
    // …so a later re-join gets its own 3 tries.
    const later = run(
      [
        { type: 'disconnected', kind: 'lost' },
        { type: 'connect', rejoin: true },
        { type: 'connectError' },
        { type: 'connect', rejoin: true },
        { type: 'connectError' },
      ],
      s,
    );
    expect(deriveConn(later)).toBe('reconnecting');
  });
});

describe('quality (local participant)', () => {
  test.each(['poor', 'lost'])('%s → poor', (quality) => {
    expect(connOf([{ type: 'quality', quality }], live())).toBe('poor');
  });

  test('back to good → ok', () => {
    expect(connOf([{ type: 'quality', quality: 'poor' }, { type: 'quality', quality: 'good' }], live())).toBe('ok');
  });
});

describe('reconnecting', () => {
  test('Reconnecting → reconnecting; Reconnected → ok', () => {
    const s = run([{ type: 'reconnecting' }], live());
    expect(deriveConn(s)).toBe('reconnecting');
    expect(connOf([{ type: 'reconnected' }], s)).toBe('ok');
  });

  test('Reconnected clears a stale poor flag', () => {
    const s = run([{ type: 'quality', quality: 'poor' }, { type: 'reconnecting' }, { type: 'reconnected' }], live());
    expect(deriveConn(s)).toBe('ok');
  });

  test('Reconnecting before any connect is ignored (idle stays idle)', () => {
    expect(connOf([{ type: 'reconnecting' }])).toBe('idle');
  });
});

describe('hostdrop', () => {
  test('the host leaving the room is an immediate hostdrop', () => {
    expect(connOf([{ type: 'host', present: false, hasAudio: false, at: T0 + 10 }], live())).toBe('hostdrop');
  });

  test('host present without a mic track: ok for < 5 s, hostdrop from 5 s', () => {
    expect(HOST_AUDIO_GRACE_MS).toBe(5000);
    const s = run([{ type: 'host', present: true, hasAudio: false, at: T0 }], live());
    expect(deriveConn(s)).toBe('ok');
    expect(connOf([{ type: 'tick', now: T0 + 4999 }], s)).toBe('ok');
    expect(connOf([{ type: 'tick', now: T0 + 5000 }], s)).toBe('hostdrop');
  });

  test('the grace clock keeps its start across repeated host updates', () => {
    const s = run(
      [
        { type: 'host', present: true, hasAudio: false, at: T0 },
        { type: 'host', present: true, hasAudio: false, at: T0 + 3000 },
        { type: 'tick', now: T0 + 5001 },
      ],
      live(),
    );
    expect(deriveConn(s)).toBe('hostdrop');
  });

  test('host audio returning clears hostdrop', () => {
    const s = run([{ type: 'host', present: false, hasAudio: false, at: T0 }], live());
    expect(deriveConn(s)).toBe('hostdrop');
    const back = run([{ type: 'host', present: true, hasAudio: true, at: T0 + 20_000 }], s);
    expect(deriveConn(back)).toBe('ok');
    expect(back.hostAudioLostAt).toBeNull();
  });

  test('a host who is back but not yet publishing stays hostdrop until audio returns', () => {
    const s = run(
      [
        { type: 'host', present: false, hasAudio: false, at: T0 },
        { type: 'host', present: true, hasAudio: false, at: T0 + 100 },
      ],
      live(),
    );
    expect(deriveConn(s)).toBe('hostdrop');
    expect(s.hostPresent).toBe(true);
  });

  test('hostdrop outranks poor', () => {
    expect(
      connOf(
        [
          { type: 'quality', quality: 'poor' },
          { type: 'host', present: false, hasAudio: false, at: T0 },
        ],
        live(),
      ),
    ).toBe('hostdrop');
  });

  test('a new connect forgets the previous room’s host state', () => {
    const dropped = run([{ type: 'host', present: false, hasAudio: false, at: T0 }], live());
    const fresh = run([{ type: 'connect', rejoin: true }, { type: 'connected' }], dropped);
    expect(fresh.hostDropped).toBe(false);
    expect(fresh.hostAudioLostAt).toBeNull();
  });
});

describe('offline', () => {
  test('network offline → offline; back online → the underlying state', () => {
    const s = run([{ type: 'network', online: false }], live());
    expect(deriveConn(s)).toBe('offline');
    expect(connOf([{ type: 'network', online: true }], s)).toBe('ok');
  });

  test('offline outranks reconnecting / hostdrop (the copy promises an automatic return)', () => {
    expect(
      connOf(
        [{ type: 'reconnecting' }, { type: 'host', present: false, hasAudio: false, at: T0 }, { type: 'network', online: false }],
        live(),
      ),
    ).toBe('offline');
  });

  test('offline during a lost-connection re-join, then reconnecting once online', () => {
    const s = run([{ type: 'network', online: false }, { type: 'disconnected', kind: 'lost' }], live());
    expect(deriveConn(s)).toBe('offline');
    expect(connOf([{ type: 'network', online: true }], s)).toBe('reconnecting');
  });

  test('reset keeps the device network state', () => {
    const s = run([{ type: 'network', online: false }, { type: 'reset' }], live());
    expect(s.online).toBe(false);
    expect(deriveConn(s)).toBe('idle');
  });
});

describe('disconnected / ended', () => {
  test('ROOM_DELETED (5) and ROOM_CLOSED (10) end the session', () => {
    expect(classifyDisconnect(5)).toBe('ended');
    expect(classifyDisconnect(10)).toBe('ended');
    expect(connOf([{ type: 'disconnected', kind: classifyDisconnect(5) }], live())).toBe('ended');
  });

  test('our own disconnect (CLIENT_INITIATED = 1) goes back to idle', () => {
    expect(classifyDisconnect(1)).toBe('client');
    expect(connOf([{ type: 'disconnected', kind: 'client' }], live())).toBe('idle');
  });

  test('removed / replaced on another device → failed (no automatic re-join)', () => {
    expect(classifyDisconnect(2)).toBe('kicked'); // DUPLICATE_IDENTITY
    expect(classifyDisconnect(4)).toBe('kicked'); // PARTICIPANT_REMOVED
    expect(connOf([{ type: 'disconnected', kind: 'kicked' }], live())).toBe('failed');
  });

  test('anything else is a lost connection → reconnecting (liveClient re-joins)', () => {
    for (const reason of [undefined, 0, 3, 6, 7, 9, 14, 15]) {
      expect(classifyDisconnect(reason)).toBe('lost');
    }
    expect(connOf([{ type: 'disconnected', kind: 'lost' }], live())).toBe('reconnecting');
  });

  test('a session-ended status (poll) → ended, from any live state', () => {
    expect(connOf([{ type: 'sessionEnded' }], live())).toBe('ended');
    expect(connOf([{ type: 'reconnecting' }, { type: 'sessionEnded' }], live())).toBe('ended');
    expect(connOf([{ type: 'network', online: false }, { type: 'sessionEnded' }], live())).toBe('ended');
  });

  test('ended is final: later events never revive it', () => {
    const ended = run([{ type: 'sessionEnded' }], live());
    for (const ev of [
      { type: 'connect' },
      { type: 'connected' },
      { type: 'reconnected' },
      { type: 'disconnected', kind: 'lost' },
      { type: 'network', online: false },
    ] as ConnEvent[]) {
      expect(connOf([ev], ended)).toBe('ended');
    }
  });

  test('failed is left only by a new connect', () => {
    const failed = run([{ type: 'disconnected', kind: 'kicked' }], live());
    expect(connOf([{ type: 'reconnected' }], failed)).toBe('failed');
    expect(connOf([{ type: 'network', online: false }], failed)).toBe('failed');
    expect(connOf([{ type: 'connect' }], failed)).toBe('connecting');
  });
});

describe('people', () => {
  test('attributes g / r / h / hid map to the person', () => {
    expect(
      toLivePerson(
        { identity: 'a1', name: 'عبد الله', attributes: { g: 'm', r: 'speaker', h: '1', hid: '0' } },
        { isMe: false, speaking: true },
      ),
    ).toEqual({
      identity: 'a1',
      name: 'عبد الله',
      gender: 'm',
      role: 'speaker',
      hidden: false,
      hand: true,
      handAt: 0,
      micOn: false,
      speaking: true,
      isMe: false,
    });
  });

  test('h carries the raise time (server-set epoch seconds); 0 / absent = down', () => {
    expect(parseHand('1767225600')).toBe(1767225600);
    expect(parseHand('1')).toBe(0); // a P2 server's plain «raised»
    expect(parseHand('0')).toBeNull();
    expect(parseHand(undefined)).toBeNull();
    expect(parseHand('')).toBeNull();
    const p = toLivePerson({ identity: 'd5', attributes: { h: '1767225600' } }, { isMe: false, speaking: false, micOn: true });
    expect(p).toMatchObject({ hand: true, handAt: 1767225600, micOn: true });
  });

  test('a hidden sister is always «طالبة», whatever name the room carries (D2)', () => {
    const p = toLivePerson(
      { identity: 'b2', name: 'فاطمة', attributes: { g: 'f', r: 'listener', h: '0', hid: '1' } },
      { isMe: true, speaking: false },
    );
    expect(p.name).toBe('طالبة');
    expect(p.hidden).toBe(true);
    expect(p.isMe).toBe(true);
  });

  test('missing / unknown attributes fall back to a listening brother with an Arabic name', () => {
    expect(toLivePerson({ identity: 'c3', attributes: { r: 'admin' } }, { isMe: false, speaking: false })).toMatchObject({
      name: 'طالب',
      gender: 'm',
      role: 'listener',
      hidden: false,
      hand: false,
    });
    // hid is only honoured for sisters.
    expect(toLivePerson({ identity: 'c4', name: 'زيد', attributes: { g: 'm', hid: '1' } }, { isMe: false, speaking: false }).hidden).toBe(false);
  });

  const person = (identity: string, gender: 'm' | 'f', role: LivePerson['role'] = 'listener'): LivePerson => ({
    identity,
    name: identity,
    gender,
    role,
    hidden: false,
    hand: false,
    handAt: null,
    micOn: false,
    speaking: false,
    isMe: false,
  });

  test('counts are brothers vs sisters, host excluded', () => {
    expect(
      countPeople({
        h: person('h', 'm', 'host'),
        a: person('a', 'm'),
        b: person('b', 'm', 'moderator'),
        c: person('c', 'f'),
        d: person('d', 'f', 'speaker'),
        e: person('e', 'f'),
      }),
    ).toEqual({ brothers: 2, sisters: 3 });
  });

  test('withSpeaking copies only the persons whose flag changed', () => {
    const people = { a: person('a', 'm'), b: person('b', 'm'), c: person('c', 'f') };
    const next = withSpeaking(people, ['b']);
    expect(next).not.toBe(people);
    expect(next.b.speaking).toBe(true);
    expect(next.a).toBe(people.a);
    expect(next.c).toBe(people.c);
    // No change → the very same object (no re-render).
    expect(withSpeaking(next, ['b'])).toBe(next);
  });

  test('sameIds compares order too (loudest first)', () => {
    expect(sameIds(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameIds([], ['a'])).toBe(false);
  });
});
