/**
 * src/api/liveComments.ts — «التعليقات والأسئلة أثناء البث» data access (0147).
 *
 * Pins:
 *  - reads map the public shape (+ mine / deleted) and drop malformed rows;
 *  - nameless stays nameless (name null — an empty name is nameless too);
 *  - writes go through live-control with the contract's body, and every
 *    refusal surfaces as LiveControlError(<server code>) for the UI's Arabic copy;
 *  - parseCommentsMessage decodes UTF-8 (Arabic!) — with or without a
 *    TextDecoder — and rejects anything malformed.
 */
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

import { LiveControlError, liveControl } from '@/api/live';
import {
  blockLiveCommentAuthor,
  decodeUtf8,
  deleteLiveComment,
  getAdminLiveComments,
  getLiveComments,
  LIVE_COMMENTS_TOPIC,
  parseCommentsMessage,
  postLiveComment,
  setLiveCommentAnswered,
  toLiveComment,
} from '@/api/liveComments';
import { queryKeys } from '@/constants/queryKeys';

const SESSION = '3f2b8c1e-9a4d-4c7e-8b1a-2d5e6f708192';
const C1 = 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const C2 = 'd1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** A FunctionsHttpError double: non-2xx with the function's `{ error }` body. */
const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => body },
});

const named = {
  id: C1,
  kind: 'comment',
  text: 'جزاكم الله خيراً',
  name: 'عبد الله',
  gender: 'm',
  answered: false,
  at: '2026-09-30T18:00:00.123456+00:00',
};
const nameless = {
  id: C2,
  kind: 'question',
  text: 'ما حكم صلاة الوتر بعد الفجر؟',
  name: null,
  gender: 'f',
  answered: true,
  at: '2026-09-30T18:00:12+00:00',
};

/** UTF-8 bytes of a JSON value (what live-control's TextEncoder sends). */
const bytes = (v: unknown) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));

beforeEach(() => {
  mockInvoke.mockReset();
  mockRpc.mockReset();
});

describe('reads', () => {
  test('get_live_comments → the public shape with mine, oldest first as the server sent it', async () => {
    mockRpc.mockResolvedValue({ data: [{ ...named, mine: true }, { ...nameless, mine: false }], error: null });
    await expect(getLiveComments(SESSION)).resolves.toEqual([
      { ...named, mine: true },
      { ...nameless, mine: false },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('get_live_comments', { p_session: SESSION });
  });

  test('malformed rows are dropped; a user id in a row never reaches the UI', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { ...named, user_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' },
        { ...named, id: 'not-a-uuid' },
        { ...named, gender: 'x' },
        { ...named, text: '' },
        { ...named, text: 'ب'.repeat(301) },
        { ...named, at: 'yesterday' },
        null,
        'x',
      ],
      error: null,
    });
    const list = await getLiveComments(SESSION);
    expect(list).toEqual([named]);
    expect(list[0]).not.toHaveProperty('user_id');
  });

  test('an empty name is nameless — never a blank author', () => {
    expect(toLiveComment({ ...named, name: '  ' })?.name).toBeNull();
    expect(toLiveComment({ ...named, name: undefined })?.name).toBeNull();
    expect(toLiveComment({ ...named, name: 7 })).toBeNull();
  });

  test('a non-participant gets the RPC error thrown as is', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'غير مصرح', code: '42501' } });
    await expect(getLiveComments(SESSION)).rejects.toMatchObject({ code: '42501' });
  });

  test('admin_live_comments carries deleted', async () => {
    mockRpc.mockResolvedValue({ data: [{ ...named, mine: false, deleted: true }], error: null });
    await expect(getAdminLiveComments(SESSION)).resolves.toEqual([{ ...named, mine: false, deleted: true }]);
    expect(mockRpc).toHaveBeenCalledWith('admin_live_comments', { p_session: SESSION });
  });
});

