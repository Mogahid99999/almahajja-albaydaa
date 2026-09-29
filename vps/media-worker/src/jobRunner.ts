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
// live_recording in PARTS (0146 live_recording_parts — one per egress; an
//   egress that crashed mid-session left a partial file the recording guard
//   recovered, and a new egress took over): every part with a file, in seq
//   order, is read in place and concatenated by ffmpeg (a partial part has no
//   EOS page; a part too damaged to even open is skipped with a warning when it
//   is small — it is still backed up and kept). EACH part is backed up to
//   `live-raw/<its basename>` and stamped (mark_live_part_backed_up) before
//   create_live_lecture (which records the first part's key on the session); the
//   local raws are then released part by part (mark_live_part_raw_deleted). A
//   pre-0146 session has no parts: its single raw is job.input_key, as before.
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
/**
 * A recording part ffprobe cannot even open is left out of the lecture only
 * when it is this small (a few seconds: the egress died right after starting);
 * a bigger unreadable part fails the job loudly instead (raws kept).
 */
export const MAX_SKIPPABLE_PART_BYTES = 256 * 1024;

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
      /** live only: every part's backup key (one entry for a single raw). */
      rawBackupKeys?: string[];
      /** live only: the local raw(s) were verified-backed-up and deleted by this run. */
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
/** One local raw of a live job: `seq` null = the pre-0146 single raw (job.input_key). */
type RawPart = LocalRaw & { seq: number | null; backupKey: string };

/**
 * After create_live_lecture: delete a local raw only when its R2 backup has
 * exactly its size and the MP3 is in R2. Never throws — the job already succeeded.
 */
async function releaseLocalRaw(
  deps: JobRunnerDeps,
  job: MediaJob,
  raw: RawPart,
  mp3Key: string,
  log: Logger,
): Promise<boolean> {
  const seq = raw.seq ?? undefined;
  const keep = (reason: string, extra: Record<string, string | number> = {}) => {
    log('warn', 'raw.keep', { id: job.id, session: job.live_session_id ?? undefined, seq, reason, ...extra });
    return false;
  };
  const session = job.live_session_id;
  try {
    if (!session) return keep('no_session');
    const now = await deps.recordings.check(raw.path);
    if (typeof now === 'string') return keep(`local_${now}`);
    const backupSize = await deps.storage.objectSize(raw.backupKey);
    if (backupSize === null) return keep('backup_missing');
    if (backupSize !== now.size) return keep('backup_size_mismatch', { local_bytes: now.size, backup_bytes: backupSize });
    if (!(await deps.storage.exists(mp3Key))) return keep('mp3_missing');
    if (!(await deps.recordings.delete(now.path))) return keep('revalidation_failed');
  } catch (err) {
    return keep('error', { error: errorMessage(err, 200) });
  }
  try {
    if (raw.seq === null) await deps.db.markLiveRawDeleted(session);
    else await deps.db.markLivePartRawDeleted(session, raw.seq);
    log('info', 'raw.deleted', { id: job.id, session, seq, bytes: raw.size, backup: raw.backupKey });
  } catch (err) {
    // File is gone, backup verified; the sweep stamps it (local missing + backup present).
    log('error', 'raw.mark_failed', { id: job.id, session, seq, error: errorMessage(err, 200) });
  }
  return true;
}

/**
 * The live job's local raws, in audio order: the session's parts with a file
 * (0146), or — no parts (pre-0146 session) — job.input_key. Every path must be
 * a regular file inside RECORDINGS_DIR; nothing is ever read from elsewhere.
 */
