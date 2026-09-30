/**
 * src/api/liveAdmin.ts — the staff side of «البث المباشر» (V23 P6).
 *
 * Pins:
 *  - admin_live_overview / admin_live_inbox / get_live_interventions jsonb →
 *    the camelCase contract the screens render (bad rows dropped, progress
 *    clamped, a sheikh's job error stays null);
 *  - admin_save_live_lecture gets the trimmed title and the publish/notify
 *    choice exactly («نشر» / «نشر بدون إشعار» / «حفظ دون نشر»), with the
 *    section only when it was changed;
 *  - the raw download goes to the media worker's GET /recordings/:sessionId
 *    with the user JWT, and every failure is ONE Arabic line.
 */
import { Platform } from 'react-native';

const mockRpc = jest.fn();
const mockGetSession = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
    auth: { getSession: (...a: unknown[]) => mockGetSession(...a) },
  },
}));

import {
  downloadRawRecording,
  endLiveSession,
  getLiveAdminOverview,
  getLiveInbox,
  getLiveInterventions,
  mapLiveAdminSession,
  RAW_DOWNLOAD_COPY,
  RawDownloadError,
  rawDownloadErrorText,
  rawFileName,
  rawRecordingUrl,
  retryLiveRecording,
  saveLiveLecture,
} from '@/api/liveAdmin';

const rawSession = {
  id: 's1',
  title: 'شرح كتاب التوحيد · الدرس السابع',
  status: 'processing',
  section_id: 'sec1',
  section_title: 'كتاب التوحيد',
  sheikh_id: 'sh1',
  sheikh_name: 'الشيخ عبد الله',
  host_user_id: 'u1',
  host_name: 'عبد الله',
  is_mine: true,
  scheduled_at: null,
  started_at: '2026-09-29T17:00:00Z',
  ended_at: '2026-09-29T18:00:00Z',
  created_at: '2026-09-29T16:55:00Z',
  share_code: 'ABC234',
  peak_listeners: 42,
  attendees: 0,
  lecture_id: null,
  lecture_status: null,
  lecture_needs_title: false,
  duration_sec: null,
  raw_local: true,
  raw_backup: false,
  job: { id: 'j1', status: 'running', progress: 1.7, attempts: 1, error: null },
};

const realOS = Platform.OS;
const realFetch = global.fetch;
beforeEach(() => {
  mockRpc.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt-staff' } } });
});
afterEach(() => {
  (Platform as { OS: string }).OS = realOS;
  global.fetch = realFetch;
  delete process.env.EXPO_PUBLIC_MEDIA_WORKER_URL;
});

