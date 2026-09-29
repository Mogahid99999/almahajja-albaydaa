// Recording guard (0146; owner rule: a live recording is never lost).
//
// Drill 2026-09-29: `docker kill almahajja-egress` mid-session → no
// egress_ended webhook, the rest of the session unrecorded, the partial .ogg
// stranded in the egress tmp dir, the session stuck `ended` forever.
//
// Every 20 s (and a few seconds after a relevant webhook) the guard reads
// live_recording_watch() — every live session and every ended one without its
// recording job, with its parts (one per egress) — and for each session of
// THIS env:
//   1. judges every `recording` part (judgeEgress, pure): the egress is dead
//      when egress_ended said FAILED/ABORTED, LiveKit says it ended badly or no
//      longer knows it, its session ended ≥ 10 min ago, or (live session) its
//      recorder participant left the room / the room is gone while its tmp file
//      has stopped growing. A lost webhook of a CLEAN end (LiveKit: COMPLETE)
//      is replayed as enqueue_live_recording. A dead part is marked `dead`
//      at once (register_live_recording_part), so…
//   2. …a still-`live` session gets a new egress right away: live-control
//      `resume_recording` (service role; resumeDecision: backoff, part cap,
//      stop after 3 lost parts in a row);
//   3. recovers every `dead` part: the egress's own file result if it is in
//      RECORDINGS_DIR, else its partial in EGRESS_TMP_DIR (copied under a new
//      name, verified, then the source removed), else one unreferenced final
//      file of that room when unambiguous; nothing anywhere → `lost`;
//   4. an `ended` session still without a job 10 min after its end, with no
//      open part, is settled (settle_live_recording: job, or `failed` with the
//      Arabic error the admin page shows) — never silently `ended`.
// State kept in memory (presence history, webhook failure marks, resume
// backoff) only sharpens decisions; after a restart the DB + LiveKit + disk
// are enough (with longer fallbacks).

import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { WorkerEnv } from './config.js';
import type { JobDb, LiveRecordingWatch, RegisterPartStatus } from './db.js';
import { copyIntoRecordings, type EgressTmpDir, isEnvRoomName, isOwnRecordingName, type TmpRecording } from './egressRecovery.js';
import type { EgressTracker } from './egressTracker.js';
import type { EgressLookup, LiveKitProbe, PresenceLookup } from './livekitProbe.js';
import type { LiveControl, ResumeReason } from './liveControl.js';
import { errorMessage, type Logger, silentLogger } from './log.js';
import { PeriodicTask } from './periodic.js';
import type { RecordingsDir } from './recordings.js';

/** livekit.EgressStatus */
export const EGRESS_STATUS = {
  STARTING: 0,
  ACTIVE: 1,
  ENDING: 2,
  COMPLETE: 3,
  FAILED: 4,
  ABORTED: 5,
  LIMIT_REACHED: 6,
} as const;

export interface GuardTiming {
  /** A new egress needs time to register and join its room: no "missing"/"absent" verdict before. */
  startGraceMs: number;
  /** After the session ended, an egress still not reported is dead (it was stopped, its room deleted). */
  endedGraceMs: number;
  /** Never call an egress dead while its tmp file changed less than this long ago. */
  tmpQuietMs: number;
  /** Without LiveKit presence evidence: a tmp file this idle means the egress is gone. */
  stallFallbackMs: number;
  /**
   * How long the recorder must have been missing from its room, seen by at
   * least two sweeps this far apart (a burst of triggered sweeps proves nothing).
   */
  absentMinMs: number;
  resumeBackoffMs: number;
  maxParts: number;
  /** Stop auto-resuming after this many `lost` parts in a row (a failing egress loop). */
  lostStreakStop: number;
}

export const GUARD_TIMING: GuardTiming = {
  startGraceMs: 2 * 60_000,
  endedGraceMs: 10 * 60_000,
  tmpQuietMs: 45_000,
  stallFallbackMs: 10 * 60_000,
  absentMinMs: 15_000,
  resumeBackoffMs: 60_000,
  maxParts: 50,
  lostStreakStop: 3,
};

export type DeadReason =
  | 'egress_failed'
  | 'egress_unknown'
  | 'ended_timeout'
  | 'room_gone'
  | 'left_room'
  | 'stalled'
  | 'completed_without_file';

