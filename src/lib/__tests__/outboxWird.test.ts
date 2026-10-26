/**
 * «ورد القرآن اليومي» — the completed day reaches the journey through the
 * outbox: queued once per day, kept while offline, sent once on reconnect
 * (the server write is idempotent too), and the journey queries refreshed.
 */
const mockRecord = jest.fn(async (_day: string) => {});
let mockOnline = false;
jest.mock('@/api/journey', () => ({
  recordQuranWirdDay: (day: string) => mockRecord(day),
  setWeeklyGoal: jest.fn(),
}));
jest.mock('@/api/progress', () => ({ replayActivity: jest.fn() }));
jest.mock('@/api/bookmarks', () => ({ replayBookmark: jest.fn() }));
jest.mock('@/api/notes', () => ({ saveMyNote: jest.fn() }));
jest.mock('@/lib/connectivity', () => ({ isOnline: async () => mockOnline, onReconnect: jest.fn() }));
const mockInvalidate = jest.fn();
jest.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: (k: unknown) => mockInvalidate(k) } }));

import { flushOutbox } from '../outbox';
import { clearQueue, enqueueWirdDay, loadQueue } from '../outboxQueue';

beforeEach(async () => {
  await clearQueue();
  mockRecord.mockClear();
  mockInvalidate.mockClear();
  mockOnline = false;
});

test('one entry per completed day, however often it is queued', async () => {
  await enqueueWirdDay('2026-10-26');
  await enqueueWirdDay('2026-10-26');
  await enqueueWirdDay('2026-10-27');
  expect((await loadQueue()).filter((e) => e.kind === 'wird')).toEqual([
    { kind: 'wird', day: '2026-10-26' },
    { kind: 'wird', day: '2026-10-27' },
  ]);
});

test('offline: kept; back online: sent once for its own day, then gone', async () => {
  await enqueueWirdDay('2026-10-26');
  await flushOutbox();
  expect(mockRecord).not.toHaveBeenCalled();
  expect(await loadQueue()).toHaveLength(1);

  mockOnline = true;
  await flushOutbox();
  expect(mockRecord).toHaveBeenCalledTimes(1);
  expect(mockRecord).toHaveBeenCalledWith('2026-10-26');
  expect(await loadQueue()).toHaveLength(0);
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['journey'] });

  await flushOutbox();
  expect(mockRecord).toHaveBeenCalledTimes(1);
});

test('a failed send stays queued for the next try', async () => {
  mockOnline = true;
  mockRecord.mockRejectedValueOnce(new Error('network'));
  await enqueueWirdDay('2026-10-26');
  await flushOutbox();
  expect(await loadQueue()).toHaveLength(1);
  await flushOutbox();
  expect(await loadQueue()).toHaveLength(0);
  expect(mockRecord).toHaveBeenCalledTimes(2);
});
