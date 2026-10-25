/**
 * src/api/lectures.ts — «أحدث الدروس» / «المختارات» are gender-scoped by the
 * SERVER (0153), perf fix 2026-10-03.
 *
 * Pins: each list is ONE RPC. The old client filter fired one
 * lecture_visible_to_viewer RPC per lecture (8–24 per Home open), which a
 * push-driven open wave multiplied into the 2026-10-02 database freeze.
 */
const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a), from: (...a: unknown[]) => mockFrom(...a) },
}));
jest.mock('@/config', () => ({ USE_MOCK: false }));
jest.mock('@/api/attachments', () => ({ resolveAttachmentRows: jest.fn() }));
jest.mock('@/api/storage', () => ({ getReadUrl: jest.fn() }));

import { getFeaturedLectures, getRecentLectures } from '@/api/lectures';

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

test('getRecentLectures is a single get_recent_lectures RPC — no per-lecture visibility checks', async () => {
  mockRpc.mockResolvedValue({
    data: [
      { id: 'l1', title: 'درس أول', duration_sec: 600, audio_size_bytes: 1000, order: 1, sheikh_name: 'الشيخ', position_sec: 0, completed: false },
      { id: 'l2', title: 'درس ثانٍ', duration_sec: 900, audio_size_bytes: null, order: 2, sheikh_name: null, position_sec: 120, completed: false },
      { id: 'l3', title: 'درس ثالث', duration_sec: 300, audio_size_bytes: null, order: 3, sheikh_name: null, position_sec: 10, completed: true },
    ],
    error: null,
  });
  const rows = await getRecentLectures(8);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('get_recent_lectures', { p_limit: 8 });
  expect(mockFrom).not.toHaveBeenCalled();
  expect(rows.map((r) => [r.id, r.status])).toEqual([
    ['l1', 'new'],
    ['l2', 'in_progress'],
    ['l3', 'completed'],
  ]);
  expect(rows[0].title).toBe('درس أول');
});

test('getFeaturedLectures is a single get_featured_lectures RPC — no per-lecture visibility checks', async () => {
  mockRpc.mockResolvedValue({
    data: [
      { lecture_id: 'f1', title: 'مختار', duration_sec: 60, audio_size_bytes: null, sheikh_name: 'الشيخ', section_title: 'العقيدة', order: 0, position_sec: 0, completed: false },
    ],
    error: null,
  });
  const rows = await getFeaturedLectures();
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('get_featured_lectures');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: 'f1', title: 'مختار', status: 'new' });
});
