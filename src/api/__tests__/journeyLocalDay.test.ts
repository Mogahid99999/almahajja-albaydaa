/**
 * src/api/journey.ts › rpcWithLocalToday — the F-043/F-049 transitional shim.
 * Day-anchored journey reads must pass the DEVICE-LOCAL day (p_today) when
 * migration 0090 is applied, and fall back to the zero-arg pre-0090 signature
 * on PGRST202 (function not found) — memoizing that probe for the session.
 * If this shim regresses, streak day-attribution silently reverts to
 * server-UTC days (F-043 resurrected).
 */
import { localDay } from '@/lib/outboxQueue';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

type JourneyModule = typeof import('../journey');
const freshJourney = (): JourneyModule => {
  let mod: JourneyModule;
  jest.isolateModules(() => {
    mod = require('../journey') as JourneyModule;
  });
  return mod!;
};

beforeEach(() => mockRpc.mockReset());

const ok = (data: unknown) => Promise.resolve({ data, error: null });
const err = (code: string) => Promise.resolve({ data: null, error: { code, message: code } });

describe('post-0090 path (p_today supported)', () => {
  test('passes the device-local day and returns the data', async () => {
    mockRpc.mockImplementation(() => ok([{ current_streak: 4 }]));
    const journey = freshJourney();
    const out = await journey.rpcWithLocalToday('get_streak_status');
    expect(mockRpc).toHaveBeenCalledWith('get_streak_status', { p_today: localDay() });
    expect(out).toEqual([{ current_streak: 4 }]);
  });

  test('memoizes success — subsequent reads never re-probe with the fallback', async () => {
    mockRpc.mockImplementation(() => ok([]));
    const journey = freshJourney();
    await journey.rpcWithLocalToday('get_journey_summary');
    await journey.rpcWithLocalToday('get_streak_status');
    expect(mockRpc).toHaveBeenCalledTimes(2);
    for (const call of mockRpc.mock.calls) expect(call[1]).toEqual({ p_today: localDay() });
  });
});

describe('pre-0090 fallback (PGRST202)', () => {
  test('falls back to the zero-arg signature and remembers for the session', async () => {
    mockRpc.mockImplementation((_fn: unknown, args?: unknown) =>
      args ? err('PGRST202') : ok([{ current_streak: 2 }]),
    );
    const journey = freshJourney();
    const out = await journey.rpcWithLocalToday('get_streak_status');
    expect(out).toEqual([{ current_streak: 2 }]);
    // Second read: no wasted p_today probe.
    await journey.rpcWithLocalToday('get_journey_summary');
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockRpc.mock.calls[2]).toEqual(['get_journey_summary']);
  });
});

describe('real errors are not swallowed by the fallback', () => {
  test('a non-PGRST202 error throws instead of silently retrying without p_today', async () => {
    mockRpc.mockImplementation(() => err('42501')); // e.g. an RLS refusal
    const journey = freshJourney();
    await expect(journey.rpcWithLocalToday('get_streak_status')).rejects.toMatchObject({
      code: '42501',
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

describe('read mappers built on the shim', () => {
  test('getStreakStatus maps row fields and null-guards an empty result', async () => {
    mockRpc.mockImplementation(() =>
      ok([{ current_streak: 3, today_counted: true, recovery_available: false, recovery_days_left: 0 }]),
    );
    const journey = freshJourney();
    expect(await journey.getStreakStatus()).toEqual({
      current: 3,
      todayCounted: true,
      recoveryAvailable: false,
      recoveryDaysLeft: 0,
    });

    mockRpc.mockImplementation(() => ok([]));
    expect(await freshJourney().getStreakStatus()).toEqual({
      current: 0,
      todayCounted: false,
      recoveryAvailable: false,
      recoveryDaysLeft: 0,
    });
  });

  test('getJourneySummary defaults a missing row to the calm zero-state', async () => {
    mockRpc.mockImplementation(() => ok(null));
    const journey = freshJourney();
    expect(await journey.getJourneySummary()).toEqual({
      completedLectures: 0,
      totalSeconds: 0,
      streak: { current: 0, longest: 0 },
      activeDays: 0,
      week: { metric: 'lectures', target: 3, current: 0 },
    });
  });
});
