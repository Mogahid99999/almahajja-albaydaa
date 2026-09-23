/**
 * src/api/admin.ts — «نشر بدون إشعار» (migration 0123).
 *
 * The whole feature hangs on one field reaching the INSERT: the publish trigger
 * reads lectures.notify_on_publish and skips the fan-out when it is false. If
 * the client ever stops sending it, a lecture meant to land quietly would push
 * to every student instead — and with ~10 k students that is not recallable.
 * So pin both directions, plus the default.
 */
const mockInsert = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (payload: unknown) => {
        mockInsert(payload);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'lec-new' }, error: null }),
          }),
        };
      },
    }),
  },
}));

jest.mock('@/config', () => ({ USE_MOCK: false }));

const mockDeleteFromR2 = jest.fn();
jest.mock('@/api/storage', () => ({
  deleteFromR2: (...a: unknown[]) => mockDeleteFromR2(...a),
  uploadToR2: jest.fn(),
}));

import { createLecture } from '@/api/admin';

const base = {
  title: 'المجلس الأول',
  sectionId: 'sec-1',
  sheikhId: null,
  order: 1,
  status: 'published' as const,
};

beforeEach(() => {
  mockInsert.mockReset();
  mockDeleteFromR2.mockReset();
});

test('the toggle off publishes silently — notify_on_publish reaches the INSERT as false', async () => {
  await createLecture({ ...base, notifyOnPublish: false });
  expect(mockInsert).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'published', notify_on_publish: false }),
  );
});

test('the toggle on notifies, as it always has', async () => {
  await createLecture({ ...base, notifyOnPublish: true });
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ notify_on_publish: true }));
});

test('omitting the flag defaults to notifying — an older caller cannot silence a lecture by accident', async () => {
  await createLecture(base);
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ notify_on_publish: true }));
});
