/**
 * src/api/mediaJobs.ts — server-side lecture compression (V23 §5.3/§6.1).
 *
 * Pins the invariants the upload screen relies on:
 *  - the flag reads app_config `server_transcode` and fails CLOSED (old path);
 *  - the original goes up as the picked Blob via XHR (progress, no buffering)
 *    with its size declared to r2-upload-url kind `lecture_raw`;
 *  - a lecture is created audio-less and as a draft/«واردة», never published,
 *    and a failed enqueue removes the half-made draft;
 *  - every error the admin can see is Arabic.
 */
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
const mockMaybeSingle = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));
jest.mock('@/config', () => ({ USE_MOCK: false }));

const mockCreateLecture = jest.fn();
const mockDeleteLecture = jest.fn();
jest.mock('@/api/admin', () => ({
  createLecture: (...a: unknown[]) => mockCreateLecture(...a),
  deleteLecture: (...a: unknown[]) => mockDeleteLecture(...a),
}));

import {
  createServerTranscodeLecture,
  enqueueLectureTranscode,
  getMediaJob,
  isServerTranscodeEnabled,
  rawContentType,
  RawUploadError,
  uploadRawLecture,
} from '@/api/mediaJobs';

/** Minimal XMLHttpRequest double: records the PUT, lets the test drive it. */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
    FakeXhr.last = this;
  }
  abort() {
    this.onabort?.();
  }
}

const realXhr = (global as { XMLHttpRequest?: unknown }).XMLHttpRequest;
beforeEach(() => {
  (global as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
  FakeXhr.last = null;
  mockInvoke.mockReset();
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockMaybeSingle.mockReset();
  mockCreateLecture.mockReset();
  mockDeleteLecture.mockReset();
  mockFrom.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
  }));
});
afterAll(() => {
  (global as { XMLHttpRequest?: unknown }).XMLHttpRequest = realXhr;
});

