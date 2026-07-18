/**
 * src/lib/audioController.ts — load-path invariants (audit phase 5).
 *
 * Guards:
 *  - F-500: a second same-lecture preload while a load is in flight shares the
 *    REAL in-flight promise (the player screen's .catch must observe a load
 *    the row started — a fresh resolved promise silently dropped failures);
 *  - F-501: internal recovery reloads (here: play-after-natural-end) that
 *    themselves fail must surface through the store (loadError) instead of
 *    leaving a stuck spinner/paused player;
 *  - F-502: offline, next/prev resolve from the download manifest;
 *  - F-503: the row-mount prefetch is bounded (mint budget, closes F-039);
 *  - F-505: a deep-link start second past the end is clamped so it can't
 *    instantly complete the lecture;
 *  - F-507: a deep-link start second for the ALREADY-current lecture seeks
 *    forward instead of being ignored.
 *
 * The controller holds module state, so each test re-requires it fresh.
 */

const mockGetLecturePlayback = jest.fn();
const mockGetNextLecture = jest.fn();
const mockGetPreviousLecture = jest.fn();
jest.mock('@/api/lectures', () => ({
  getLecturePlayback: (...a: unknown[]) => mockGetLecturePlayback(...a),
  getNextLecture: (...a: unknown[]) => mockGetNextLecture(...a),
  getPreviousLecture: (...a: unknown[]) => mockGetPreviousLecture(...a),
}));

const mockSaveLectureProgress = jest.fn();
jest.mock('@/api/progress', () => ({
  saveLectureProgress: (...a: unknown[]) => mockSaveLectureProgress(...a),
}));

const mockIsOnlineSync = jest.fn();
jest.mock('@/lib/connectivity', () => ({
  isOnlineSync: () => mockIsOnlineSync(),
  onReconnect: jest.fn(),
}));

const mockLocalUriFor = jest.fn();
const mockReadDownloadMeta = jest.fn();
const mockFindDownloadedNeighbor = jest.fn();
jest.mock('@/lib/downloads', () => ({
  localUriFor: (...a: unknown[]) => mockLocalUriFor(...a),
  readDownloadMeta: (...a: unknown[]) => mockReadDownloadMeta(...a),
  updateDownloadPosition: jest.fn(),
  findDownloadedNeighbor: (...a: unknown[]) => mockFindDownloadedNeighbor(...a),
}));

jest.mock('@/lib/resumeCache', () => ({
  readResumePosition: jest.fn(() => null),
  saveResumePosition: jest.fn(),
}));

jest.mock('expo-linking', () => ({ createURL: (p: string) => `riwaq://${p}` }));