async function liveRaws(deps: JobRunnerDeps, job: MediaJob, log: Logger): Promise<RawPart[]> {
  const parts = job.live_session_id ? await deps.db.liveRecordingParts(job.live_session_id) : [];
  const toPart = (r: LocalRaw, seq: number | null): RawPart => ({ ...r, seq, backupKey: `${RAW_BACKUP_PREFIX}${r.name}` });
  if (parts.length === 0) {
    const r = await deps.recordings.check(job.input_key);
    if (typeof r === 'string') throw new Error(`live raw is not usable (${r}); it is left untouched`);
    return [toPart(r, null)];
  }
  const open = parts.find((p) => p.status === 'recording' || p.status === 'dead');
  if (open) throw new Error(`recording part ${open.seq} is still ${open.status}; nothing is processed yet`);
  const lost = parts.filter((p) => p.status === 'lost').map((p) => p.seq);
  if (lost.length) log('warn', 'job.parts_lost', { id: job.id, session: job.live_session_id ?? undefined, seqs: lost.join(',') });
  const out: RawPart[] = [];
  for (const p of parts) {
    if (!p.rawPath || (p.status !== 'complete' && p.status !== 'recovered')) continue;
    const r = await deps.recordings.check(p.rawPath);
    if (typeof r === 'string') throw new Error(`live raw part ${p.seq} is not usable (${r}); it is left untouched`);
    out.push(toPart(r, p.seq));
  }
  if (!out.length) throw new Error('no recording part has a file; nothing to process');
  return out;
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
    let inputPaths: string[];
    let raws: RawPart[] = [];
    if (isLive) {
      raws = await liveRaws(deps, job, log);
      inputPaths = raws.map((r) => r.path);
    } else {
      const inputPath = join(workDir, `input${inputExt(job.input_key)}`);
      await deps.storage.downloadToFile(job.input_key, inputPath, {
        signal,
        onFraction: (f) => reporter.report(phaseProgress('download', f)),
      });
      inputPaths = [inputPath];
    }
    reporter.report(phaseProgress('download', 1));
    if (signal.aborted) throw new AbortedError();

    // 2. duration + transcode (several parts: probed one by one, concatenated)
    let inputDuration: number | null;
    if (inputPaths.length === 1) {
      inputDuration = await deps.media.probeDuration(inputPaths[0] as string, signal);
    } else {
      const usable: string[] = [];
      const durations: Array<number | null> = [];
      for (const r of raws) {
        const d = await deps.media.probeDuration(r.path, signal);
        if (signal.aborted) throw new AbortedError();
        if (d === null && r.size <= MAX_SKIPPABLE_PART_BYTES) {
          // Could not even be opened (e.g. the egress died seconds after starting):
          // nothing decodable to lose. Still backed up and kept below.
          log('warn', 'job.part_skipped', { id: job.id, seq: r.seq ?? undefined, bytes: r.size, reason: 'unreadable' });
          continue;
        }
        usable.push(r.path);
        durations.push(d);
      }
      if (!usable.length) throw new Error('no recording part could be read by ffprobe; the raws are kept');
      inputPaths = usable;
      inputDuration = durations.every((d) => d !== null)
        ? (durations as number[]).reduce((a, b) => a + b, 0)
        : null;
    }
    if (signal.aborted) throw new AbortedError();
    await deps.media.transcode({
      input: inputPaths.length === 1 ? (inputPaths[0] as string) : inputPaths,
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

    // 4. live only: back EVERY raw up to R2 before the lecture is created.
    let localRawDeleted = false;
    const totalRawBytes = raws.reduce((a, r) => a + r.size, 0);
    let doneRawBytes = 0;
    for (const raw of raws) {
      const existing = await deps.storage.objectSize(raw.backupKey);
      if (existing === raw.size) {
        log('info', 'job.raw_backup_present', { id: job.id, key: raw.backupKey, bytes: raw.size });
      } else {
        if (signal.aborted) throw new AbortedError();
        const base = doneRawBytes;
        const uploaded = await deps.storage.uploadFile(raw.backupKey, raw.path, RAW_CONTENT_TYPE, {
          signal,
          onFraction: (f) =>
            reporter.report(phaseProgress('upload', 0.5 + (0.5 * (base + f * raw.size)) / Math.max(1, totalRawBytes))),
        });
        if (uploaded !== raw.size) throw new Error(`raw backup size mismatch (${uploaded} ≠ ${raw.size} bytes)`);
        log('info', 'job.raw_backup_uploaded', { id: job.id, key: raw.backupKey, bytes: raw.size, replaced: existing !== null });
      }
      doneRawBytes += raw.size;
    }
    const rawBackupKey = raws[0]?.backupKey;

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
      // Parts: every backup is recorded before the lecture exists (the part-level
      // retention only ever deletes a raw whose backup is recorded).
      for (const raw of raws) {
        if (raw.seq !== null) await deps.db.markLivePartBackedUp(job.live_session_id as string, raw.seq, raw.backupKey);
      }
      const lectureId = await deps.db.createLiveLecture(job.id, outputKey, durationSec, sizeBytes, rawBackupKey as string);
      uncommittedKey = null;
      log('info', 'job.live_lecture_created', { id: job.id, lecture: lectureId, parts: raws.length });
      localRawDeleted = true;
      for (const raw of raws) {
        if (!(await releaseLocalRaw(deps, job, raw, outputKey, log))) localRawDeleted = false;
      }
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
      ...(rawBackupKey ? { rawBackupKey, rawBackupKeys: raws.map((r) => r.backupKey), localRawDeleted } : {}),
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
