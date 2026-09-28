// Runs ONE claimed media job end to end. All I/O is injected (db, storage,
// media) so the state machine is unit-testable with fakes.
//
//   download input → ffprobe → ffmpeg (progress) → name + upload MP3 → RPC
//   lecture_transcode: complete_lecture_transcode, then delete the incoming/ original
//   live_recording (P2 — RPC pending): create_live_lecture; raw kept (D5 retention)
//
// Any error → fail_media_job (the RPC decides retry vs terminal failure and
// notifies staff; 'ignored' if the job was no longer running). The input object
// is never deleted on failure. Shutdown (abort signal) kills ffmpeg and leaves
// the job `running` for re-claim. If touch_media_job reports the job is no
// longer running ("lost"), the run is aborted without calling fail.

import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FailOutcome, JobDb, MediaJob } from './db.js';
import { AbortedError } from './errors.js';
import { phaseProgress } from './ffmpegProgress.js';
import { errorMessage, type Logger, silentLogger } from './log.js';
import type { MediaTools } from './media.js';
import { ProgressReporter, type ProgressReporterOptions } from './progressReporter.js';
import { uniqueLectureKey } from './shared/lectureKey.js';
import type { Storage } from './storage.js';

/** R2 folder for live recordings until the live_sessions schema lands (P2 — pending). */
export const LIVE_FOLDER = '_live';
export const OUTPUT_CONTENT_TYPE = 'audio/mpeg';
/** Only admin-upload originals are ever deleted by the worker. */
export const DELETABLE_INPUT_PREFIX = 'incoming/';
export const MAX_ERROR_LENGTH = 500;

export interface JobRunnerDeps {
  db: JobDb;
  storage: Storage;
  media: MediaTools;
  tmpDir: string;
  liveLoudnorm: boolean;
  log?: Logger;
  reporter?: ProgressReporterOptions;
  /**
   * Watchdog: the heartbeat keeps a wedged job "alive" forever, so a job that
   * runs longer than this is aborted and failed (→ retry). Default 3 h.
   */
  maxJobMs?: number;
}

export const DEFAULT_MAX_JOB_MS = 3 * 60 * 60 * 1000;

export type JobOutcome =
  | { status: 'done'; outputKey: string; durationSec: number | null; sizeBytes: number }
  | { status: FailOutcome; error: string }
  | { status: 'aborted' }
  /** touch_media_job said the job is no longer running — not ours any more. */
  | { status: 'lost' };

