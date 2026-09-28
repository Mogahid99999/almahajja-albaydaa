/**
 * app/admin/upload.tsx — server-side compression switch (V23 §6.1).
 *
 * app_config `server_transcode` on (web): the ORIGINAL file is uploaded (XHR
 * progress «جارٍ رفع الملف الأصلي»), ffmpeg.wasm never runs, the lecture is
 * saved audio-less and the media job is followed («جارٍ الضغط على الخادم»)
 * until done/failed. Flag off: the in-browser transcode path is still the one
 * used. A «نشر» choice travels with the job (p_publish_on_done) and the SERVER
 * publishes once the audio is ready — the page never publishes by itself, so
 * closing the tab can't leave the lecture unpublished or publish it early.
 */
import { Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

jest.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/admin/AttachmentManager', () => ({ AttachmentManager: () => null }));
// The real TreePicker reads the sections tree; a single button picks «sec-1».
jest.mock('@/components/admin/TreePicker', () => {
  const { Pressable, Text } = require('react-native');
  return {
    TreePicker: ({ onChange }: { onChange: (id: string) => void }) => (
      <Pressable onPress={() => onChange('sec-1')}>
        <Text>اختيار قسم تجربة</Text>
      </Pressable>
    ),
  };
});

type Mutation = { mutate: jest.Mock; isPending: boolean };
const mkMutation = (): Mutation => ({ mutate: jest.fn(), isPending: false });

const mockAdmin = {
  createLecture: mkMutation(),
};
jest.mock('@/hooks/useAdmin', () => ({
  useSheikhs: () => ({ data: [] }),
  useCreateLecture: () => mockAdmin.createLecture,
  useNextLectureOrder: () => ({ data: undefined }),
}));

type Job = { id: string; status: 'queued' | 'running' | 'done' | 'failed'; progress: number };
const mockMedia = {
  flag: true as boolean | undefined,
  uploadRaw: jest.fn(),
  createServer: mkMutation(),
  retry: mkMutation(),
  discard: jest.fn(),
  job: undefined as Job | undefined,
  jobIdAsked: [] as (string | null)[],
};
jest.mock('@/hooks/useMediaJob', () => ({
  useServerTranscodeFlag: () => ({ data: mockMedia.flag }),
  useUploadRawLecture: () => ({ mutateAsync: mockMedia.uploadRaw }),
  useCreateServerTranscodeLecture: () => mockMedia.createServer,
  useRetryLectureTranscode: () => mockMedia.retry,
  useDiscardRawUpload: () => mockMedia.discard,
  useMediaJob: (id: string | null) => {
    mockMedia.jobIdAsked.push(id);
    return { data: id ? mockMedia.job : undefined };
  },
}));

jest.mock('@/api/mediaJobs', () => ({
  RAW_MAX_BYTES: 2 * 1024 ** 3,
  RawUploadAbortedError: class RawUploadAbortedError extends Error {},
  RawUploadError: class RawUploadError extends Error {},
}));

const mockTranscode = jest.fn();
jest.mock('@/lib/audioTranscode', () => ({
  isAudioFile: () => true,
  transcodeToMp3: (...a: unknown[]) => mockTranscode(...a),
  TranscodeError: class TranscodeError extends Error {},
}));
jest.mock('@/lib/audioDuration', () => ({ extractAudioDuration: () => Promise.resolve(600) }));

const mockPick = jest.fn();
jest.mock('@/lib/documentPicker', () => ({
  getDocumentAsync: (...a: unknown[]) => mockPick(...a),
}));

import UploadScreen from '../../app/admin/upload';

// The first render of the full admin screen can exceed jest's 5 s default when
// the whole suite runs in parallel (seen once cold); the flows themselves are fast.
jest.setTimeout(20_000);

const fakeFile = { size: 5_000_000, type: 'audio/wav' };
const pickedAsset = {
  uri: 'blob:تجربة-1',
  name: 'تجربة درس.wav',
  mimeType: 'audio/wav',
  size: 5_000_000,
  file: fakeFile,
};

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const realOS = Platform.OS;
beforeEach(() => {
  (Platform as { OS: string }).OS = 'web';
  mockAdmin.createLecture = mkMutation();
  mockMedia.flag = true;
  mockMedia.uploadRaw = jest.fn();
  mockMedia.createServer = mkMutation();
  mockMedia.retry = mkMutation();
  mockMedia.discard = jest.fn();
  mockMedia.job = undefined;
  mockMedia.jobIdAsked = [];
  mockTranscode.mockReset();
  mockPick.mockReset();
  mockPick.mockResolvedValue({ canceled: false, assets: [pickedAsset] });
});
afterAll(() => {
  (Platform as { OS: string }).OS = realOS;
});

/** Pick the file, drive the original upload to `key`, and fill in the title. */
async function pickAndUpload(api: Awaited<ReturnType<typeof render>>, key = 'incoming/تجربة.wav') {
  const upload = deferred<{ key: string }>();
  let onProgress: ((r: number) => void) | undefined;
  mockMedia.uploadRaw.mockImplementation((vars: { onProgress?: (r: number) => void }) => {
    onProgress = vars.onProgress;
    return upload.promise;
  });
  await fireEvent.press(api.getByText('اختر ملف الصوت'));
  await act(async () => onProgress?.(0.42));
  expect(api.getByText(/جارٍ رفع الملف الأصلي ٤٢٪/)).toBeTruthy();
  await act(async () => upload.resolve({ key }));
  expect(api.getByText(/تم رفع الملف الأصلي — يُضغط على الخادم بعد الحفظ/)).toBeTruthy();
  await fireEvent.changeText(api.getByPlaceholderText('أدخل عنوان المحاضرة...'), 'تجربة المجلس الأول');
}

describe('server_transcode on (web)', () => {
  test('uploads the original with progress and never runs the in-browser transcode', async () => {
    const api = await render(<UploadScreen />);
    expect(
      api.getByText('أي صيغة صوتية أو فيديو MP4 — يُرفع الملف الأصلي ويُضغط على الخادم'),
    ).toBeTruthy();
    await pickAndUpload(api);

    expect(mockTranscode).not.toHaveBeenCalled();
    // The picker also offers MP4 video (audio track extracted on the server).
    expect(mockPick).toHaveBeenCalledWith(expect.objectContaining({ type: ['audio/*', 'video/mp4'] }));
    // The picked File itself is handed over (streamed PUT), not a buffered copy.
    expect(mockMedia.uploadRaw).toHaveBeenCalledWith(
      expect.objectContaining({ file: fakeFile, name: 'تجربة درس.wav', uri: 'blob:تجربة-1' }),
    );
  });

  test('save creates the audio-less lecture + job, then follows the server progress', async () => {
    const api = await render(<UploadScreen />);
    await pickAndUpload(api);

    await fireEvent.press(api.getByText('حفظ في الواردة'));
    expect(mockAdmin.createLecture.mutate).not.toHaveBeenCalled();
    expect(mockMedia.createServer.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'تجربة المجلس الأول',
        sectionId: null,
        inputKey: 'incoming/تجربة.wav',
      }),
      expect.anything(),
    );

    mockMedia.job = { id: 'job-1', status: 'running', progress: 0.3 };
    const [, opts] = mockMedia.createServer.mutate.mock.calls[0];
    await act(async () => opts.onSuccess({ lectureId: 'lec-1', jobId: 'job-1', publishOnDone: false }));

    expect(mockMedia.jobIdAsked).toContain('job-1');
    expect(api.getByText('جارٍ الضغط على الخادم')).toBeTruthy();
    expect(api.getByText('٣٠٪')).toBeTruthy();
    expect(api.getByText('يمكنك مغادرة الصفحة، سيكتمل الضغط على الخادم.')).toBeTruthy();
    // The saved original now belongs to the job — it must not be discarded.
    expect(mockMedia.discard).not.toHaveBeenCalled();
  });

  test('done → the normal success state', async () => {
    const api = await render(<UploadScreen />);
    await pickAndUpload(api);
    await fireEvent.press(api.getByText('حفظ في الواردة'));
    mockMedia.job = { id: 'job-1', status: 'running', progress: 0.8 };
    const [, opts] = mockMedia.createServer.mutate.mock.calls[0];
    await act(async () => opts.onSuccess({ lectureId: 'lec-1', jobId: 'job-1', publishOnDone: false }));

    mockMedia.job = { id: 'job-1', status: 'done', progress: 1 };
    await api.rerender(<UploadScreen />);

    expect(
      api.getByText('تم حفظ المحاضرة في قائمة الواردة (بدون قسم). صنّفها لاحقاً لنشرها.'),
    ).toBeTruthy();
    expect(api.queryByText('جارٍ الضغط على الخادم')).toBeNull();
  });

  test('«نشر» is delegated to the server (publish_on_done) — the page never publishes itself', async () => {
    const api = await render(<UploadScreen />);
    await pickAndUpload(api);
    await fireEvent.press(api.getByText('اختيار قسم تجربة'));
    await fireEvent.press(api.getByText('منشورة'));
    await fireEvent.press(api.getByText('نشر المحاضرة'));
    await fireEvent.press(api.getByText('نشر')); // confirm dialog

    expect(mockMedia.createServer.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: 'sec-1', notifyOnPublish: true, publish: true }),
      expect.anything(),
    );
    mockMedia.job = { id: 'job-1', status: 'running', progress: 0.1 };
    const [, opts] = mockMedia.createServer.mutate.mock.calls[0];
    await act(async () => opts.onSuccess({ lectureId: 'lec-1', jobId: 'job-1', publishOnDone: true }));
    expect(api.getByText('ستُنشر المحاضرة تلقائيًا بعد اكتمال الضغط على الخادم.')).toBeTruthy();
    expect(api.getByText('يمكنك مغادرة الصفحة، سيكتمل الضغط على الخادم.')).toBeTruthy();

    mockMedia.job = { id: 'job-1', status: 'done', progress: 1 };
    await api.rerender(<UploadScreen />);
    expect(api.getByText('تم نشر المحاضرة بنجاح وستظهر للطلاب.')).toBeTruthy();
  });

  test('a draft choice does not ask the server to publish', async () => {
    const api = await render(<UploadScreen />);
    await pickAndUpload(api);
    await fireEvent.press(api.getByText('اختيار قسم تجربة'));
    await fireEvent.press(api.getByText('حفظ كمسودة'));
    expect(mockMedia.createServer.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: 'sec-1', publish: false }),
      expect.anything(),
    );
    const [, opts] = mockMedia.createServer.mutate.mock.calls[0];
    mockMedia.job = { id: 'job-1', status: 'running', progress: 0.5 };
    await act(async () => opts.onSuccess({ lectureId: 'lec-1', jobId: 'job-1', publishOnDone: false }));
    expect(api.queryByText('ستُنشر المحاضرة تلقائيًا بعد اكتمال الضغط على الخادم.')).toBeNull();
    mockMedia.job = { id: 'job-1', status: 'done', progress: 1 };
    await api.rerender(<UploadScreen />);
    expect(api.getByText('تم حفظ المحاضرة كمسودة. انشرها من شاشة المحاضرات.')).toBeTruthy();
  });

  test('failed → a calm Arabic error with retry that re-queues the same original', async () => {
    const api = await render(<UploadScreen />);
    await pickAndUpload(api, 'incoming/تجربة-2.wav');
    await fireEvent.press(api.getByText('حفظ في الواردة'));
    mockMedia.job = { id: 'job-1', status: 'failed', progress: 0.5 };
    const [, opts] = mockMedia.createServer.mutate.mock.calls[0];
    await act(async () => opts.onSuccess({ lectureId: 'lec-1', jobId: 'job-1', publishOnDone: false }));

    expect(api.getByText('تعذّر ضغط الملف على الخادم')).toBeTruthy();
    expect(
      api.getByText(
        'المحاضرة محفوظة كمسودة بلا صوت. أعد المحاولة، وإن تكرّر ذلك فتأكّد من سلامة الملف، ثم احذف المسودة من شاشة المحاضرات وارفعه من جديد.',
      ),
    ).toBeTruthy();
    await fireEvent.press(api.getByText('إعادة المحاولة'));
    expect(mockMedia.retry.mutate).toHaveBeenCalledWith(
      { lectureId: 'lec-1', inputKey: 'incoming/تجربة-2.wav', publishOnDone: false },
      expect.anything(),
    );
  });

  test('removing an uploaded-but-unsaved original discards it from storage', async () => {
    const api = await render(<UploadScreen />);
    await pickAndUpload(api, 'incoming/تجربة-3.wav');
    await fireEvent.press(api.getByLabelText('إزالة الملف'));
    expect(mockMedia.discard).toHaveBeenCalledWith('incoming/تجربة-3.wav');
    expect(api.getByText('اختر ملف الصوت')).toBeTruthy();
  });
});