export type Judgement =
  | { verdict: 'alive' }
  | { verdict: 'wait'; why: string }
  /** LiveKit says it ended cleanly (the egress_ended webhook was lost). */
  | { verdict: 'completed'; rawPath: string | null }
  | { verdict: 'dead'; why: DeadReason; hintPath: string | null };

export interface JudgeInput {
  nowMs: number;
  sessionStatus: string;
  sessionEndedMs: number | null;
  partStartedMs: number | null;
  /** egress_ended with FAILED / ABORTED (or no usable output) arrived for this egress. */
  webhookFailed: boolean;
  egress: EgressLookup;
  /** Only looked up for live sessions ('unconfigured' otherwise). */
  presence: PresenceLookup;
  /** The recorder was seen in the room's participant list before (so hidden participants ARE listed). */
  presenceConfirmed: boolean;
  /** ms the recorder has been continuously absent / its room gone (0 = first seen absent now). */
  absentForMs: number | null;
  /** ms since the tmp file last changed; null = no tmp file (or tmp dir not visible). */
  tmpIdleMs: number | null;
}

const dead = (why: DeadReason, hintPath: string | null): Judgement => ({ verdict: 'dead', why, hintPath });

/** Is this egress dead, alive, or cleanly done? Conservative: a false "dead" would record twice. */
export function judgeEgress(i: JudgeInput, t: GuardTiming = GUARD_TIMING): Judgement {
  const apiPath = i.egress.kind === 'found' ? i.egress.rawPath : null;
  if (i.webhookFailed) return dead('egress_failed', apiPath);
  if (i.egress.kind === 'found') {
    const s = i.egress.status;
    if (s === EGRESS_STATUS.COMPLETE || s === EGRESS_STATUS.LIMIT_REACHED) return { verdict: 'completed', rawPath: apiPath };
    if (s === EGRESS_STATUS.FAILED || s === EGRESS_STATUS.ABORTED) return dead('egress_failed', apiPath);
  }
  const age = i.partStartedMs === null ? Number.POSITIVE_INFINITY : i.nowMs - i.partStartedMs;
  if (i.egress.kind === 'missing' && age >= t.startGraceMs) return dead('egress_unknown', null);

  if (i.sessionStatus !== 'live') {
    // Ended: `end` stopped this egress and deleted the room; a healthy egress
    // reports within seconds. Only the backstop applies.
    if (i.sessionEndedMs === null || i.nowMs - i.sessionEndedMs >= t.endedGraceMs) return dead('ended_timeout', apiPath);
    return { verdict: 'wait', why: 'ending' };
  }

  if (i.presence.kind === 'present') return { verdict: 'alive' };
  if (age < t.startGraceMs) return { verdict: 'wait', why: 'starting' };
  if (i.tmpIdleMs !== null && i.tmpIdleMs < t.tmpQuietMs) return { verdict: 'wait', why: 'still_writing' };
  const absentLongEnough = i.absentForMs !== null && i.absentForMs >= t.absentMinMs;
  if (i.presence.kind === 'room_gone' && absentLongEnough) return dead('room_gone', apiPath);
  if (
    i.presence.kind === 'absent' &&
    i.presenceConfirmed &&
    absentLongEnough
  ) {
    return dead('left_room', apiPath);
  }
  if (i.tmpIdleMs !== null && i.tmpIdleMs >= t.stallFallbackMs) return dead('stalled', apiPath);
  return { verdict: 'wait', why: `presence_${i.presence.kind}` };
}

export type ResumeDecision = { resume: true; reason: ResumeReason } | { resume: false; why: string };

/** Should a new egress be started for this session now? */
export function resumeDecision(
  s: Pick<LiveRecordingWatch, 'status'> & { parts: ReadonlyArray<{ status: string }> },
  nowMs: number,
  lastAttemptMs: number | undefined,
  t: GuardTiming = GUARD_TIMING,
): ResumeDecision {
  if (s.status !== 'live') return { resume: false, why: 'not_live' };
  // No parts at all: a pre-0146 session whose egress we cannot see — never start a second one blindly.
  if (s.parts.length === 0) return { resume: false, why: 'no_parts' };
  if (s.parts.some((p) => p.status === 'recording')) return { resume: false, why: 'recording' };
  if (s.parts.length >= t.maxParts) return { resume: false, why: 'part_cap' };
  const tail = s.parts.slice(-t.lostStreakStop);
  if (tail.length === t.lostStreakStop && tail.every((p) => p.status === 'lost')) {
    return { resume: false, why: 'repeated_loss' };
  }
  if (lastAttemptMs !== undefined && nowMs - lastAttemptMs < t.resumeBackoffMs) return { resume: false, why: 'backoff' };
  const last = s.parts[s.parts.length - 1];
  return { resume: true, reason: last?.status === 'complete' ? 'egress_ended' : 'egress_failed' };
}

