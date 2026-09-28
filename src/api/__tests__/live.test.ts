/**
 * src/api/live.ts — «البث المباشر» data access (V23 P3).
 *
 * Pins:
 *  - snake_case jsonb/view rows → the camelCase LiveSessionPublic contract;
 *  - get_live_now's upcoming «ذكّرني» flags → remindedIds;
 *  - share codes are normalised, and restricted/unknown codes are null;
 *  - every live-token failure is a LiveTokenError with a known code — and
 *    `gender_required` (409) survives so the UI can show GenderPrompt;
 *  - staff participants carry the REAL name (D2).
 */
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));

import {
  fetchLiveToken,
  getLiveByCode,
  getLiveNow,
  getLiveParticipantsForStaff,
  getLiveSession,
  liveControl,
  LiveControlError,
  LiveTokenError,
  mapLiveTokenErrorCode,
  normalizeShareCode,
} from '@/api/live';

/** A FunctionsHttpError double: non-2xx with the function's `{ error }` body. */
const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => body },
});

/** `from(table).select().eq().maybeSingle()` per table. */
function mockTables(rows: Record<string, { data: unknown; error: unknown }>) {
  mockFrom.mockImplementation((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => rows[table] ?? { data: null, error: null },
      }),
    }),
  }));
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe('getLiveNow', () => {
  test('maps the live session, the upcoming list and my reminders', async () => {
    mockRpc.mockResolvedValue({
      data: {
        live: {
          id: 'l1',
          title: 'شرح كتاب التوحيد',
          section_id: 's1',
          section_title: 'العقيدة',
          sheikh_id: 'sh1',
          sheikh_name: 'الشيخ محمد',
          started_at: '2026-09-28T18:00:00Z',
          share_code: 'ABC234',
          allow_requests: true,
        },
        upcoming: [
          {
            id: 'u1',
            title: 'الدرس الثاني',
            section_id: 's1',
            section_title: 'العقيدة',
            sheikh_id: null,
            sheikh_name: null,
            scheduled_at: '2026-09-29T18:00:00Z',
            share_code: 'DEF567',
            reminded: true,
          },
          { id: 'u2', title: 'الدرس الثالث', section_id: 's2', scheduled_at: '2026-09-30T18:00:00Z', share_code: 'GHJ789', reminded: false },
        ],
        green: null,
      },
      error: null,
    });

    const now = await getLiveNow();
    expect(mockRpc).toHaveBeenCalledWith('get_live_now');
    expect(now.live).toEqual({
      id: 'l1',
      sectionId: 's1',
      sectionTitle: 'العقيدة',
      sheikhId: 'sh1',
      sheikhName: 'الشيخ محمد',
      title: 'شرح كتاب التوحيد',
      status: 'live',
      scheduledAt: null,
      startedAt: '2026-09-28T18:00:00Z',
      endedAt: null,
      shareCode: 'ABC234',
      peakListeners: 0,
    });
    expect(now.upcoming.map((s) => [s.id, s.status, s.scheduledAt])).toEqual([
      ['u1', 'scheduled', '2026-09-29T18:00:00Z'],
      ['u2', 'scheduled', '2026-09-30T18:00:00Z'],
    ]);
    expect(now.remindedIds).toEqual(['u1']);
    expect(now.green).toBeNull();
  });

  test('nothing live, nothing scheduled', async () => {
    mockRpc.mockResolvedValue({ data: { live: null, upcoming: [], green: null }, error: null });
    await expect(getLiveNow()).resolves.toEqual({ live: null, upcoming: [], remindedIds: [], green: null });
  });

  test('staff see their green room', async () => {
    mockRpc.mockResolvedValue({
      data: { live: null, upcoming: [], green: { id: 'g1', title: 'مجلس', section_id: 's1', host_user_id: 'u', is_mine: true } },
      error: null,
    });
    await expect(getLiveNow()).resolves.toMatchObject({ green: { id: 'g1', sectionId: 's1', isMine: true } });
  });

  test('an RPC error is thrown', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getLiveNow()).rejects.toEqual({ message: 'boom' });
  });
});

