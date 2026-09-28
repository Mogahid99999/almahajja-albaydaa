// ffmpeg / ffprobe process wrappers (the only module that spawns processes).

import { spawn } from 'node:child_process';
import {
  buildTranscodeArgs,
  FFPROBE_DURATION_ARGS,
  FfmpegProgressParser,
  parseFfprobeDuration,
} from './ffmpegProgress.js';
import { AbortedError } from './errors.js';

export interface TranscodeOptions {
  input: string;
  output: string;
  loudnorm: boolean;
  /** Probed input duration (seconds) used to turn out_time into a fraction. */
  durationSec: number | null;
  /** Called with 0..1 as ffmpeg advances (only when the duration is known). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface MediaTools {
  probeDuration(path: string, signal?: AbortSignal): Promise<number | null>;
  transcode(opts: TranscodeOptions): Promise<void>;
}

export interface FfmpegToolsOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  /** Run ffmpeg under `nice -n 10` so LiveKit keeps CPU priority. Default: true on Linux. */
  nice?: boolean;
  /** Grace period between SIGTERM and SIGKILL when aborting. */
  killGraceMs?: number;
}

const STDERR_TAIL_BYTES = 4096;

function tail(buf: string, chunk: string): string {
  const next = buf + chunk;
  return next.length > STDERR_TAIL_BYTES ? next.slice(-STDERR_TAIL_BYTES) : next;
}

/** Last few meaningful stderr lines — enough for `media_jobs.error` without noise. */
export function summarizeStderr(stderr: string, lines = 3): string {
  return stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-lines)
    .join(' | ');
}

export function createFfmpegTools(opts: FfmpegToolsOptions = {}): MediaTools {
  const ffmpeg = opts.ffmpegPath ?? 'ffmpeg';
  const ffprobe = opts.ffprobePath ?? 'ffprobe';
  const useNice = opts.nice ?? process.platform === 'linux';
  const killGraceMs = opts.killGraceMs ?? 5000;

  return {
    probeDuration(path, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new AbortedError());
        const child = spawn(ffprobe, [...FFPROBE_DURATION_ARGS, path], {
          stdio: ['ignore', 'pipe', 'pipe'],
          signal,
        });
        let out = '';
        child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c));
        child.stderr.resume();
        child.on('error', (err) => {
          if (signal?.aborted) reject(new AbortedError());
          else reject(new Error(`ffprobe failed to start: ${err.message}`));
        });
        // A failed probe is not fatal — ffmpeg will report a real decode error.
        child.on('close', (code) => resolve(code === 0 ? parseFfprobeDuration(out) : null));
      });
    },

    transcode(t) {
      return new Promise<void>((resolve, reject) => {
        if (t.signal?.aborted) return reject(new AbortedError());
        const args = buildTranscodeArgs({ input: t.input, output: t.output, loudnorm: t.loudnorm });
        const [cmd, argv] = useNice ? ['nice', ['-n', '10', ffmpeg, ...args]] : [ffmpeg, args];
        const child = spawn(cmd, argv as string[], { stdio: ['ignore', 'pipe', 'pipe'] });
        const parser = new FfmpegProgressParser(t.durationSec);
        let stderr = '';
        let aborted = false;
        let killTimer: ReturnType<typeof setTimeout> | null = null;

        const onAbort = () => {
          aborted = true;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
          killTimer.unref?.();
        };
        t.signal?.addEventListener('abort', onAbort, { once: true });

        child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
          for (const u of parser.feed(chunk)) {
            if (u.fraction !== null) t.onProgress?.(u.fraction);
          }
        });
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr = tail(stderr, chunk)));

        const cleanup = () => {
          t.signal?.removeEventListener('abort', onAbort);
          if (killTimer) clearTimeout(killTimer);
        };
        child.on('error', (err) => {
          cleanup();
          reject(new Error(`ffmpeg failed to start: ${err.message}`));
        });
        child.on('close', (code, sig) => {
          cleanup();
          if (aborted) return reject(new AbortedError('ffmpeg killed (shutdown)'));
          if (code === 0) return resolve();
          const why = sig ? `signal ${sig}` : `code ${code}`;
          reject(new Error(`ffmpeg exited with ${why}: ${summarizeStderr(stderr) || 'no output'}`));
        });
      });
    },
  };
}