describe('writes (live-control)', () => {
  test('postLiveComment sends the contract body and returns the stored comment as mine', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, status: 'live', comment: { ...nameless, mine: true } }, error: null });
    await expect(
      postLiveComment({ sessionId: SESSION, kind: 'question', text: nameless.text, anonymous: true }),
    ).resolves.toEqual({ ...nameless, mine: true });
    expect(mockInvoke).toHaveBeenCalledWith('live-control', {
      body: { action: 'comment', sessionId: SESSION, kind: 'question', text: nameless.text, anonymous: true },
      timeout: expect.any(Number),
    });
  });

  test.each([
    [403, 'guest_cannot_comment'],
    [409, 'not_live'],
    [409, 'not_present'],
    [403, 'blocked'],
    [400, 'blocked_words'],
    [400, 'too_long'],
    [400, 'empty'],
    [429, 'rate_limited'],
  ])('%i %s surfaces as LiveControlError(%s)', async (status, code) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, { error: code }) });
    const err = await postLiveComment({ sessionId: SESSION, kind: 'comment', text: 'تعليق', anonymous: false }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(LiveControlError);
    expect(err.code).toBe(code);
  });

  test('empty / over-long text is refused locally with the server codes (no round trip)', async () => {
    await expect(postLiveComment({ sessionId: SESSION, kind: 'comment', text: '  \n ', anonymous: false })).rejects.toMatchObject({
      code: 'empty',
    });
    await expect(
      postLiveComment({ sessionId: SESSION, kind: 'comment', text: 'ب'.repeat(301), anonymous: false }),
    ).rejects.toMatchObject({ code: 'too_long' });
    // 300 emoji = 300 characters for the server, not 600.
    mockInvoke.mockResolvedValue({ data: { ok: true, comment: { ...named, text: '🌙'.repeat(300) } }, error: null });
    await expect(
      postLiveComment({ sessionId: SESSION, kind: 'comment', text: '🌙'.repeat(300), anonymous: false }),
    ).resolves.toMatchObject({ text: '🌙'.repeat(300) });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test('a transport failure is network; a malformed success is unknown', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed', context: {} } });
    await expect(postLiveComment({ sessionId: SESSION, kind: 'comment', text: 'x', anonymous: false })).rejects.toMatchObject({
      code: 'network',
    });
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(postLiveComment({ sessionId: SESSION, kind: 'comment', text: 'x', anonymous: false })).rejects.toMatchObject({
      code: 'unknown',
    });
  });

  test('delete / answered / block bodies', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, status: 'live', id: C1 }, error: null });
    await deleteLiveComment(SESSION, C1);
    await setLiveCommentAnswered(SESSION, C1, true);
    await blockLiveCommentAuthor(SESSION, C1);
    expect(mockInvoke.mock.calls.map((c) => c[1].body)).toEqual([
      { action: 'comment_delete', sessionId: SESSION, commentId: C1 },
      { action: 'comment_answered', sessionId: SESSION, commentId: C1, answered: true },
      { action: 'comment_block', sessionId: SESSION, commentId: C1 },
    ]);
  });

  test('moderation refusals carry the server code', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'forbidden' }) });
    await expect(blockLiveCommentAuthor(SESSION, C1)).rejects.toMatchObject({ code: 'forbidden' });
    mockInvoke.mockResolvedValue({ data: null, error: httpError(404, { error: 'not_found' }) });
    await expect(deleteLiveComment(SESSION, C1)).rejects.toMatchObject({ code: 'not_found' });
  });

  test('liveControl keeps its { ok, status } result', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, status: 'live', comment: named }, error: null });
    await expect(liveControl('leave', { sessionId: SESSION })).resolves.toEqual({ ok: true, status: 'live' });
  });
});

