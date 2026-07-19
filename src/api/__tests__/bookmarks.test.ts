/**
 * src/api/bookmarks.ts — «للمراجعة لاحقًا» (V20 · §4).
 *
 * Pins the offline contract: a mark added with no connection is QUEUED (never
 * dropped) and resolves normally; online it goes straight to add_bookmark; a
 * failed online write also falls back to the queue.
 */
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

const mockEnqueue = jest.fn();
jest.mock('@/lib/outboxQueue', () => ({ enqueueBookmark: (...a: unknown[]) => mockEnqueue(...a) }));

const mockIsOnline = jest.fn();
jest.mock('@/lib/connectivity', () => ({ isOnlineSync: () => mockIsOnline() }));

jest.mock('@/config', () => ({ USE_MOCK: false }));

import { addBookmark } from '@/api/bookmarks';

beforeEach(() => {
  mockRpc.mockReset();
  mockEnqueue.mockReset();
  mockIsOnline.mockReset();
  mockRpc.mockResolvedValue({ error: null });
});

test('online → calls add_bookmark, does not queue', async () => {
  mockIsOnline.mockReturnValue(true);
  await addBookmark({ lectureId: 'lec-1', positionSec: 24.7, note: 'راجع هذا' });
  expect(mockRpc).toHaveBeenCalledWith('add_bookmark', {
    p_lecture_id: 'lec-1',
    p_position_sec: 25, // rounded
    p_note: 'راجع هذا',
  });
  expect(mockEnqueue).not.toHaveBeenCalled();
});

test('offline → queues the mark, never calls the RPC', async () => {
  mockIsOnline.mockReturnValue(false);
  await addBookmark({ lectureId: 'lec-2', positionSec: 100 });
  expect(mockRpc).not.toHaveBeenCalled();
  expect(mockEnqueue).toHaveBeenCalledWith({ lectureId: 'lec-2', positionSec: 100, note: null });
});

test('online failure → falls back to the queue (never dropped)', async () => {
  mockIsOnline.mockReturnValue(true);
  mockRpc.mockResolvedValue({ error: { message: 'boom' } });
  await addBookmark({ lectureId: 'lec-3', positionSec: 5, note: '  ' });
  expect(mockRpc).toHaveBeenCalled();
  // whitespace-only note normalizes to null
  expect(mockEnqueue).toHaveBeenCalledWith({ lectureId: 'lec-3', positionSec: 5, note: null });
});