describe('getLiveSession', () => {
  test('reads the public view with embedded section/sheikh titles', async () => {
    mockTables({
      live_sessions_public: {
        data: {
          id: 'l1',
          section_id: 's1',
          sheikh_id: 'sh1',
          title: 'شرح كتاب التوحيد',
          status: 'ended',
          scheduled_at: null,
          started_at: '2026-09-28T18:00:00Z',
          ended_at: '2026-09-28T19:00:00Z',
          share_code: 'ABC234',
          sections: { title: 'العقيدة' },
          sheikhs: { name: 'الشيخ محمد' },
        },
        error: null,
      },
    });
    await expect(getLiveSession('l1')).resolves.toMatchObject({
      id: 'l1',
      sectionTitle: 'العقيدة',
      sheikhName: 'الشيخ محمد',
      status: 'ended',
      endedAt: '2026-09-28T19:00:00Z',
    });
    expect(mockFrom).toHaveBeenCalledWith('live_sessions_public');
    expect(mockFrom).not.toHaveBeenCalledWith('live_sessions');
  });

  test('not public (e.g. a green room) → staff read the table, incl. peak listeners', async () => {
    mockTables({
      live_sessions_public: { data: null, error: null },
      live_sessions: {
        data: { id: 'g1', section_id: 's1', title: 'مجلس', status: 'green', share_code: 'ABC234', peak_listeners: 12 },
        error: null,
      },
    });
    await expect(getLiveSession('g1')).resolves.toMatchObject({ id: 'g1', status: 'green', peakListeners: 12 });
  });

  test('neither readable → null', async () => {
    mockTables({});
    await expect(getLiveSession('x')).resolves.toBeNull();
  });
});

describe('share codes', () => {
  test('normalizeShareCode', () => {
    expect(normalizeShareCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeShareCode('ABC23')).toBeNull();
    expect(normalizeShareCode('ABC10O')).toBeNull(); // 0/1/O are not in the alphabet
  });

  test('an invalid code never reaches the server', async () => {
    await expect(getLiveByCode('nope')).resolves.toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('restricted (gender-scoped section) → null', async () => {
    mockRpc.mockResolvedValue({ data: { restricted: true, status: 'live' }, error: null });
    await expect(getLiveByCode('abc234')).resolves.toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('get_live_by_code', { p_code: 'ABC234' });
  });

  test('a readable code resolves to the full session', async () => {
    mockRpc.mockResolvedValue({
      data: { restricted: false, id: 'l1', status: 'live', title: 'مجلس', section_title: 'العقيدة', sheikh_name: null },
      error: null,
    });
    mockTables({
      live_sessions_public: {
        data: { id: 'l1', section_id: 's1', title: 'مجلس', status: 'live', share_code: 'ABC234', sections: { title: 'العقيدة' } },
        error: null,
      },
    });
    await expect(getLiveByCode('ABC234')).resolves.toMatchObject({ id: 'l1', sectionId: 's1', status: 'live' });
  });

  test('when the row itself is not readable, the RPC’s coarse fields are used', async () => {
    mockRpc.mockResolvedValue({
      data: { restricted: false, id: 'l2', status: 'scheduled', title: 'مجلس قادم', section_title: 'الفقه', scheduled_at: '2026-10-01T18:00:00Z' },
      error: null,
    });
    mockTables({});
    await expect(getLiveByCode('ABC234')).resolves.toMatchObject({
      id: 'l2',
      status: 'scheduled',
      sectionTitle: 'الفقه',
      shareCode: 'ABC234',
    });
  });
});

describe('fetchLiveToken', () => {
  const ok = {
    token: 'jwt',
    url: 'wss://live.almahajja.app',
    roomName: 'stg_abc',
    identity: '0123456789abcdef',
    role: 'listener',
    name: 'طالبة',
    hidden: true,
    gender: 'f',
  };

  test('sends the session + a sister’s choice and maps the token', async () => {
    mockInvoke.mockResolvedValue({ data: ok, error: null });
    await expect(fetchLiveToken('sess-1', 'hidden')).resolves.toEqual(ok);
    expect(mockInvoke).toHaveBeenCalledWith('live-token', {
      body: { sessionId: 'sess-1', identityChoice: 'hidden' },
      timeout: expect.any(Number),
    });
  });

  test('no choice → no identityChoice field', async () => {
    mockInvoke.mockResolvedValue({ data: ok, error: null });
    await fetchLiveToken('sess-1');
    expect(mockInvoke.mock.calls[0][1].body).toEqual({ sessionId: 'sess-1' });
  });

  test('409 gender_required surfaces as LiveTokenError(gender_required) with Arabic copy', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { error: 'gender_required' }) });
    const err = await fetchLiveToken('sess-1').catch((e) => e);
    expect(err).toBeInstanceOf(LiveTokenError);
    expect(err.code).toBe('gender_required');
    expect(err.message).toBe('يرجى تحديد الجنس للدخول إلى الحلقة.');
  });

  test.each([
    [409, 'not_open', 'not_open'],
    [409, 'ended', 'not_open'],
    [403, 'banned', 'banned'],
    [403, 'forbidden', 'forbidden'],
    [403, 'not_visible', 'forbidden'],
    [401, 'unauthorized', 'forbidden'],
    [404, 'not_found', 'not_found'],
    [502, 'livekit_error', 'unknown'],
    [500, 'server_error', 'unknown'],
  ])('%i %s → %s', async (status, server, code) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, { error: server }) });
    await expect(fetchLiveToken('sess-1')).rejects.toMatchObject({ code });
  });

  test('a transport failure (no response) is network', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send', context: {} } });
    const err = await fetchLiveToken('sess-1').catch((e) => e);
    expect(err).toBeInstanceOf(LiveTokenError);
    expect(err.code).toBe('network');
    expect(err.message).toBe('تعذّر الدخول إلى الحلقة');
  });

  test('a body that is not JSON falls back to the HTTP status', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsHttpError', context: { status: 404, json: async () => { throw new Error('html'); } } },
    });
    await expect(fetchLiveToken('sess-1')).rejects.toMatchObject({ code: 'not_found' });
  });

  test('a malformed success is unknown, never a half token', async () => {
    mockInvoke.mockResolvedValue({ data: { ...ok, role: 'admin' }, error: null });
    await expect(fetchLiveToken('sess-1')).rejects.toMatchObject({ code: 'unknown' });
  });

  test('mapLiveTokenErrorCode without a server code uses the status', () => {
    expect(mapLiveTokenErrorCode(null, 403)).toBe('forbidden');
    expect(mapLiveTokenErrorCode(undefined, 404)).toBe('not_found');
    expect(mapLiveTokenErrorCode(null, 500)).toBe('unknown');
  });
});