function inputExt(key: string): string {
  const ext = extname(key).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

function baseName(key: string): string {
  const file = key.split('/').pop() ?? '';
  return file.replace(/\.[^.]*$/, '');
}

export async function runJob(job: MediaJob, deps: JobRunnerDeps, shutdown?: AbortSignal): Promise<JobOutcome> {
  const log = deps.log ?? silentLogger;
  const started = Date.now();
  let workDir: string | null = null;
  /** Set once uploaded and until committed — deleted again if the job is lost. */
  let uncommittedKey: string | null = null;

  // One signal for every step: fires on shutdown, watchdog expiry, or lost job.
  const jobAbort = new AbortController();
  const reporter = new ProgressReporter((p) => deps.db.touchJob(job.id, p), {
    log,
    ...deps.reporter,
    onLost: () => jobAbort.abort(),
  });
  const signal = jobAbort.signal;
  const onShutdown = () => jobAbort.abort();
  if (shutdown?.aborted) jobAbort.abort();
  shutdown?.addEventListener('abort', onShutdown, { once: true });
  const maxJobMs = deps.maxJobMs ?? DEFAULT_MAX_JOB_MS;
  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    jobAbort.abort();
  }, maxJobMs);
  watchdog.unref?.();

  log('info', 'job.start', { id: job.id, kind: job.kind, attempt: job.attempts, input: job.input_key });

  try {
    if (!job.input_key) throw new Error('job has no input_key');
    if (job.kind === 'lecture_transcode' && !job.lecture_id) throw new Error('lecture_transcode job has no lecture_id');
    if (job.kind !== 'lecture_transcode' && job.kind !== 'live_recording') {
      throw new Error(`unknown job kind: ${String(job.kind)}`);
    }

    await mkdir(deps.tmpDir, { recursive: true });
    workDir = await mkdtemp(join(deps.tmpDir, 'job-'));
    const inputPath = join(workDir, `input${inputExt(job.input_key)}`);
    const outputPath = join(workDir, 'output.mp3');
    reporter.start();

    // 1. input → temp file
    await deps.storage.downloadToFile(job.input_key, inputPath, {
      signal,
      onFraction: (f) => reporter.report(phaseProgress('download', f)),
    });
    reporter.report(phaseProgress('download', 1));
    if (signal.aborted) throw new AbortedError();

    // 2. duration + transcode
    const inputDuration = await deps.media.probeDuration(inputPath, signal);
    if (signal.aborted) throw new AbortedError();
    await deps.media.transcode({
      input: inputPath,
      output: outputPath,
      loudnorm: job.kind === 'live_recording' && deps.liveLoudnorm,
      durationSec: inputDuration,
      onProgress: (f) => reporter.report(phaseProgress('transcode', f)),
      signal,
    });
    reporter.report(phaseProgress('transcode', 1));

    const { size: sizeBytes } = await stat(outputPath);
    if (sizeBytes <= 0) throw new Error('ffmpeg produced an empty file');
    const durationSec = (await deps.media.probeDuration(outputPath, signal)) ?? inputDuration;

    // 3. name + upload — same key scheme as an in-browser upload (r2-upload-url)
    const exists = (key: string) => deps.storage.exists(key);
    let outputKey: string;
    if (job.kind === 'lecture_transcode') {
      const naming = await deps.db.getLectureNaming(job.lecture_id as string);
      outputKey = await uniqueLectureKey(naming.sectionTitle, naming.title, 'mp3', exists);
    } else {
      // P2 — pending: name after the session's section/title once live_sessions exists.
      outputKey = await uniqueLectureKey(LIVE_FOLDER, baseName(job.input_key), 'mp3', exists);
    }
    if (signal.aborted) throw new AbortedError();
    await deps.storage.uploadFile(outputKey, outputPath, OUTPUT_CONTENT_TYPE, {
      signal,
      onFraction: (f) => reporter.report(phaseProgress('upload', f)),
    });
    uncommittedKey = outputKey;

    // 4. commit. Stop the reporter first so a late progress write can't race
    //    the RPC's progress=1; never commit a job that is no longer ours. (A
    //    shutdown arriving now still commits — the RPC is quick, and it beats
    //    orphaning the uploaded MP3.)
    await reporter.stop();
    if (reporter.lost) throw new AbortedError('job no longer running');
    if (job.kind === 'lecture_transcode') {
      await deps.db.completeLectureTranscode(job.id, outputKey, durationSec, sizeBytes);
      uncommittedKey = null;
      if (job.input_key.startsWith(DELETABLE_INPUT_PREFIX)) {
        try {
          await deps.storage.delete(job.input_key);
        } catch (err) {
          // The lecture is already live on the new key; a stray original is harmless.
          log('warn', 'job.input_delete_failed', { id: job.id, input: job.input_key, error: errorMessage(err, 200) });
        }
      }
    } else {
      // P2 — RPC pending: create_live_lecture. Raw live-raw/ object is kept (D5 retention).
      const lectureId = await deps.db.createLiveLecture(job.id, outputKey, durationSec, sizeBytes);
      uncommittedKey = null;
      log('info', 'job.live_lecture_created', { id: job.id, lecture: lectureId });
    }

    log('info', 'job.done', {
      id: job.id,
      kind: job.kind,
      output: outputKey,
      duration_sec: durationSec === null ? null : Math.round(durationSec),
      size: sizeBytes,
      ms: Date.now() - started,
    });
    return { status: 'done', outputKey, durationSec, sizeBytes };
  } catch (err) {
    await reporter.stop();
    if (reporter.lost) {
      // Nothing references the MP3 we uploaded (no commit ran) → safe to remove.
      if (uncommittedKey) {
        const key = uncommittedKey;
        await deps.storage.delete(key).catch((e: unknown) =>
          log('warn', 'job.output_cleanup_failed', { id: job.id, output: key, error: errorMessage(e, 200) }),
        );
      }
      log('warn', 'job.lost', { id: job.id, note: 'no longer running in DB; not failing it' });
      return { status: 'lost' };
    }
    if (!timedOut && (signal.aborted || err instanceof AbortedError)) {
      log('warn', 'job.aborted', { id: job.id, note: 'left running for re-claim' });
      return { status: 'aborted' };
    }
    const message = timedOut
      ? `job timed out after ${Math.round(maxJobMs / 1000)} s (watchdog)`
      : errorMessage(err, MAX_ERROR_LENGTH);
    let outcome: FailOutcome = 'retry';
    try {
      outcome = await deps.db.failJob(job.id, message);
    } catch (failErr) {
      // Job stays `running`; its heartbeat goes stale and it is re-claimed.
      log('error', 'job.fail_rpc_failed', { id: job.id, error: errorMessage(failErr, 200) });
    }
    if (outcome === 'ignored') {
      log('info', 'job.fail_ignored', { id: job.id, note: 'job was no longer running', error: message });
    } else {
      log(outcome === 'failed' ? 'error' : 'warn', `job.${outcome}`, { id: job.id, kind: job.kind, error: message });
    }
    return { status: outcome, error: message };
  } finally {
    clearTimeout(watchdog);
    shutdown?.removeEventListener('abort', onShutdown);
    await reporter.stop();
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
