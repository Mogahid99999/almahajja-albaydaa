// Runs ONE claimed media job end to end. All I/O is injected (db, storage,
// media, recordings) so the state machine is unit-testable with fakes.
//
// lecture_transcode:
//   download incoming/ original → ffprobe → ffmpeg → name (lecture + section)
//   → upload MP3 → complete_lecture_transcode → delete the incoming/ original
// live_recording (P2; owner rule: a live recording must NEVER be lost):
//   read the LOCAL raw in place (must be a regular file inside RECORDINGS_DIR)
//   → ffprobe → ffmpeg (loudnorm per LIVE_LOUDNORM) → name (live_job_naming)
//   → upload MP3 → back the raw up to R2 `live-raw/<basename>` (skipped when an
//   object of the same size is already there) → create_live_lecture → (owner rule amended
//   2026-09-28) once the R2 backup is confirmed by size AND the MP3 exists in
//   R2, delete the local raw + mark_live_raw_deleted. Any doubt → keep it and
//   log `raw.keep reason=…` (rawRetention.ts retries). A delete/mark failure
//   never fails the job. The R2 backup is kept forever.
//
// Any error → fail_media_job (the RPC decides retry vs terminal failure and
// notifies staff; 'ignored' if the job was no longer running). Inputs are never
// deleted on failure. Shutdown (abort signal) kills ffmpeg and leaves the job
// `running` for re-claim. If touch_media_job reports the job is no longer
// running ("lost"), the run is aborted without calling fail.

import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FailOutcome, JobDb, MediaJob } from './db.js';
import { AbortedError } from './errors.js';
import { phaseProgress } from './ffmpegProgress.js';
import { errorMessage, type Logger, silentLogger } from './log.js';
import type { MediaTools } from './media.js';
import { ProgressReporter, type ProgressReporterOptions } from './progressReporter.js';
import type { RecordingsDir } from './recordings.js';
import { uniqueLectureKey } from './shared/lectureKey.js';
import type { Storage } from './storage.js';

export const OUTPUT_CONTENT_TYPE = 'audio/mpeg';
export const RAW_CONTENT_TYPE = 'audio/ogg';
export const RAW_BACKUP_PREFIX = 'live-raw/';
/** Only admin-upload originals are ever deleted by the worker. */
export const DELETABLE_INPUT_PREFIX = 'incoming/';
export const MAX_ERROR_LENGTH = 500;