// Minimal fake expo-audio player; the created instances are collected so tests
// can drive playbackStatusUpdate ticks and inspect seeks.
type FakePlayer = {
  playing: boolean;
  currentTime: number;
  duration: number;
  seeks: number[];
  statusCb: ((s: Record<string, unknown>) => void) | null;
  play: () => void;
  pause: () => void;
  seekTo: (sec: number) => Promise<void>;
  replace: (src: unknown) => void;
  remove: () => void;
  setPlaybackRate: (r: number) => void;
  setActiveForLockScreen: (...a: unknown[]) => void;
  addListener: (name: string, cb: (s: Record<string, unknown>) => void) => void;
};
const mockPlayers: FakePlayer[] = [];
jest.mock('expo-audio', () => ({
  setAudioModeAsync: async () => {},
  createAudioPlayer: () => {
    const p: FakePlayer = {
      playing: false,
      currentTime: 0,
      duration: 0,
      seeks: [],
      statusCb: null,
      play: () => {
        p.playing = true;
      },
      pause: () => {
        p.playing = false;
      },
      seekTo: async (sec: number) => {
        p.seeks.push(sec);
        p.currentTime = sec;
      },
      replace: () => {},
      remove: () => {},
      setPlaybackRate: () => {},
      setActiveForLockScreen: () => {},
      addListener: (name, cb) => {
        if (name === 'playbackStatusUpdate') p.statusCb = cb;
      },
    };
    mockPlayers.push(p);
    return p;
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

const playback = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: 'درس',
  sheikhName: 'الشيخ',
  eyebrow: '',
  sectionTitle: 'قسم',
  sectionId: 'sec-1',
  order: 1,
  durationSec: 100,
  audioUrl: `https://cdn/${id}.mp3`,
  positionSec: 0,
  attachments: [],
  ...over,
});

/* eslint-disable @typescript-eslint/no-require-imports */
// Each test gets a fresh module graph (the controller holds module state); the
// created QueryClients are collected and cleared so their long gc timers can't
// keep the Jest process alive after the run.
const createdClients: { clear: () => void }[] = [];
function fresh() {
  jest.resetModules();
  mockPlayers.length = 0;
  const controller = require('../audioController') as typeof import('../audioController');
  const { usePlayerStore } = require('@/stores/playerStore') as typeof import('@/stores/playerStore');
  const { queryClient } = require('@/lib/queryClient') as typeof import('@/lib/queryClient');
  const { queryKeys } = require('@/constants/queryKeys') as typeof import('@/constants/queryKeys');
  createdClients.push(queryClient);
  return { controller, usePlayerStore, queryClient, queryKeys };
}
/* eslint-enable @typescript-eslint/no-require-imports */

afterEach(() => {
  for (const c of createdClients) c.clear();
  createdClients.length = 0;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOnlineSync.mockReturnValue(true);
  mockLocalUriFor.mockReturnValue(null);
  mockReadDownloadMeta.mockReturnValue(null);
  mockFindDownloadedNeighbor.mockReturnValue(null);
  mockGetNextLecture.mockResolvedValue(null);
  mockGetPreviousLecture.mockResolvedValue(null);
  mockSaveLectureProgress.mockResolvedValue([]);
});

describe('F-500 — in-flight load promise is shared', () => {
  test('a redundant same-lecture preload returns the SAME promise, and both observe the failure', async () => {
    const { controller } = fresh();
    mockGetLecturePlayback.mockRejectedValue(new Error('network dead'));
    const p1 = controller.preloadLecture('L1');
    const p2 = controller.preloadLecture('L1');
    expect(p2).toBe(p1); // not a detached resolved stub
    await expect(p1).rejects.toThrow();
  }, 15000);
});

describe('F-501 — a failed internal recovery reload surfaces in the store', () => {
  test('play-after-end that cannot reload sets loadError instead of dying silently', async () => {
    const { controller, usePlayerStore } = fresh();
    mockGetLecturePlayback.mockResolvedValue(playback('L3'));
    await controller.playLecture('L3');
    await flush();
    const player = mockPlayers[0];
    expect(player).toBeDefined();

    // The track really plays, then reaches its natural end (the native player
    // stops itself, so mirror that on the fake's own playing flag too).
    player.statusCb?.({ playing: true, isLoaded: true, currentTime: 50, duration: 100 });
    player.statusCb?.({
      playing: false,
      isLoaded: true,
      didJustFinish: true,
      currentTime: 100,
      duration: 100,
    });
    player.playing = false;
    await flush();

    // Now the network is gone and the lecture isn't downloaded: tapping play
    // (the ended-state reload path) cannot rebuild the player.
    mockIsOnlineSync.mockReturnValue(false);
    controller.toggle();
    await flush();
    await flush();

    const s = usePlayerStore.getState();
    expect(s.loadError).toBeTruthy(); // retry UI + reconnect recovery can engage
    expect(s.isLoading).toBe(false); // no stuck spinner
  });
});

describe('F-502 — offline neighbours resolve from the download manifest', () => {
  test('a downloaded lecture opened offline gets next/prev from the manifest', async () => {
    const { controller, usePlayerStore } = fresh();
    mockIsOnlineSync.mockReturnValue(false);
    mockLocalUriFor.mockImplementation((id: string) => (id === 'D1' ? 'file:///d1.mp3' : null));
    mockReadDownloadMeta.mockReturnValue({
      id: 'D1',
      title: 'درس محمّل',
      sheikhName: null,
      durationSec: 100,
      sectionTitle: 'قسم',
      sectionId: 'sec-9',
      order: 2,
      positionSec: 0,
    });
    mockFindDownloadedNeighbor.mockImplementation(
      (sectionId: string, order: number, dir: 'next' | 'prev') =>
        sectionId === 'sec-9' && order === 2 && dir === 'next' ? { id: 'D2' } : null,
    );
    mockGetLecturePlayback.mockRejectedValue(new Error('offline'));

    await controller.playLecture('D1');
    await flush();

    expect(usePlayerStore.getState().nextLectureId).toBe('D2');
    expect(usePlayerStore.getState().prevLectureId).toBeNull();
  });
});

describe('F-503 — row-mount prefetch is bounded (closes F-039)', () => {
  test('at most 4 playback fetches are in flight; the rest are dropped', async () => {
    const { controller } = fresh();
    // Deferred fetches: unsettled while the budget is asserted, resolved at the
    // end so react-query's fetches wind down and Jest can exit cleanly.
    const resolvers: ((v: unknown) => void)[] = [];
    mockGetLecturePlayback.mockImplementation(
      (id: string) => new Promise((resolve) => resolvers.push(() => resolve(playback(id)))),
    );
    for (let i = 0; i < 10; i++) controller.prefetchPlayback(`P${i}`);
    await flush();
    expect(mockGetLecturePlayback).toHaveBeenCalledTimes(4);
    for (const r of resolvers) r(undefined);
    await flush();
  });

  test('an already-fresh entry costs no budget and no fetch', async () => {
    const { controller, queryClient, queryKeys } = fresh();
    queryClient.setQueryData(queryKeys.lecture('WARM'), playback('WARM'));
    controller.prefetchPlayback('WARM');
    await flush();
    expect(mockGetLecturePlayback).not.toHaveBeenCalled();
  });
});

describe('F-505 — deep-link start second is clamped to the track', () => {
  test('?t= far past the end starts near the end, not AT it', async () => {
    const { controller } = fresh();
    mockGetLecturePlayback.mockResolvedValue(playback('L5', { durationSec: 100 }));
    await controller.preloadLecture('L5', { startAtSec: 99999 });
    await flush();
    const player = mockPlayers[0];
    // Clamped to duration-1 (99) — never the raw 99999 the link asked for,
    // which the native clamp would turn into an instant didJustFinish.
    expect(player.seeks).toContain(99);
    expect(player.seeks).not.toContain(99999);
  });
});

describe('F-507 — deep-link start on the already-current lecture', () => {
  test('seeks forward instead of silently ignoring the requested second', async () => {
    const { controller } = fresh();
    mockGetLecturePlayback.mockResolvedValue(playback('L7'));
    await controller.playLecture('L7');
    await flush();
    const player = mockPlayers[0];
    player.duration = 100;
    player.statusCb?.({ playing: true, isLoaded: true, currentTime: 10, duration: 100 });

    await controller.preloadLecture('L7', { startAtSec: 50 });
    await flush();
    expect(player.seeks).toContain(50);
  });
});
