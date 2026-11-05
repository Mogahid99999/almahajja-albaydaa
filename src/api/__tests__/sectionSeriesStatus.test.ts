/**
 * «مستمر» / «منتهي» (0164) — get_home_page / get_section_page carry the
 * section's series_status; anything but the two known values (incl. a server
 * from before 0164 that sends nothing) reads as «not set», so no badge shows.
 * Also pins the 0164 restore of lecture file sizes on the section page.
 */
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock('@/config', () => ({ USE_MOCK: false }));
jest.mock('@/lib/queryClient', () => ({ queryClient: { prefetchQuery: jest.fn() } }));
jest.mock('@/api/attachments', () => ({ resolveAttachmentRows: async () => [] }));

import { getHomeData, getSectionPage } from '@/api/sections';
import { toSeriesStatus } from '@/api/types';

beforeEach(() => mockRpc.mockReset());

test('only the two known values survive', () => {
  expect(toSeriesStatus('ongoing')).toBe('ongoing');
  expect(toSeriesStatus('completed')).toBe('completed');
  expect(toSeriesStatus(undefined)).toBeNull();
  expect(toSeriesStatus(null)).toBeNull();
  expect(toSeriesStatus('paused')).toBeNull();
});

test('home section cards carry the status (missing key → null)', async () => {
  mockRpc.mockResolvedValue({
    data: {
      sections: [
        { id: 'a', title: 'العقيدة', cover_letter: 'ع', total: 4, completed: 1, series_status: 'completed' },
        { id: 'b', title: 'الفقه', cover_letter: 'ف', total: 2, completed: 0, series_status: 'ongoing' },
        { id: 'c', title: 'الحديث', cover_letter: 'ح', total: 0, completed: 0 },
      ],
      newly_added: [],
      featured: [],
      continue_listening: null,
    },
    error: null,
  });
  const home = await getHomeData();
  expect(home.sections.map((s) => s.seriesStatus)).toEqual(['completed', 'ongoing', null]);
});

test('the section page and its sub-section cards carry the status; lecture sizes are back', async () => {
  mockRpc.mockResolvedValue({
    data: {
      section: {
        id: 's', title: 'عمدة الأحكام', description: null, cover_image: null, cover_letter: 'ع',
        show_header: true, parent_id: null, series_status: 'ongoing',
      },
      parent_title: null,
      rollup: { total: 1, completed: 0, sheikh_names: [] },
      subsections: [
        { id: 'x', title: 'المجلس الأول', cover_letter: 'م', total: 1, completed: 0, series_status: 'completed' },
      ],
      lectures: [
        {
          id: 'l1', title: 'الدرس الأول', duration_sec: 60, audio_size_bytes: 1048576, order: 1,
          sheikh_name: null, position_sec: 0, completed: false,
        },
      ],
      attachments: [],
      quizzes: [],
    },
    error: null,
  });
  const page = await getSectionPage('s');
  expect(page.section.seriesStatus).toBe('ongoing');
  expect(page.subsections[0].seriesStatus).toBe('completed');
  expect(page.lectures[0].fileSizeBytes).toBe(1048576);
});
