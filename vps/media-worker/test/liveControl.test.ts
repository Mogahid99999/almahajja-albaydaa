import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostAbsenceWatch } from '../src/hostWatch.js';
import { createLiveControl, type LiveControl } from '../src/liveControl.js';

describe('createLiveControl (auto_end via the live-control edge function)', () => {
  it('POSTs {action:auto_end, sessionId, reason} with the service-role bearer', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const lc = createLiveControl('https://ref.supabase.co/', 'SR-KEY', fetchMock as unknown as typeof fetch);
    await lc.autoEnd('sess-1', 'host_absent');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ref.supabase.co/functions/v1/live-control');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer SR-KEY', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ action: 'auto_end', sessionId: 'sess-1', reason: 'host_absent' });
  });

  it('non-2xx → throws with the status (and never the key)', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"not_live"}', { status: 409 }));
    const lc = createLiveControl('https://ref.supabase.co', 'SR-KEY', fetchMock as unknown as typeof fetch);
    const err = await lc.autoEnd('sess-1', 'room_finished').catch((e: Error) => e);
    expect(String(err)).toContain('HTTP 409');
    expect(String(err)).not.toContain('SR-KEY');
  });
});

describe('createLiveControl — resume_recording (0146)', () => {
  const lcWith = (res: Response) => {
    const fetchMock = vi.fn(async () => res);
    return { fetchMock, lc: createLiveControl('https://ref.supabase.co', 'SR-KEY', fetchMock as unknown as typeof fetch) };
  };

  it('POSTs {action:resume_recording, sessionId, reason} with the service-role bearer → resumed', async () => {
    const { fetchMock, lc } = lcWith(new Response('{"ok":true,"status":"live","egressId":"EG_new2","seq":2}', { status: 200 }));
    expect(await lc.resumeRecording('sess-1', 'egress_failed')).toEqual({ status: 'resumed', egressId: 'EG_new2', seq: 2 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer SR-KEY' });
    expect(JSON.parse(String(init.body))).toEqual({ action: 'resume_recording', sessionId: 'sess-1', reason: 'egress_failed' });
  });

  it('409 / 404 → refused (nothing to resume), never thrown', async () => {
    for (const status of [409, 404]) {
      const { lc } = lcWith(new Response('{"error":"invalid_state","detail":"room_gone"}', { status }));
      expect(await lc.resumeRecording('sess-1', 'egress_ended')).toMatchObject({ status: 'refused', httpStatus: status });
    }
  });

  it('5xx / 403 → throws with the status (never the key)', async () => {
    for (const status of [502, 403]) {
      const { lc } = lcWith(new Response('{"error":"livekit_error"}', { status }));
      const err = await lc.resumeRecording('sess-1', 'egress_failed').catch((e: Error) => e);
      expect(String(err)).toContain(`HTTP ${status}`);
      expect(String(err)).not.toContain('SR-KEY');
    }
  });
});

describe('HostAbsenceWatch', () => {
  let calls: Array<[string, string]>;
  let control: Pick<LiveControl, 'autoEnd'>;
  let watch: HostAbsenceWatch;
  const live = { sessionId: 's1', status: 'live', isHost: true, hostPresent: false };

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    control = { autoEnd: async (s, r) => void calls.push([s, r]) };
    watch = new HostAbsenceWatch(control);
  });
  afterEach(() => {
    watch.stop();
    vi.useRealTimers();
  });

  it('defaults to a 10-minute grace and keeps the ORIGINAL deadline on repeated host-left events', async () => {
    watch.onRoomEvent('participant_left', live);
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    watch.onRoomEvent('participant_left', live); // second device of the host leaves
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(calls).toEqual([['s1', 'host_absent']]);
  });

  it('host still present on another device → no timer', () => {
    watch.onRoomEvent('participant_left', { ...live, hostPresent: true });
    expect(watch.pending).toBe(0);
  });

  it('session no longer live (ended by staff) → pending timer cancelled', async () => {
    watch.onRoomEvent('participant_left', live);
    watch.onRoomEvent('participant_joined', { ...live, status: 'ended', isHost: false });
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    expect(calls).toEqual([]);
  });

  it('timers are per session', async () => {
    watch.onRoomEvent('participant_left', live);
    watch.onRoomEvent('participant_left', { ...live, sessionId: 's2' });
    watch.onRoomEvent('participant_joined', { ...live, sessionId: 's2', hostPresent: true });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(calls).toEqual([['s1', 'host_absent']]);
  });

  it('a failing auto_end is logged, not thrown', async () => {
    const events: string[] = [];
    const w = new HostAbsenceWatch(
      { autoEnd: async () => Promise.reject(new Error('HTTP 500')) },
      { log: (_l, e) => void events.push(e) },
    );
    await w.onRoomEvent('room_finished', live);
    expect(events).toContain('live.auto_end_failed');
    w.stop();
  });

  it('null result (room without a session) and stop() are no-ops', async () => {
    expect(watch.onRoomEvent('participant_left', null)).toBeUndefined();
    watch.onRoomEvent('participant_left', live);
    watch.stop();
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(calls).toEqual([]);
  });
});