/** Let the awaited invoke() settle so the XHR has been sent. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('isServerTranscodeEnabled', () => {
  test("'true' turns it on", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: 'true' }, error: null });
    await expect(isServerTranscodeEnabled()).resolves.toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('app_config');
  });

  test.each([
    ['false', { data: { value: 'false' }, error: null }],
    ['missing row', { data: null, error: null }],
    ['read error', { data: null, error: { message: 'boom' } }],
  ])('%s keeps the in-browser path', async (_label, result) => {
    mockMaybeSingle.mockResolvedValue(result);
    await expect(isServerTranscodeEnabled()).resolves.toBe(false);
  });
});

describe('rawContentType', () => {
  test('extension wins over an unreliable picker type; real MP4 video is kept', () => {
    expect(rawContentType('درس.opus', '')).toBe('audio/ogg');
    expect(rawContentType('درس.wma', 'application/octet-stream')).toBe('audio/x-ms-wma');
    expect(rawContentType('درس.m4a', 'audio/x-m4a')).toBe('audio/mp4');
    expect(rawContentType('مجلس.mp4', 'video/mp4')).toBe('video/mp4');
    expect(rawContentType('مجلس.mp4', '')).toBe('audio/mp4');
  });
});

describe('uploadRawLecture', () => {
  const file = { size: 1234, type: 'audio/wav' } as unknown as Blob;

  test('declares kind/type/size and PUTs the picked Blob itself with progress', async () => {
    mockInvoke.mockResolvedValue({
      data: { uploadUrl: 'https://r2.test/put', key: 'incoming/abc.wav' },
      error: null,
    });
    const progress: number[] = [];
    const p = uploadRawLecture({ file, uri: 'blob:x', name: 'تجربة.wav', onProgress: (r) => progress.push(r) });
    await flush();

    expect(mockInvoke).toHaveBeenCalledWith('r2-upload-url', {
      body: { kind: 'lecture_raw', fileName: 'تجربة.wav', contentType: 'audio/wav', size: 1234 },
    });
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://r2.test/put');
    expect(xhr.headers['Content-Type']).toBe('audio/wav');
    expect(xhr.body).toBe(file); // no arrayBuffer() copy

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 617, total: 1234 });
    xhr.status = 200;
    xhr.onload?.();
    await expect(p).resolves.toEqual({ key: 'incoming/abc.wav' });
    expect(progress).toEqual([0.5, 1]);
  });

  test('a file over 2 GB is refused before asking for a URL', async () => {
    const huge = { size: 2 * 1024 ** 3 + 1, type: 'video/mp4' } as unknown as Blob;
    await expect(uploadRawLecture({ file: huge, uri: 'blob:x', name: 'مجلس.mp4' })).rejects.toThrow(
      'حجم الملف أكبر من ٢ غيغابايت. اختر ملفًا أصغر.',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('server refusals surface as Arabic, never the raw English code', async () => {
    mockInvoke.mockResolvedValue({ data: { error: 'forbidden' }, error: null });
    const err = await uploadRawLecture({ file, uri: 'blob:x', name: 'تجربة.wav' }).catch((e) => e);
    expect(err).toBeInstanceOf(RawUploadError);
    expect(err.message).toBe('لا تملك صلاحية رفع المحاضرات.');
  });

  test('an R2 rejection of the PUT is an Arabic error', async () => {
    mockInvoke.mockResolvedValue({
      data: { uploadUrl: 'https://r2.test/put', key: 'incoming/abc.wav' },
      error: null,
    });
    const p = uploadRawLecture({ file, uri: 'blob:x', name: 'تجربة.wav' });
    await flush();
    FakeXhr.last!.status = 403;
    FakeXhr.last!.onload?.();
    await expect(p).rejects.toThrow('تعذّر رفع الملف الأصلي (403). أعد المحاولة.');
  });
});

describe('enqueueLectureTranscode', () => {
  test('calls the RPC with the lecture + incoming key and returns the job id', async () => {
    mockRpc.mockResolvedValue({ data: 'job-1', error: null });
    await expect(enqueueLectureTranscode('lec-1', 'incoming/abc.wav')).resolves.toBe('job-1');
    expect(mockRpc).toHaveBeenCalledWith('enqueue_lecture_transcode', {
      p_lecture: 'lec-1',
      p_input_key: 'incoming/abc.wav',
      p_publish_on_done: false,
    });
  });

  test('a retry after a failed job re-sends the same key and publish choice', async () => {
    mockRpc.mockResolvedValue({ data: 'job-2', error: null });
    await expect(enqueueLectureTranscode('lec-1', 'incoming/abc.wav', true)).resolves.toBe('job-2');
    expect(mockRpc).toHaveBeenCalledWith('enqueue_lecture_transcode', {
      p_lecture: 'lec-1',
      p_input_key: 'incoming/abc.wav',
      p_publish_on_done: true,
    });
  });
});

describe('createServerTranscodeLecture', () => {
  const base = {
    title: 'تجربة المجلس الأول',
    sheikhId: null,
    order: 3,
    notifyOnPublish: false,
    inputKey: 'incoming/abc.wav',
  };

  test('creates an audio-less DRAFT (never published) and queues the job', async () => {
    mockCreateLecture.mockResolvedValue({ id: 'lec-1' });
    mockRpc.mockResolvedValue({ data: 'job-1', error: null });
    await expect(createServerTranscodeLecture({ ...base, sectionId: 'sec-1' })).resolves.toEqual({
      lectureId: 'lec-1',
      jobId: 'job-1',
      publishOnDone: false,
    });
    expect(mockCreateLecture).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        sectionId: 'sec-1',
        audioFile: null,
        notifyOnPublish: false,
      }),
    );
  });

  test('«نشر» becomes p_publish_on_done — the row itself is still a draft', async () => {
    mockCreateLecture.mockResolvedValue({ id: 'lec-1' });
    mockRpc.mockResolvedValue({ data: 'job-1', error: null });
    await expect(
      createServerTranscodeLecture({ ...base, sectionId: 'sec-1', publish: true }),
    ).resolves.toEqual({ lectureId: 'lec-1', jobId: 'job-1', publishOnDone: true });
    expect(mockCreateLecture).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
    expect(mockRpc).toHaveBeenCalledWith(
      'enqueue_lecture_transcode',
      expect.objectContaining({ p_publish_on_done: true }),
    );
  });

  test('without a section it lands in «الواردة» and is never auto-published', async () => {
    mockCreateLecture.mockResolvedValue({ id: 'lec-2' });
    mockRpc.mockResolvedValue({ data: 'job-2', error: null });
    await createServerTranscodeLecture({ ...base, sectionId: null, publish: true });
    expect(mockCreateLecture).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unclassified', audioFile: null }),
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'enqueue_lecture_transcode',
      expect.objectContaining({ p_publish_on_done: false }),
    );
  });

  test('a failed enqueue removes the half-made draft and rethrows', async () => {
    mockCreateLecture.mockResolvedValue({ id: 'lec-3' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    mockDeleteLecture.mockResolvedValue(undefined);
    await expect(createServerTranscodeLecture({ ...base, sectionId: 'sec-1' })).rejects.toBeTruthy();
    expect(mockDeleteLecture).toHaveBeenCalledWith('lec-3');
  });
});

describe('getMediaJob', () => {
  test('maps the row and clamps progress to 0..1', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'job-1', status: 'running', progress: 1.7, error: null, lecture_id: 'lec-1' },
      error: null,
    });
    await expect(getMediaJob('job-1')).resolves.toEqual({
      id: 'job-1',
      status: 'running',
      progress: 1,
      error: null,
      lectureId: 'lec-1',
    });
    expect(mockFrom).toHaveBeenCalledWith('media_jobs');
  });

  test('an unseen job is null', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getMediaJob('job-x')).resolves.toBeNull();
  });
});