describe('server_transcode off', () => {
  test('the in-browser transcode path is still used, unchanged', async () => {
    mockMedia.flag = false;
    const converted = deferred<{
      uri: string;
      name: string;
      size: number;
      mimeType: 'audio/mpeg';
      blob: unknown;
    }>();
    mockTranscode.mockReturnValue(converted.promise);
    const api = await render(<UploadScreen />);
    expect(api.getByText('أي صيغة صوتية — يُضغط الملف تلقائيًا إلى MP3 خفيف للكلام')).toBeTruthy();

    await fireEvent.press(api.getByText('اختر ملف الصوت'));
    expect(mockPick).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio/*' }));
    expect(mockTranscode).toHaveBeenCalledWith(
      { uri: 'blob:تجربة-1', name: 'تجربة درس.wav' },
      expect.anything(),
    );
    expect(mockMedia.uploadRaw).not.toHaveBeenCalled();

    await act(async () =>
      converted.resolve({
        uri: 'blob:mp3',
        name: 'تجربة درس.mp3',
        size: 900_000,
        mimeType: 'audio/mpeg',
        blob: {},
      }),
    );
    await fireEvent.changeText(api.getByPlaceholderText('أدخل عنوان المحاضرة...'), 'تجربة المجلس الأول');
    await fireEvent.press(api.getByText('حفظ في الواردة'));

    expect(mockMedia.createServer.mutate).not.toHaveBeenCalled();
    expect(mockAdmin.createLecture.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'unclassified',
        audioFile: { uri: 'blob:mp3', name: 'تجربة درس.mp3', mimeType: 'audio/mpeg', size: 900_000 },
      }),
      expect.anything(),
    );
    expect(api.queryByText('جارٍ الضغط على الخادم')).toBeNull();
  });
});