describe('liveControl', () => {
  test('sends { action, ...body } and returns ok/status', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, status: 'live' }, error: null });
    await expect(liveControl('leave', { sessionId: 'sess-1' })).resolves.toEqual({ ok: true, status: 'live' });
    expect(mockInvoke).toHaveBeenCalledWith('live-control', {
      body: { sessionId: 'sess-1', action: 'leave' },
      timeout: expect.any(Number),
    });
  });

  test('a refusal carries the server code', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'forbidden' }) });
    const err = await liveControl('end', { sessionId: 'sess-1' }).catch((e) => e);
    expect(err).toBeInstanceOf(LiveControlError);
    expect(err.code).toBe('forbidden');
  });
});

describe('getLiveParticipantsForStaff (D2)', () => {
  test('real names — including a hidden sister’s — camelCased', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          identity: '0123456789abcdef',
          display_name: 'فاطمة',
          hidden_name: true,
          gender: 'f',
          role: 'listener',
          joined_at: '2026-09-28T18:01:00Z',
          left_at: null,
          spoke_seconds: 0,
        },
        {
          identity: 'fedcba9876543210',
          display_name: null,
          hidden_name: false,
          gender: 'm',
          role: 'speaker',
          joined_at: '2026-09-28T18:02:00Z',
          left_at: '2026-09-28T18:30:00Z',
          spoke_seconds: 95.6,
        },
      ],
      error: null,
    });
    await expect(getLiveParticipantsForStaff('sess-1')).resolves.toEqual([
      {
        identity: '0123456789abcdef',
        displayName: 'فاطمة',
        hiddenName: true,
        gender: 'f',
        role: 'listener',
        joinedAt: '2026-09-28T18:01:00Z',
        leftAt: null,
        spokeSeconds: 0,
      },
      {
        identity: 'fedcba9876543210',
        displayName: '',
        hiddenName: false,
        gender: 'm',
        role: 'speaker',
        joinedAt: '2026-09-28T18:02:00Z',
        leftAt: '2026-09-28T18:30:00Z',
        spokeSeconds: 96,
      },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('get_live_participants', { p_session: 'sess-1' });
  });

  test('a non-staff caller gets the RPC’s error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'غير مصرح', code: '42501' } });
    await expect(getLiveParticipantsForStaff('sess-1')).rejects.toMatchObject({ code: '42501' });
  });
});
