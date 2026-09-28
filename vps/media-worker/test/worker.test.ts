import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaJob } from '../src/db.js';
import { DEFAULT_MAX_DEFER_MS, EgressTracker } from '../src/egressTracker.js';
import type { JobOutcome } from '../src/jobRunner.js';
import type { LogLevel } from '../src/log.js';
import { Worker } from '../src/worker.js';
import { FakeDb, makeJob } from './fakes.js';

let db: FakeDb;
let egress: EgressTracker;
let ran: MediaJob[];
let events: string[];
let worker: Worker;

const make = (runJob?: (job: MediaJob, signal: AbortSignal) => Promise<JobOutcome>) =>
  new Worker({
    db,
    egress,
    pollIntervalMs: 5000,
    log: (_l: LogLevel, e: string) => void events.push(e),
    runJob:
      runJob ??
      (async (job) => {
        ran.push(job);
        return { status: 'done', outputKey: 'k', durationSec: 1, sizeBytes: 1 };
      }),
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T18:00:00Z'));
  db = new FakeDb();
  egress = new EgressTracker(DEFAULT_MAX_DEFER_MS, () => Date.now());
  ran = [];
  events = [];
});

afterEach(async () => {
  await worker?.stop();
  vi.useRealTimers();
});

describe('claim loop', () => {
  it('claims and runs a job, then drains the queue immediately', async () => {
    db.queue.push(makeJob({ id: 'a' }), makeJob({ id: 'b' }));
    worker = make();
    expect(await worker.tick()).toBe('ran');
    await vi.advanceTimersByTimeAsync(0); // re-ticks at once after a job
    await vi.advanceTimersByTimeAsync(0);
    expect(ran.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('polls every 5 s when idle', async () => {
    worker = make();
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.calls.filter((c) => c === 'claim')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(db.calls.filter((c) => c === 'claim')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(db.calls.filter((c) => c === 'claim')).toHaveLength(2);
  });

  it('kick() claims right away instead of waiting for the next poll', async () => {
    worker = make();
    await worker.tick(); // idle → next poll in 5 s
    db.queue.push(makeJob({ id: 'fresh' }));
    worker.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(ran.map((j) => j.id)).toEqual(['fresh']);
  });

  it('runs ONE job at a time', async () => {
    let release!: () => void;
    db.queue.push(makeJob({ id: 'slow' }), makeJob({ id: 'next' }));
    worker = make(async (job) => {
      ran.push(job);
      if (job.id === 'slow') await new Promise<void>((r) => (release = r));
      return { status: 'done', outputKey: 'k', durationSec: 1, sizeBytes: 1 };
    });
    const first = worker.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.busy).toBe(true);
    expect(await worker.tick()).toBe('busy');
    worker.kick();
    expect(db.calls.filter((c) => c === 'claim')).toHaveLength(1);
    release();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(ran.map((j) => j.id)).toEqual(['slow', 'next']);
  });

  it('a claim RPC error is logged and retried on the next poll', async () => {
    db.claimJob = async () => {
      throw new Error('claim_media_job failed: timeout');
    };
    worker = make();
    expect(await worker.tick()).toBe('error');
    expect(events).toContain('claim.error');
  });

  it('stop() aborts the running job (ffmpeg kill) and stops claiming', async () => {
    let seen: AbortSignal | null = null;
    db.queue.push(makeJob());
    worker = make(
      (_job, signal) =>
        new Promise((resolve) => {
          seen = signal;
          signal.addEventListener('abort', () => resolve({ status: 'aborted' }));
        }),
    );
    void worker.tick();
    await vi.advanceTimersByTimeAsync(0);
    await worker.stop();
    expect(seen!.aborted).toBe(true);
    expect(worker.healthy).toBe(false);
    expect(await worker.tick()).toBe('stopped');
  });
});

describe('deferral while a LiveKit egress is recording', () => {
  it('claims ONLY live recordings while an egress is active; transcodes wait, then resume', async () => {
    db.queue.push(makeJob({ id: 'upload' }), makeJob({ id: 'live', kind: 'live_recording', lecture_id: null }));
    worker = make();
    egress.started('EG_1', 'stg_room1');

    expect(await worker.tick()).toBe('ran'); // the live recording still processes
    expect(await worker.tick()).toBe('idle'); // the transcode waits
    expect(ran.map((j) => j.id)).toEqual(['live']);
    expect(db.claimKinds).toEqual([['live_recording'], ['live_recording']]);
    expect(worker.egressActive).toBe(true);
    expect(events.filter((e) => e === 'claim.transcodes_deferred')).toHaveLength(1); // logged once, not per poll

    egress.ended('EG_1');
    expect(await worker.tick()).toBe('ran');
    expect(ran.map((j) => j.id)).toEqual(['live', 'upload']);
    expect(db.claimKinds.at(-1)).toBeNull(); // {} → all kinds
    expect(events).toContain('claim.resumed');
  });

  it('with no egress it claims all kinds ({} → p_kinds null)', async () => {
    worker = make();
    await worker.tick();
    expect(db.claimKinds).toEqual([null]);
  });

  it('caps the deferral (lost egress_ended cannot block transcodes forever)', async () => {
    db.queue.push(makeJob({ id: 'upload' }));
    worker = make();
    egress.started('EG_lost', 'stg_room1');
    expect(await worker.tick()).toBe('idle');

    vi.setSystemTime(Date.now() + DEFAULT_MAX_DEFER_MS + 1);
    expect(await worker.tick()).toBe('ran');
    expect(events).toContain('egress.defer_expired');
  });

  it('room_finished clears that room’s egresses', () => {
    egress.started('EG_1', 'stg_a');
    egress.started('EG_2', 'stg_b');
    egress.roomFinished('stg_a');
    expect(egress.count).toBe(1);
  });

  it('duplicate egress_started keeps the original start time', () => {
    egress.started('EG_1', 'stg_a');
    vi.setSystemTime(Date.now() + DEFAULT_MAX_DEFER_MS - 1000);
    egress.started('EG_1', 'stg_a'); // e.g. egress_updated re-arm
    vi.setSystemTime(Date.now() + 2000);
    expect(egress.isActive()).toBe(false);
  });
});