/** An ended session with no job and nothing open, long enough after its end → settle it. */
export function shouldSettle(
  s: Pick<LiveRecordingWatch, 'status' | 'hasJob' | 'endedAt'> & { parts: ReadonlyArray<{ status: string }> },
  nowMs: number,
  t: GuardTiming = GUARD_TIMING,
): boolean {
  if (s.status !== 'ended' || s.hasJob) return false;
  if (s.parts.some((p) => p.status === 'recording' || p.status === 'dead')) return false;
  const endedMs = s.endedAt ? Date.parse(s.endedAt) : Number.NaN;
  return !Number.isFinite(endedMs) || nowMs - endedMs >= t.endedGraceMs;
}

const RECOVERED_RE = /-recovered(-\d+)?\.ogg$/i;

export type GuardStats = {
  sessions: number;
  open: number;
  completed: number;
  dead: number;
  recovered: number;
  lost: number;
  resumed: number;
  settled: number;
  refused: number;
  errors: number;
};

export interface GuardDeps {
  env: WorkerEnv;
  db: Pick<
    JobDb,
    'liveRecordingWatch' | 'registerLiveRecordingPart' | 'enqueueLiveRecording' | 'settleLiveRecording'
  >;
  probe: LiveKitProbe;
  control: Pick<LiveControl, 'resumeRecording'>;
  recordings: Pick<RecordingsDir, 'check' | 'root'>;
  tmp: Pick<EgressTmpDir, 'available' | 'find' | 'remove'>;
  egress?: Pick<EgressTracker, 'ended'>;
  log?: Logger;
  now?: () => number;
  timing?: Partial<GuardTiming>;
}

type WatchPart = LiveRecordingWatch['parts'][number];

interface PresenceMemory {
  confirmed: boolean;
  /** First sweep of the current absence (null = present / unknown). */
  absentSince: number | null;
}

export class RecordingGuard {
  private readonly task: PeriodicTask<GuardStats>;
  private readonly presence = new Map<string, PresenceMemory>();
  private readonly failed = new Map<string, { hint: string | null }>();
  private readonly lastResume = new Map<string, number>();
  private readonly stopNoted = new Set<string>();
  private triggerTimer: ReturnType<typeof setTimeout> | null = null;
  private triggerDue = 0;
  private stopped = false;
  private readonly g: GuardDeps;
  private readonly t: GuardTiming;
  private readonly logger: Logger;
  private readonly clock: () => number;

  constructor(deps: GuardDeps, opts: { firstDelayMs?: number; everyMs?: number } = {}) {
    const log = deps.log ?? silentLogger;
    this.g = deps;
    this.t = { ...GUARD_TIMING, ...deps.timing };
    this.logger = log;
    this.clock = deps.now ?? Date.now;
    this.task = new PeriodicTask((signal) => this.sweep(signal), {
      name: 'recording_guard',
      firstDelayMs: opts.firstDelayMs ?? 10_000,
      everyMs: opts.everyMs ?? 20_000,
      log,
      fields: (s) => s,
      // every 20 s: only runs that did something are logged
      quiet: (s) =>
        s.completed + s.dead + s.recovered + s.lost + s.resumed + s.settled + s.refused + s.errors === 0,
    });
  }

  start(): void {
    this.task.start();
  }

  runOnce(): Promise<void> {
    return this.task.runOnce();
  }

  /** Webhook: egress_ended without a usable recording (FAILED / ABORTED / no .ogg). */
  egressFailed(egressId: string, rawPath: string | null): void {
    if (!egressId) return;
    this.failed.set(egressId, { hint: rawPath });
    this.trigger();
  }