describe('reads', () => {
  test('admin_live_overview maps the three groups and drops rows without an id', async () => {
    mockRpc.mockResolvedValue({
      data: {
        active: [{ ...rawSession, id: 'live1', status: 'live', attendees: 12, job: null }],
        scheduled: [{ title: 'بلا معرّف' }],
        recent: [rawSession],
        is_manager: true,
      },
      error: null,
    });
    const o = await getLiveAdminOverview();
    expect(mockRpc).toHaveBeenCalledWith('admin_live_overview', { p_recent: 20 });
    expect(o.isManager).toBe(true);
    expect(o.active[0]).toMatchObject({ id: 'live1', status: 'live', attendees: 12, job: null });
    expect(o.scheduled).toEqual([]);
    expect(o.recent[0]).toMatchObject({
      sectionTitle: 'كتاب التوحيد',
      sheikhName: 'الشيخ عبد الله',
      isMine: true,
      peakListeners: 42,
      rawLocal: true,
      rawBackup: false,
    });
    // progress is clamped to 0..1
    expect(o.recent[0].job).toMatchObject({ id: 'j1', status: 'running', progress: 1, attempts: 1, error: null });
  });

  test('an unknown status never crashes the card; a missing job is null', () => {
    const s = mapLiveAdminSession({ ...rawSession, status: 'weird', job: { status: 'done' } });
    expect(s?.status).toBe('ended');
    expect(s?.job).toBeNull();
  });

  test('a failed overview read throws (the screen shows its Arabic line)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'غير مصرح' } });
    await expect(getLiveAdminOverview()).rejects.toMatchObject({ message: 'غير مصرح' });
  });

  test('admin_live_inbox maps drafts (with the sheikh suggestion) and pending recordings', async () => {
    mockRpc.mockResolvedValue({
      data: {
        drafts: [
          {
            lecture_id: 'lec1',
            title: 'شرح كتاب التوحيد',
            section_id: 'sec1',
            section_title: 'كتاب التوحيد',
            order: 7,
            sheikh_id: null,
            suggested_sheikh_id: 'sh1',
            suggested_sheikh_name: 'الشيخ عبد الله',
            duration_sec: 3252,
            created_at: '2026-09-29T18:10:00Z',
            notify_on_publish: true,
            session_id: 's1',
            session_title: 'شرح كتاب التوحيد',
            started_at: '2026-09-29T17:00:00Z',
            ended_at: '2026-09-29T18:00:00Z',
            peak_listeners: 42,
          },
          { title: 'بلا معرّف' },
        ],
        pending: [rawSession],
      },
      error: null,
    });
    const inbox = await getLiveInbox();
    expect(mockRpc).toHaveBeenCalledWith('admin_live_inbox');
    expect(inbox.drafts).toHaveLength(1);
    expect(inbox.drafts[0]).toMatchObject({
      lectureId: 'lec1',
      order: 7,
      sheikhId: null,
      suggestedSheikhId: 'sh1',
      durationSec: 3252,
      notifyOnPublish: true,
      sessionId: 's1',
    });
    expect(inbox.pending[0].id).toBe('s1');
  });

  test('get_live_interventions keeps real names (D2) and the stint offsets', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          identity: 'a1b2c3d4e5f60718',
          display_name: 'فاطمة علي',
          hidden_name: true,
          gender: 'f',
          role: 'speaker',
          spoke_seconds: 135,
          stints: [{ from_at: '2026-09-29T17:12:30Z', to_at: '2026-09-29T17:14:45Z', from_sec: 750, to_sec: 885 }, {}],
        },
        { display_name: 'بلا هوية' },
      ],
      error: null,
    });
    const rows = await getLiveInterventions('s1');
    expect(mockRpc).toHaveBeenCalledWith('get_live_interventions', { p_session: 's1' });
    expect(rows).toEqual([
      {
        identity: 'a1b2c3d4e5f60718',
        displayName: 'فاطمة علي',
        hiddenName: true,
        gender: 'f',
        role: 'speaker',
        spokeSeconds: 135,
        stints: [{ fromAt: '2026-09-29T17:12:30Z', toAt: '2026-09-29T17:14:45Z', fromSec: 750, toSec: 885 }],
      },
    ]);
  });
});

describe('writes', () => {
  test('«نشر» sends the trimmed title + sheikh, publish and notify', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await saveLiveLecture({ lectureId: 'lec1', title: '  العنوان النهائي  ', sheikhId: 'sh1', publish: true, notify: true });
    expect(mockRpc).toHaveBeenCalledWith('admin_save_live_lecture', {
      p_lecture: 'lec1',
      p_title: 'العنوان النهائي',
      p_sheikh: 'sh1',
      p_section: null,
      p_publish: true,
      p_notify: true,
    });
  });

  test('«حفظ دون نشر» with a changed section', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await saveLiveLecture({
      lectureId: 'lec1',
      title: 'العنوان',
      sheikhId: 'sh1',
      sectionId: 'sec2',
      publish: false,
      notify: false,
    });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_section: 'sec2', p_publish: false });
  });

  test('a refused save surfaces the server message', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'اختر الشيخ' } });
    await expect(
      saveLiveLecture({ lectureId: 'lec1', title: 'العنوان', sheikhId: 'x', publish: true, notify: true }),
    ).rejects.toMatchObject({ message: 'اختر الشيخ' });
  });

  test('«إعادة المعالجة» calls retry_live_recording', async () => {
    mockRpc.mockResolvedValue({ data: 'job2', error: null });
    await expect(retryLiveRecording('s1')).resolves.toBe('job2');
    expect(mockRpc).toHaveBeenCalledWith('retry_live_recording', { p_session: 's1' });
  });
});

