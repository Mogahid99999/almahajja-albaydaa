// The claim loop: ONE job at a time, `claim_media_job()` every 5 s and right
// after a relevant webhook (`kick()`); immediately again after a job finishes
// (drain the queue). While a LiveKit egress is recording for this env, only
// `live_recording` jobs are claimed (`p_kinds`); lecture transcodes wait so the
// live session keeps the CPU (capped by EgressTracker's max age).

import type { JobDb, MediaJob, MediaJobKind } from './db.js';
import type { EgressTracker } from './egressTracker.js';
import type { JobOutcome } from './jobRunner.js';
import { errorMessage, type Logger, silentLogger } from './log.js';

export type TickResult = 'ran' | 'idle' | 'busy' | 'stopped' | 'error';

/** Kinds still claimed while an egress is recording. */
export const KINDS_DURING_EGRESS: MediaJobKind[] = ['live_recording'];

export interface WorkerDeps {
  db: Pick<JobDb, 'claimJob'>;
  runJob: (job: MediaJob, signal: AbortSignal) => Promise<JobOutcome>;
  egress: EgressTracker;
  pollIntervalMs?: number;
  log?: Logger;
  now?: () => number;
}

export class Worker {
  private busyFlag = false;
  private stopping = false;
  private deferring = false;
  private pendingKick = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: Promise<TickResult> | null = null;
  private readonly abort = new AbortController();
  private readonly pollIntervalMs: number;
  private readonly log: Logger;
  private readonly now: () => number;
  private lastTickAt: number;

  constructor(private readonly deps: WorkerDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 5000;
    this.log = deps.log ?? silentLogger;
    this.now = deps.now ?? Date.now;
    this.lastTickAt = this.now();
  }

  get busy(): boolean {
    return this.busyFlag;
  }

  get egressActive(): boolean {
    return this.deps.egress.count > 0;
  }

  /** Healthy unless shutting down or the loop has silently stopped ticking. */
  get healthy(): boolean {
    if (this.stopping) return false;
    return this.busyFlag || this.now() - this.lastTickAt < Math.max(60_000, this.pollIntervalMs * 6);
  }

  start(): void {
    this.schedule(0);
  }

  /** Claim now (webhook-driven). Coalesces with an in-flight tick. */
  kick(): void {
    if (this.stopping) return;
    if (this.busyFlag) this.pendingKick = true;
    else this.schedule(0);
  }

  async tick(): Promise<TickResult> {
    if (this.stopping) return 'stopped';
    if (this.busyFlag) {
      this.pendingKick = true;
      return 'busy';
    }
    this.busyFlag = true;
    this.pendingKick = false;
    this.lastTickAt = this.now();
    let result: TickResult;
    try {
      this.current = this.claimAndRun();
      result = await this.current;
    } catch (err) {
      this.log('error', 'claim.error', { error: errorMessage(err, 300) });
      result = 'error';
    } finally {
      this.current = null;
      this.busyFlag = false;
      this.lastTickAt = this.now();
    }
    if (!this.stopping) {
      const again = result === 'ran' || this.pendingKick;
      this.schedule(again ? 0 : this.pollIntervalMs);
    }
    return result;
  }

  /** SIGTERM: stop claiming, kill ffmpeg, wait for the job to unwind (it stays `running`). */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort.abort();
    if (this.current) await this.current.catch(() => undefined);
  }

  private async claimAndRun(): Promise<TickResult> {
    for (const id of this.deps.egress.prune()) {
      this.log('warn', 'egress.defer_expired', { egress: id, note: 'no egress_ended within cap; resuming claims' });
    }
    const egressActive = this.deps.egress.count > 0;
    if (egressActive !== this.deferring) {
      this.deferring = egressActive;
      if (egressActive) {
        this.log('info', 'claim.transcodes_deferred', { reason: 'egress_active', egresses: this.deps.egress.count });
      } else {
        this.log('info', 'claim.resumed');
      }
    }

    const job = await this.deps.db.claimJob(egressActive ? KINDS_DURING_EGRESS : null);
    if (!job) return 'idle';
    await this.deps.runJob(job, this.abort.signal);
    return 'ran';
  }

  private schedule(ms: number): void {
    if (this.stopping) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, ms);
  }
}