  /** Run a sweep soon (after a webhook that may need a resume or a recovery). */
  trigger(delayMs = 3_000): void {
    if (this.stopped) return;
    const due = this.clock() + delayMs;
    if (this.triggerTimer && this.triggerDue <= due) return; // an earlier run is already scheduled
    if (this.triggerTimer) clearTimeout(this.triggerTimer);
    this.triggerDue = due;
    this.triggerTimer = setTimeout(() => {
      this.triggerTimer = null;
      void this.runOnce();
    }, delayMs);
    this.triggerTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.triggerTimer) clearTimeout(this.triggerTimer);
    this.triggerTimer = null;
    await this.task.stop();
  }

  /** One pass over every watched session (exposed for tests). */
  async sweep(signal?: AbortSignal): Promise<GuardStats> {
    const stats: GuardStats = {
      sessions: 0,
      open: 0,
      completed: 0,
      dead: 0,
      recovered: 0,
      lost: 0,
      resumed: 0,
      settled: 0,
      refused: 0,
      errors: 0,
    };
    const rows = await this.g.db.liveRecordingWatch();
    const tmpAvailable = await this.g.tmp.available();
    const seen = new Set<string>();

    for (const s of rows) {
      if (signal?.aborted) break;
      if (!isEnvRoomName(s.roomName, this.g.env)) {
        // The DB is per env; a foreign room here is a misconfiguration — never touch it.
        stats.refused++;
        this.logger('error', 'recording.foreign_room', { session: s.sessionId });
        continue;
      }
      stats.sessions++;
      for (const p of s.parts) seen.add(p.egressId);
      try {
        await this.sweepSession(s, tmpAvailable, stats);
      } catch (err) {
        stats.errors++;
        this.logger('error', 'recording.guard_error', { session: s.sessionId, error: errorMessage(err, 200) });
      }
    }

    // Forget egresses that are no longer watched.
    for (const id of [...this.presence.keys()]) if (!seen.has(id)) this.presence.delete(id);
    for (const id of [...this.failed.keys()]) if (!seen.has(id)) this.failed.delete(id);
    const sessions = new Set(rows.map((r) => r.sessionId));
    for (const id of [...this.lastResume.keys()]) if (!sessions.has(id)) this.lastResume.delete(id);
    return stats;
  }

  private async sweepSession(s: LiveRecordingWatch, tmpAvailable: boolean, stats: GuardStats): Promise<void> {
    const now = this.clock();
    const parts: WatchPart[] = s.parts.map((p) => ({ ...p }));
    stats.open += parts.filter((p) => p.status === 'recording' || p.status === 'dead').length;

    // 1. judge the running parts
    for (const part of parts) {
      if (part.status !== 'recording') continue;
      await this.judgePart(s, part, tmpAvailable, now, stats);
    }

    // 2. keep recording a live session whose egress died
    const d = resumeDecision({ status: s.status, parts }, now, this.lastResume.get(s.sessionId), this.t);
    if (d.resume) {
      this.lastResume.set(s.sessionId, now);
      try {
        const r = await this.g.control.resumeRecording(s.sessionId, d.reason);
        if (r.status === 'resumed') {
          stats.resumed++;
          this.logger('warn', 'recording.resumed', {
            session: s.sessionId,
            reason: d.reason,
            egress: r.egressId ?? undefined,
            seq: r.seq ?? undefined,
          });
        } else {
          this.logger('warn', 'recording.resume_refused', { session: s.sessionId, http: r.httpStatus, detail: r.detail });
        }
      } catch (err) {
        stats.errors++;
        this.logger('error', 'recording.resume_failed', { session: s.sessionId, error: errorMessage(err, 200) });
      }
    } else if ((d.why === 'repeated_loss' || d.why === 'part_cap') && !this.stopNoted.has(s.sessionId)) {
      this.stopNoted.add(s.sessionId);
      this.logger('error', 'recording.resume_stopped', { session: s.sessionId, why: d.why, parts: parts.length });
    }

    // 3. recover every dead part's file
    for (const part of parts) {
      if (part.status !== 'dead') continue;
      await this.recoverPart(s, parts, part, tmpAvailable, now, stats);
    }

    // 4. never stuck `ended`
    if (shouldSettle({ status: s.status, hasJob: s.hasJob, endedAt: s.endedAt, parts }, now, this.t)) {
      const job = await this.g.db.settleLiveRecording(s.sessionId);
      stats.settled++;
      this.logger('warn', 'recording.settled', { session: s.sessionId, job: job ?? 'none' });
    }
  }

  private async judgePart(
    s: LiveRecordingWatch,
    part: WatchPart,
    tmpAvailable: boolean,
    now: number,
    stats: GuardStats,
  ): Promise<void> {
    const egress = await this.g.probe.egress(part.egressId);
    const presence: PresenceLookup =
      s.status === 'live' ? await this.g.probe.presence(s.roomName, part.egressId) : { kind: 'unconfigured' };
    const mem = this.presence.get(part.egressId) ?? { confirmed: false, absentSince: null };
    if (presence.kind === 'present') {
      mem.confirmed = true;
      mem.absentSince = null;
    } else if (presence.kind === 'absent' || presence.kind === 'room_gone') {
      mem.absentSince ??= now;
    }
    this.presence.set(part.egressId, mem);

    const tmpFile = tmpAvailable ? await this.g.tmp.find(part.egressId, s.roomName) : null;
    const endedMs = s.endedAt ? Date.parse(s.endedAt) : Number.NaN;
    const startedMs = part.startedAt ? Date.parse(part.startedAt) : Number.NaN;
    const j = judgeEgress(
      {
        nowMs: now,
        sessionStatus: s.status,
        sessionEndedMs: Number.isFinite(endedMs) ? endedMs : null,
        partStartedMs: Number.isFinite(startedMs) ? startedMs : null,
        webhookFailed: this.failed.has(part.egressId),
        egress,
        presence,
        presenceConfirmed: mem.confirmed,
        absentForMs: mem.absentSince === null ? null : now - mem.absentSince,
        tmpIdleMs: tmpFile ? Math.max(0, now - tmpFile.mtimeMs) : null,
      },
      this.t,
    );

    if (j.verdict === 'alive' || j.verdict === 'wait') return;

    if (j.verdict === 'completed') {
      const local = j.rawPath ? await this.g.recordings.check(j.rawPath) : 'missing';
      if (typeof local !== 'string') {
        // The egress_ended webhook was lost: replay it.
        const job = await this.g.db.enqueueLiveRecording(s.roomName, part.egressId, local.path);
        part.status = 'complete';
        part.rawPath = local.path;
        stats.completed++;
        this.g.egress?.ended(part.egressId);
        this.presence.delete(part.egressId);
        this.logger('warn', 'recording.webhook_replayed', {
          session: s.sessionId,
          egress: part.egressId,
          raw: local.name,
          job: job ?? 'deferred',
        });
        return;
      }
      await this.markDead(s, part, 'completed_without_file', stats);
      return;
    }

    if (j.hintPath && !this.failed.get(part.egressId)?.hint) this.failed.set(part.egressId, { hint: j.hintPath });
    await this.markDead(s, part, j.why, stats);
  }

  private async markDead(s: LiveRecordingWatch, part: WatchPart, why: DeadReason, stats: GuardStats): Promise<void> {
    await this.g.db.registerLiveRecordingPart(s.roomName, part.egressId, null, 'dead', null);
    part.status = 'dead';
    stats.dead++;
    this.g.egress?.ended(part.egressId);
    this.presence.delete(part.egressId);
    this.logger('error', 'recording.egress_dead', {
      session: s.sessionId,
      egress: part.egressId,
      seq: part.seq,
      why,
      session_status: s.status,
    });
  }

  private async register(
    s: LiveRecordingWatch,
    part: WatchPart,
    status: RegisterPartStatus,
    raw: { path: string; name: string; size: number } | null,
    how: string,
    stats: GuardStats,
  ): Promise<void> {
    const job = await this.g.db.registerLiveRecordingPart(
      s.roomName,
      part.egressId,
      raw?.path ?? null,
      status,
      raw?.size ?? null,
    );
    part.status = status;
    part.rawPath = raw?.path ?? null;
    this.failed.delete(part.egressId);
    if (status === 'lost') stats.lost++;
    else stats.recovered++;
    this.logger(status === 'lost' ? 'error' : 'warn', status === 'lost' ? 'recording.part_lost' : 'recording.part_recovered', {
      session: s.sessionId,
      egress: part.egressId,
      seq: part.seq,
      how,
      raw: raw?.name,
      bytes: raw?.size,
      job: job ?? undefined,
    });
  }

  private async recoverPart(
    s: LiveRecordingWatch,
    parts: WatchPart[],
    part: WatchPart,
    tmpAvailable: boolean,
    now: number,
    stats: GuardStats,
  ): Promise<void> {
    const env = this.g.env;
    const known = new Set(parts.map((p) => p.rawPath).filter((p): p is string => !!p));

    // a. the egress's own output, already in RECORDINGS_DIR (e.g. FAILED after the move)
    const hint = this.failed.get(part.egressId)?.hint ?? null;
    if (hint) {
      const local = await this.g.recordings.check(hint);
      if (typeof local !== 'string' && isOwnRecordingName(local.name, s.roomName, env) && !known.has(local.path)) {
        await this.register(s, part, 'recovered', local, 'egress_output', stats);
        return;
      }
    }

    // b. the partial in the egress tmp dir
    if (tmpAvailable) {
      const src = await this.g.tmp.find(part.egressId, s.roomName);
      if (src) {
        const copied = await this.copyOrReuse(src, known);
        if (!copied) return; // still being written / copy failed: next sweep
        await this.register(s, part, 'recovered', copied, 'egress_tmp', stats);
        const rm = await this.g.tmp.remove(src, part.egressId, s.roomName);
        if (!rm.removed) {
          this.logger('warn', 'recording.tmp_not_removed', { egress: part.egressId, error: rm.error });
        }
        return;
      }
    }

    // c. one unreferenced final file of this room — only when unambiguous
    const open = parts.filter((p) => p.status === 'recording' || p.status === 'dead');
    if (open.length === 1) {
      const orphans = await this.unreferencedFiles(s.roomName, known);
      if (orphans.length === 1) {
        const local = await this.g.recordings.check(orphans[0]);
        if (typeof local !== 'string') {
          await this.register(s, part, 'recovered', local, 'unreferenced_file', stats);
          return;
        }
      } else if (orphans.length > 1) {
        this.logger('error', 'recording.ambiguous_files', { session: s.sessionId, egress: part.egressId, files: orphans.length });
        return; // keep it open: never guess between two files (the admin page shows it waiting)
      }
    }

    // d. nothing anywhere
    if (!tmpAvailable) {
      const endedMs = s.endedAt ? Date.parse(s.endedAt) : Number.NaN;
      const longEnded = s.status !== 'live' && (!Number.isFinite(endedMs) || now - endedMs >= this.t.endedGraceMs);
      if (!longEnded) {
        this.logger('error', 'recording.tmp_unavailable', { session: s.sessionId, egress: part.egressId });
        return;
      }
    }
    await this.register(s, part, 'lost', null, tmpAvailable ? 'nothing_found' : 'tmp_unavailable', stats);
  }

  /** Copy the partial into RECORDINGS_DIR — or reuse an identical earlier copy (a register that failed last time). */
  private async copyOrReuse(
    src: TmpRecording,
    known: Set<string>,
  ): Promise<{ path: string; name: string; size: number } | null> {
    const root = this.g.recordings.root;
    const stem = src.name.replace(/\.ogg$/i, '');
    try {
      for (const name of (await readdir(root)).sort()) {
        if (!name.startsWith(`${stem}-recovered`) || !RECOVERED_RE.test(name)) continue;
        const local = await this.g.recordings.check(join(root, name));
        if (typeof local !== 'string' && local.size === src.size && !known.has(local.path)) return local;
      }
      const copied = await copyIntoRecordings(src, root);
      const local = await this.g.recordings.check(copied.path);
      if (typeof local === 'string') throw new Error(`recovered copy is not usable (${local})`);
      return local;
    } catch (err) {
      this.logger('error', 'recording.copy_failed', { file: basename(src.path), error: errorMessage(err, 200) });
      return null;
    }
  }

  /** Final egress files of this room in RECORDINGS_DIR that no part references. */
  private async unreferencedFiles(roomName: string, known: Set<string>): Promise<string[]> {
    const root = this.g.recordings.root;
    const out: string[] = [];
    let names: string[];
    try {
      names = (await readdir(root)).sort();
    } catch {
      return out;
    }
    for (const name of names) {
      if (!isOwnRecordingName(name, roomName, this.g.env) || RECOVERED_RE.test(name)) continue;
      const local = await this.g.recordings.check(join(root, name));
      if (typeof local === 'string' || known.has(local.path)) continue;
      out.push(local.path);
    }
    return out;
  }
}