describe('parseCommentsMessage (topic "comments")', () => {
  test('the topic', () => {
    expect(LIVE_COMMENTS_TOPIC).toBe('comments');
  });

  test('add — Arabic text and name survive UTF-8', () => {
    expect(parseCommentsMessage(bytes({ t: 'add', c: named }))).toEqual({ t: 'add', c: named });
    expect(parseCommentsMessage(bytes({ t: 'add', c: nameless }))).toEqual({ t: 'add', c: nameless });
  });

  test('add never carries mine / deleted, even if sent', () => {
    const m = parseCommentsMessage(bytes({ t: 'add', c: { ...named, mine: true, deleted: false } }));
    expect(m).toEqual({ t: 'add', c: named });
  });

  test('del / ans', () => {
    expect(parseCommentsMessage(bytes({ t: 'del', id: C1 }))).toEqual({ t: 'del', id: C1 });
    expect(parseCommentsMessage(bytes({ t: 'ans', id: C1, answered: false }))).toEqual({ t: 'ans', id: C1, answered: false });
  });

  test.each([
    ['not JSON', bytes('{t:add')],
    ['a JSON array', bytes([{ t: 'del', id: C1 }])],
    ['null', bytes('null')],
    ['unknown t', bytes({ t: 'rejected' })],
    ['del without an id', bytes({ t: 'del' })],
    ['del with a non-uuid id', bytes({ t: 'del', id: '1; drop' })],
    ['ans without answered', bytes({ t: 'ans', id: C1 })],
    ['ans with a string answered', bytes({ t: 'ans', id: C1, answered: 'true' })],
    ['add without c', bytes({ t: 'add' })],
    ['add with a bad kind', bytes({ t: 'add', c: { ...named, kind: 'note' } })],
    ['add with a missing gender', bytes({ t: 'add', c: { ...named, gender: undefined } })],
    ['empty payload', new Uint8Array(0)],
    ['invalid UTF-8', new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])],
    ['a truncated multibyte char', bytes({ t: 'del', id: C1 }).slice(0, 5).map((b, i) => (i === 4 ? 0xd8 : b))],
    ['too big', new Uint8Array(20_000).fill(0x20)],
  ])('%s → null', (_label, payload) => {
    expect(parseCommentsMessage(payload as Uint8Array)).toBeNull();
  });

  describe('without TextDecoder (the strict fallback)', () => {
    const realTD = globalThis.TextDecoder;
    beforeAll(() => {
      (globalThis as { TextDecoder?: unknown }).TextDecoder = undefined;
    });
    afterAll(() => {
      (globalThis as { TextDecoder?: unknown }).TextDecoder = realTD;
    });

    test('Arabic, emoji and ASCII decode the same', () => {
      const text = 'بارك الله فيكم 🌙 — OK';
      expect(decodeUtf8(bytes(text))).toBe(text);
      expect(parseCommentsMessage(bytes({ t: 'add', c: nameless }))).toEqual({ t: 'add', c: nameless });
      expect(parseCommentsMessage(bytes({ t: 'add', c: { ...named, text: '🌙 تقبّل الله' } }))).toEqual({
        t: 'add',
        c: { ...named, text: '🌙 تقبّل الله' },
      });
    });

    test('invalid sequences are rejected, not mangled', () => {
      expect(decodeUtf8(new Uint8Array([0xc3, 0x28]))).toBeNull(); // bad continuation
      expect(decodeUtf8(new Uint8Array([0xc0, 0xaf]))).toBeNull(); // overlong
      expect(decodeUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toBeNull(); // surrogate
      expect(decodeUtf8(new Uint8Array([0xd8]))).toBeNull(); // truncated
      expect(parseCommentsMessage(new Uint8Array([0x7b, 0xff, 0x7d]))).toBeNull();
    });
  });
});

test('query keys: under the never-persisted live root', () => {
  expect(queryKeys.liveComments(SESSION)).toEqual(['live', 'comments', SESSION]);
  expect(queryKeys.liveAdminComments(SESSION)).toEqual(['live', 'admin', 'comments', SESSION]);
});
