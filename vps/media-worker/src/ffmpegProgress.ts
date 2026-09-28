// Pure helpers around ffmpeg/ffprobe text output — no I/O, fully unit-tested.

/**
 * The speech profile used for every lecture since V13 (was in-browser
 * ffmpeg.wasm): mono 22.05 kHz VBR MP3 at LAME quality 9. `loudnorm` is only
 * applied to live recordings when LIVE_LOUDNORM=1 (A/B decision pending, §6).
 */
export function buildTranscodeArgs(opts: { input: string; output: string; loudnorm?: boolean }): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-y',
    '-i', opts.input,
    '-vn',
    '-codec:a', 'libmp3lame',
    '-q:a', '9',
    '-ac', '1',
    '-ar', '22050',
    ...(opts.loudnorm ? ['-af', 'loudnorm=I=-18:TP=-2'] : []),
    '-progress', 'pipe:1',
    opts.output,
  ];
}

export const FFPROBE_DURATION_ARGS = [
  '-v', 'error',
  '-show_entries', 'format=duration',
  '-of', 'default=noprint_wrappers=1:nokey=1',
];

/** ffprobe `format=duration` output → seconds, or null for `N/A` / garbage / ≤ 0. */
export function parseFfprobeDuration(stdout: string): number | null {
  for (const line of stdout.split(/\r?\n/)) {
    const v = line.trim();
    if (!v || v === 'N/A') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export interface ProgressUpdate {
  /** Encoded output position in seconds, or null when ffmpeg reported N/A. */
  outTimeSec: number | null;
  /** 0..1 against the probed duration; null when unknown (no duration or N/A). */
  fraction: number | null;
  /** True on the final `progress=end` block. */
  done: boolean;
}

/**
 * Incremental parser for `ffmpeg -progress pipe:1` output. ffmpeg prints
 * `key=value` lines in blocks terminated by `progress=continue|end`. Chunks can
 * split lines anywhere, so partial lines are buffered.
 *
 * Note: despite its name `out_time_ms` is in MICROseconds (long-standing ffmpeg
 * quirk, identical to `out_time_us`); `out_time_us` is preferred when present.
 */
export class FfmpegProgressParser {
  private buffer = '';
  private outTimeUs: number | null = null;
  private sawUs = false;

  constructor(private readonly durationSec: number | null) {}

  feed(chunk: string): ProgressUpdate[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    const updates: ProgressUpdate[] = [];
    for (const line of lines) {
      const u = this.line(line);
      if (u) updates.push(u);
    }
    return updates;
  }

  private line(raw: string): ProgressUpdate | null {
    const eq = raw.indexOf('=');
    if (eq <= 0) return null;
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    switch (key) {
      case 'out_time_us':
        this.sawUs = true;
        this.outTimeUs = parseMicros(value);
        return null;
      case 'out_time_ms':
        if (!this.sawUs) this.outTimeUs = parseMicros(value);
        return null;
      case 'progress': {
        const done = value === 'end';
        const outTimeSec = this.outTimeUs === null ? null : this.outTimeUs / 1e6;
        let fraction: number | null = null;
        if (done) fraction = 1;
        else if (outTimeSec !== null && this.durationSec && this.durationSec > 0) {
          fraction = clamp01(outTimeSec / this.durationSec);
        }
        this.sawUs = false;
        return { outTimeSec, fraction, done };
      }
      default:
        return null;
    }
  }
}

function parseMicros(value: string): number | null {
  if (!value || value === 'N/A') return null;
  const n = Number(value);
  // ffmpeg can print a negative out_time for the first block of some inputs.
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Overall job progress: each phase owns a slice of 0..1 so the admin's bar only
 * ever moves forward. 1.0 is reserved for the completion RPC.
 */
export const PHASES = {
  download: [0, 0.05],
  transcode: [0.05, 0.95],
  upload: [0.95, 0.99],
} as const satisfies Record<string, readonly [number, number]>;

export type Phase = keyof typeof PHASES;

export function phaseProgress(phase: Phase, fraction: number): number {
  const [from, to] = PHASES[phase];
  return from + (to - from) * clamp01(fraction);
}

/** Minimum-interval gate (≤ 1 DB write per `intervalMs`). Clock injected for tests. */
export class Throttle {
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs: number) {}

  /** True (and arms the gate) when at least `intervalMs` elapsed since the last pass. */
  tryPass(nowMs: number): boolean {
    if (nowMs - this.last < this.intervalMs) return false;
    this.last = nowMs;
    return true;
  }

  msSinceLast(nowMs: number): number {
    return nowMs - this.last;
  }
}
