import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressReporter } from '../src/progressReporter.js';

describe('ProgressReporter (≤ 1 DB write/s + heartbeat)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throttles a burst of ffmpeg progress lines to one write per second', async () => {
    const written: number[] = [];
    const r = new ProgressReporter(async (p) => void written.push(p), { now: Date.now });
    r.start(); // arms the throttle at t=0 (claim already stamped heartbeat_at)

    for (let i = 1; i <= 50; i++) {
      vi.advanceTimersByTime(10); // 50 lines in 500 ms
      r.report(i / 100);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([]); // still inside the first second

    vi.advanceTimersByTime(500);
    r.report(0.6);
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([0.6]);

    r.report(0.61);
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([0.6]);
    await r.stop();
  });

  it('never goes backwards and clamps to 0..1', async () => {
    const written: number[] = [];
    const r = new ProgressReporter(async (p) => void written.push(p), { now: Date.now, minIntervalMs: 0 });
    r.report(0.5);
    await vi.advanceTimersByTimeAsync(0);
    r.report(0.2);
    await vi.advanceTimersByTimeAsync(0);
    r.report(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([0.5, 0.5, 1]);
    await r.stop();
  });

  it('writes a heartbeat after 30 s of silence (long download/upload)', async () => {
    const written: number[] = [];
    const r = new ProgressReporter(async (p) => void written.push(p), { now: Date.now });
    r.start();
    r.report(0.02);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(written).toEqual([]);
    await vi.advanceTimersByTimeAsync(20_000); // check at 30 s → silent ≥ 30 s
    expect(written).toEqual([0.02]);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(written.length).toBe(2);
    await r.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(written.length).toBe(2); // stopped → no more heartbeats
  });

  it('skips while a write is in flight and swallows write errors', async () => {
    let calls = 0;
    const r = new ProgressReporter(
      () => {
        calls++;
        return Promise.reject(new Error('network down'));
      },
      { now: Date.now, minIntervalMs: 0, log: () => {} },
    );
    r.report(0.1);
    r.report(0.2); // in flight → skipped
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    r.report(0.3);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    await expect(r.stop()).resolves.toBeUndefined();
  });

  it('write → false (touch_media_job: not running) fires onLost once and stops all writes', async () => {
    let calls = 0;
    let lostCalls = 0;
    const r = new ProgressReporter(
      async () => {
        calls++;
        return false;
      },
      { now: Date.now, minIntervalMs: 0, onLost: () => void lostCalls++ },
    );
    r.start();
    r.report(0.1);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.lost).toBe(true);
    expect(lostCalls).toBe(1);
    r.report(0.5);
    await vi.advanceTimersByTimeAsync(120_000); // no heartbeats either
    expect(calls).toBe(1);
    expect(lostCalls).toBe(1);
    await r.stop();
  });
});