export interface JobRunnerDeps {
  db: JobDb;
  storage: Storage;
  media: MediaTools;
  recordings: Pick<RecordingsDir, 'check' | 'delete'>;
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
  | {
      status: 'done';
      outputKey: string;
      durationSec: number | null;
      sizeBytes: number;
      rawBackupKey?: string;
      /** live only: the local raw was verified-backed-up and deleted by this run. */
      localRawDeleted?: boolean;
    }
  | { status: FailOutcome; error: string }
  | { status: 'aborted' }
  /** touch_media_job said the job is no longer running — not ours any more. */
  | { status: 'lost' };

function inputExt(key: string): string {
  const ext = extname(key).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

type LocalRaw = { path: string; size: number; name: string };

/**
 * After create_live_lecture: delete the local raw only when the R2 backup has
 * exactly its size and the MP3 is in R2. Never throws — the job already succeeded.
 */
async function releaseLocalRaw(
  deps: JobRunnerDeps,
  job: MediaJob,
  raw: LocalRaw,
  backupKey: string,
  mp3Key: string,
  log: Logger,
): Promise<boolean> {
  const keep = (reason: string, extra: Record<string, string | number> = {}) => {
    log('warn', 'raw.keep', { id: job.id, session: job.live_session_id ?? undefined, reason, ...extra });
    return false;
  };
  try {
    if (!job.live_session_id) return keep('no_session');
    const now = await deps.recordings.check(raw.path);
    if (typeof now === 'string') return keep(`local_${now}`);
    const backupSize = await deps.storage.objectSize(backupKey);
    if (backupSize === null) return keep('backup_missing');
    if (backupSize !== now.size) return keep('backup_size_mismatch', { local_bytes: now.size, backup_bytes: backupSize });
    if (!(await deps.storage.exists(mp3Key))) return keep('mp3_missing');
    if (!(await deps.recordings.delete(now.path))) return keep('revalidation_failed');
  } catch (err) {
    return keep('error', { error: errorMessage(err, 200) });
  }
  try {
    await deps.db.markLiveRawDeleted(job.live_session_id);
    log('info', 'raw.deleted', { id: job.id, session: job.live_session_id, bytes: raw.size, backup: backupKey });
  } catch (err) {
    // File is gone, backup verified; the sweep stamps it (local missing + backup present).
    log('error', 'raw.mark_failed', { id: job.id, session: job.live_session_id, error: errorMessage(err, 200) });
  }
  return true;
}

export async function runJob(job: MediaJob, deps: JobRunnerDeps, shutdown?: AbortSignal): Promise<JobOutcome> {
  const log = deps.log ?? silentLogger;
  const started = Date.now();
  const isLive = job.kind === 'live_recording';
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
    if (job.kind !== 'lecture_transcode' && !isLive) {
      throw new Error(`unknown job kind: ${String(job.kind)}`);
    }

    await mkdir(deps.tmpDir, { recursive: true });
    workDir = await mkdtemp(join(deps.tmpDir, 'job-'));
    const outputPath = join(workDir, 'output.mp3');
    reporter.start();

    // 1. input: live raws are read IN PLACE; upload originals are downloaded.
    let inputPath: string;
    let raw: { path: string; size: number; name: string } | null = null;
    if (isLive) {
      const r = await deps.recordings.check(job.input_key);
      if (typeof r === 'string') throw new Error(`live raw is not usable (${r}); it is left untouched`);
      raw = r;
      inputPath = r.path;
    } else {
      inputPath = join(workDir, `input${inputExt(job.input_key)}`);
      await deps.storage.downloadToFile(job.input_key, inputPath, {
        signal,
        onFraction: (f) => reporter.report(phaseProgress('download', f)),
      });
    }
    reporter.report(phaseProgress('download', 1));
    if (signal.aborted) throw new AbortedError();

    // 2. duration + transcode
    const inputDuration = await deps.media.probeDuration(inputPath, signal);
    if (signal.aborted) throw new AbortedError();
    await deps.media.transcode({
      input: inputPath,
      output: outputPath,
      loudnorm: isLive && deps.liveLoudnorm,
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
    const naming = isLive
      ? await deps.db.liveJobNaming(job.id)
      : await deps.db.getLectureNaming(job.lecture_id as string);
    const outputKey = await uniqueLectureKey(naming.sectionTitle, naming.title, 'mp3', exists);
    if (signal.aborted) throw new AbortedError();
    // Live jobs split the upload slice between the MP3 and the raw backup.
    const mp3Share = isLive ? 0.5 : 1;
    await deps.storage.uploadFile(outputKey, outputPath, OUTPUT_CONTENT_TYPE, {
      signal,
      onFraction: (f) => reporter.report(phaseProgress('upload', f * mp3Share)),
    });
    uncommittedKey = outputKey;

    // 4. live only: back the raw up to R2 before the lecture is created.
    let rawBackupKey: string | undefined;
    let localRawDeleted = false;
    if (raw) {
      rawBackupKey = `${RAW_BACKUP_PREFIX}${raw.name}`;
      const existing = await deps.storage.objectSize(rawBackupKey);
      if (existing === raw.size) {
        log('info', 'job.raw_backup_present', { id: job.id, key: rawBackupKey, bytes: raw.size });
      } else {
        if (signal.aborted) throw new AbortedError();
        const uploaded = await deps.storage.uploadFile(rawBackupKey, raw.path, RAW_CONTENT_TYPE, {
          signal,
          onFraction: (f) => reporter.report(phaseProgress('upload', 0.5 + f * 0.5)),
        });
        if (uploaded !== raw.size) throw new Error(`raw backup size mismatch (${uploaded} ≠ ${raw.size} bytes)`);
        log('info', 'job.raw_backup_uploaded', { id: job.id, key: rawBackupKey, bytes: raw.size, replaced: existing !== null });
      }
    }

    // 5. commit. Stop the reporter first so a late progress write can't race
    //    the RPC's progress=1; never commit a job that is no longer ours. (A
    //    shutdown arriving now still commits — the RPC is quick, and it beats
    //    orphaning the uploaded MP3.)
    await reporter.stop();
    if (reporter.lost) throw new AbortedError('job no longer running');
    if (!isLive) {
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
      const lectureId = await deps.db.createLiveLecture(job.id, outputKey, durationSec, sizeBytes, rawBackupKey as string);
      uncommittedKey = null;
      log('info', 'job.live_lecture_created', { id: job.id, lecture: lectureId });
      localRawDeleted = await releaseLocalRaw(deps, job, raw as LocalRaw, rawBackupKey as string, outputKey, log);
    }

    log('info', 'job.done', {
      id: job.id,
      kind: job.kind,
      output: outputKey,
      duration_sec: durationSec === null ? null : Math.round(durationSec),
      size: sizeBytes,
      ms: Date.now() - started,
    });
    return {
      status: 'done',
      outputKey,
      durationSec,
      sizeBytes,
      ...(rawBackupKey ? { rawBackupKey, localRawDeleted } : {}),
    };
  } catch (err) {
    await reporter.stop();
    if (reporter.lost) {
      // Nothing references the MP3 we uploaded (no commit ran) → safe to remove.
      // (A raw backup is kept: it is a copy of a recording, never a liability.)
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
