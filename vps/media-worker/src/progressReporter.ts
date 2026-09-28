// Throttled progress + heartbeat writer for one running job.
//
// - `report(p)` records the latest overall progress (monotonic) and writes it at
//   most once per `minIntervalMs` (default 1 s).
// - A keep-alive timer re-writes the last value whenever nothing was written
//   for `heartbeatMs` (default 30 s), so long silent phases (a 2 GB download,
//   the upload) never look like a dead worker to `claim_media_job()`'s 2-minute
//   stale-heartbeat re-claim.
// Write failures are logged and swallowed: progress is best-effort.
// A write that resolves `false` (touch_media_job: job no longer running) means
// the job is not ours any more → `onLost` fires once and writing stops.

import { clamp01, Throttle } from './ffmpegProgress.js';
import { errorMessage, type Logger, silentLogger } from './log.js';

export interface ProgressReporterOptions {
  minIntervalMs?: number;
  heartbeatMs?: number;
  checkEveryMs?: number;
  now?: () => number;
  log?: Logger;
  /** Called once when a write reports the job is no longer running. */
  onLost?: () => void;
}

export class ProgressReporter {
  private latest = 0;
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lostFlag = false;
  private readonly throttle: Throttle;
  private readonly heartbeatMs: number;
  private readonly checkEveryMs: number;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly onLost: (() => void) | undefined;
  /** Number of writes attempted (observable in tests). */
  writes = 0;

  constructor(
    private readonly write: (progress: number) => Promise<boolean | void>,
    opts: ProgressReporterOptions = {},
  ) {
    this.throttle = new Throttle(opts.minIntervalMs ?? 1000);
    this.heartbeatMs = opts.heartbeatMs ?? 30_000;
    this.checkEveryMs = opts.checkEveryMs ?? 10_000;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? silentLogger;
    this.onLost = opts.onLost;
  }

  /** True once the DB said the job is no longer running. */
  get lost(): boolean {
    return this.lostFlag;
  }

  get value(): number {
    return this.latest;
  }

  start(): void {
    if (this.timer) return;
    // Arm the throttle so the first heartbeat is measured from job start
    // (claim_media_job already stamped heartbeat_at).
    this.throttle.tryPass(this.now());
    this.timer = setInterval(() => this.heartbeat(), this.checkEveryMs);
    this.timer.unref?.();
  }

  report(progress: number): void {
    const p = clamp01(progress);
    if (p > this.latest) this.latest = p;
    if (this.inflight || this.lostFlag) return;
    if (this.throttle.tryPass(this.now())) this.flush();
  }

  /** Keep-alive: write the last value if nothing was written for `heartbeatMs`. */
  heartbeat(): void {
    if (this.inflight || this.lostFlag) return;
    if (this.throttle.msSinceLast(this.now()) >= this.heartbeatMs && this.throttle.tryPass(this.now())) {
      this.flush();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.inflight) await this.inflight;
  }

  private flush(): void {
    const p = this.latest;
    this.writes++;
    this.inflight = this.write(p)
      .then((stillOurs) => {
        if (stillOurs === false && !this.lostFlag) {
          this.lostFlag = true;
          if (this.timer) clearInterval(this.timer);
          this.timer = null;
          this.onLost?.();
        }
      })
      .catch((err: unknown) => this.log('warn', 'job.progress_write_failed', { error: errorMessage(err, 200) }))
      .finally(() => {
        this.inflight = null;
      });
  }
}