describe('raw recording download (media worker)', () => {
  test('the URL comes from EXPO_PUBLIC_MEDIA_WORKER_URL (trailing slash trimmed); none when unset', () => {
    expect(rawRecordingUrl('s1')).toBeNull();
    process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = 'https://media.example.app/';
    expect(rawRecordingUrl('s1')).toBe('https://media.example.app/recordings/s1');
  });

  test('status codes map to one Arabic line each', () => {
    expect(rawDownloadErrorText(401)).toBe(RAW_DOWNLOAD_COPY.unauthorized);
    expect(rawDownloadErrorText(403)).toBe(RAW_DOWNLOAD_COPY.forbidden);
    expect(rawDownloadErrorText(404)).toBe(RAW_DOWNLOAD_COPY.notFound);
    expect(rawDownloadErrorText(503)).toBe(RAW_DOWNLOAD_COPY.unavailable);
  });

  test('the saved file name is the session title, safe for any OS', () => {
    expect(rawFileName('شرح: كتاب/التوحيد?')).toBe('التسجيل الأصلي - شرح كتاب التوحيد.ogg');
    expect(rawFileName('   ')).toBe('التسجيل الأصلي - مجلس.ogg');
  });

  test('not configured → a clear Arabic error, no request', async () => {
    const fetchSpy = jest.fn();
    (global as { fetch: unknown }).fetch = fetchSpy;
    await expect(downloadRawRecording('s1', 'مجلس')).rejects.toThrow(RAW_DOWNLOAD_COPY.notConfigured);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('web: GET with the staff JWT; a 403 is «لا تملك صلاحية…», a network drop is the network line', async () => {
    (Platform as { OS: string }).OS = 'web';
    process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = 'https://media.example.app';
    const fetchSpy = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    (global as { fetch: unknown }).fetch = fetchSpy;

    const err = await downloadRawRecording('s1', 'مجلس').catch((e) => e);
    expect(err).toBeInstanceOf(RawDownloadError);
    expect(err.message).toBe(RAW_DOWNLOAD_COPY.forbidden);
    expect(fetchSpy).toHaveBeenCalledWith('https://media.example.app/recordings/s1', {
      headers: { Authorization: 'Bearer jwt-staff' },
      redirect: 'follow',
    });

    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(downloadRawRecording('s1', 'مجلس')).rejects.toThrow(RAW_DOWNLOAD_COPY.network);
  });

  test('no session → «انتهت الجلسة…» before any request', async () => {
    process.env.EXPO_PUBLIC_MEDIA_WORKER_URL = 'https://media.example.app';
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const fetchSpy = jest.fn();
    (global as { fetch: unknown }).fetch = fetchSpy;
    await expect(downloadRawRecording('s1', 'مجلس')).rejects.toThrow(RAW_DOWNLOAD_COPY.unauthorized);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('endLiveSession («إنهاء البث للجميع» from the staff screen)', () => {
  test('live-control `end` for that session', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, status: 'ended' }, error: null });
    await endLiveSession('s-live');
    expect(mockInvoke).toHaveBeenCalledWith('live-control', {
      body: { sessionId: 's-live', action: 'end' },
      timeout: 20_000,
    });
  });

  test('a refusal is a LiveControlError with the server code', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsHttpError', context: { status: 403, json: async () => ({ error: 'forbidden' }) } },
    });
    await expect(endLiveSession('s-live')).rejects.toMatchObject({ name: 'LiveControlError', code: 'forbidden' });
  });

  test('no answer → «network», never a hang', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', context: {} } });
    await expect(endLiveSession('s-live')).rejects.toMatchObject({ code: 'network' });
  });
});
