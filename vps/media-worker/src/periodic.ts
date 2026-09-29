// A background task that runs once shortly after start and then on a fixed
// interval, never overlapping itself. Errors are logged, never thrown.
// Logs `<name>.done <fields…>` / `<name>.error error=…` (one line per run).

import { errorMessage, type LogFields, type Logger, silentLogger } from './log.js';

export interface PeriodicOptions<S> {
  name: string;
  firstDelayMs: number;
  everyMs: number;
  /** Stats → log fields (counts only — never paths or secrets). */
  fields: (stats: S) => LogFields;
  /** true → no `.done` line for this run (a frequent task with nothing to report). */
  quiet?: (stats: S) => boolean;
  log?: Logger;
}

export class PeriodicTask<S> {
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private readonly abort = new AbortController();
  private readonly log: Logger;

  constructor(
    private readonly task: (signal: AbortSignal) => Promise<S>,
    private readonly opts: PeriodicOptions<S>,
  ) {
    this.log = opts.log ?? silentLogger;
  }

  start(): void {
    this.firstTimer = setTimeout(() => void this.runOnce(), this.opts.firstDelayMs);
    this.interval = setInterval(() => void this.runOnce(), this.opts.everyMs);
    this.firstTimer.unref?.();
    this.interval.unref?.();
  }

  runOnce(): Promise<void> {
    if (this.running || this.abort.signal.aborted) return this.running ?? Promise.resolve();
    const started = Date.now();
    this.running = this.task(this.abort.signal)
      .then((s) => {
        if (this.opts.quiet?.(s)) return;
        this.log('info', `${this.opts.name}.done`, { ...this.opts.fields(s), ms: Date.now() - started });
      })
      .catch((err: unknown) => this.log('error', `${this.opts.name}.error`, { error: errorMessage(err, 200) }))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async stop(): Promise<void> {
    this.abort.abort();
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.interval) clearInterval(this.interval);
    this.firstTimer = this.interval = null;
    if (this.running) await this.running;
  }
}
