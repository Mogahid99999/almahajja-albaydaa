// In-memory fakes for the injected job dependencies (no network, no ffmpeg).

import { readFile, writeFile } from 'node:fs/promises';
import type {
  FailOutcome,
  JobDb,
  LectureNaming,
  LiveNaming,
  LivePartRawDue,
  LiveRawDue,
  LiveRecordingPart,
  LiveRecordingWatch,
  LiveSessionRaw,
  MediaJob,
  MediaJobKind,
  MediaJobStatus,
  RegisterPartStatus,
  RoomEventResult,
  StaffIdentity,
} from '../src/db.js';
import { AbortedError } from '../src/errors.js';
import type { MediaTools, TranscodeOptions } from '../src/media.js';
import type { ListPage, Storage } from '../src/storage.js';

export function makeJob(over: Partial<MediaJob> = {}): MediaJob {
  return {
    id: 'job-1',
    kind: 'lecture_transcode',
    status: 'running',
    progress: 0,
    input_key: 'incoming/5f0c.m4a',
    output_key: null,
    lecture_id: 'lec-1',
    live_session_id: null,
    attempts: 1,
    error: null,
    created_by: null,
    created_at: '2026-09-28T10:00:00Z',
    started_at: '2026-09-28T10:00:01Z',
    finished_at: null,
    heartbeat_at: '2026-09-28T10:00:01Z',
    not_before: null,
    ...over,
  };
}

export class FakeStorage implements Storage {
  objects = new Map<string, Buffer>();
  uploads: Array<{ key: string; contentType: string; from: string }> = [];
  /** Throw from uploadFile for keys starting with this prefix. */
  failUploadPrefix: string | null = null;
  objectSizeError: Error | null = null;
  presigned: Array<{ key: string; expiresInSec: number; contentDisposition?: string; contentType?: string }> = [];
  presignError: Error | null = null;
  deleted: string[] = [];
  existsChecks: string[] = [];
  failDelete = false;
  /** lastModified per key for listPage (missing → null = unknown). */
  modified = new Map<string, Date>();
  pageSize = 1000;
  listCalls = 0;

  async downloadToFile(key: string, path: string, o?: { onFraction?: (f: number) => void }): Promise<number> {
    const body = this.objects.get(key);
    if (!body) throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
    await writeFile(path, body);
    o?.onFraction?.(1);
    return body.length;
  }

  async uploadFile(key: string, path: string, contentType: string, o?: { onFraction?: (f: number) => void }) {
    if (this.failUploadPrefix && key.startsWith(this.failUploadPrefix)) throw new Error(`upload failed for ${key}`);
    const body = await readFile(path);
    this.objects.set(key, body);
    this.uploads.push({ key, contentType, from: path });
    o?.onFraction?.(1);
    return body.length;
  }

  async exists(key: string): Promise<boolean> {
    this.existsChecks.push(key);
    return this.objects.has(key);
  }

  async presignGet(key: string, o: { expiresInSec: number; contentDisposition?: string; contentType?: string }) {
    if (this.presignError) throw this.presignError;
    this.presigned.push({ key, ...o });
    return `https://r2.test/${encodeURIComponent(key)}?X-Amz-Expires=${o.expiresInSec}&sig=fake`;
  }

  async objectSize(key: string): Promise<number | null> {
    if (this.objectSizeError) throw this.objectSizeError;
    return this.objects.get(key)?.length ?? null;
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error('delete failed');
    this.objects.delete(key);
    this.deleted.push(key);
  }

  /** Paginated like ListObjectsV2 (token = next start key, so deletes mid-sweep are safe). */
  async listPage(prefix: string, token?: string | null): Promise<ListPage> {
    this.listCalls++;
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const from = token ? keys.findIndex((k) => k >= token) : 0;
    const start = from < 0 ? keys.length : from;
    const slice = keys.slice(start, start + this.pageSize);
    const nextKey = keys[start + this.pageSize];
    return {
      objects: slice.map((key) => ({ key, lastModified: this.modified.get(key) ?? null })),
      next: nextKey ?? null,
    };
  }
}

export type MediaMode = 'ok' | 'fail' | 'hang';

export class FakeMedia implements MediaTools {
  transcodes: TranscodeOptions[] = [];
  /** Resolves when transcode() has been entered (for abort tests). */
  entered: Promise<void>;
  private markEntered!: () => void;

  constructor(public mode: MediaMode = 'ok', public duration: number | null = 30) {
    this.entered = new Promise((r) => (this.markEntered = r));
  }

  /** Per-file probe results by basename (else `duration`). */
  probes = new Map<string, number | null>();
  probed: string[] = [];

  async probeDuration(path: string): Promise<number | null> {
    const name = path.split(/[\\/]/).pop() ?? '';
    this.probed.push(name);
    return this.probes.has(name) ? (this.probes.get(name) ?? null) : this.duration;
  }

  async transcode(t: TranscodeOptions): Promise<void> {
    this.transcodes.push(t);
    this.markEntered();
    if (t.signal?.aborted) throw new AbortedError(); // like the real wrapper
    if (this.mode === 'fail') {
      throw new Error('ffmpeg exited with code 1: [in] Invalid data found when processing input');
    }
    if (this.mode === 'hang') {
      await new Promise<void>((_, reject) => {
        t.signal?.addEventListener('abort', () => reject(new AbortedError('ffmpeg killed (shutdown)')), { once: true });
      });
    }
    t.onProgress?.(0.5);
    t.onProgress?.(1);
    await writeFile(t.output, Buffer.from('ID3\x04fake-mp3-frames'));
  }
}

export class FakeDb implements JobDb {
  calls: string[] = [];
  progress: number[] = [];
  /** touch_media_job result; set false to simulate "job no longer running". */
  touchResult = true;
  claimKinds: Array<MediaJobKind[] | null | undefined> = [];
  /** (input_key, status) of every job in the table. */
  jobRows: Array<{ input_key: string; status: MediaJobStatus }> = [];
  lookups: string[][] = [];
  lookupError: Error | null = null;
  completed: Array<{ jobId: string; key: string; durationSec: number | null; size: number }> = [];
  liveCreated: Array<{ jobId: string; key: string; durationSec: number | null; size: number; backup: string }> = [];
  liveNaming: LiveNaming = { sectionTitle: 'السيرة النبوية', title: 'مجلس الخميس', roomName: 'stg_abc123' };
  /** enqueue_live_recording result (null = session still live). */
  enqueueResult: string | null = 'job-live-1';
  roomEvents: Array<{ room: string; event: string; identity: string | null; num: number | null }> = [];
  roomEventResult: RoomEventResult | null = null;
  roomEventError: Error | null = null;
  rawsDue: LiveRawDue[] = [];
  rawsDueError: Error | null = null;
  markedRawDeleted: string[] = [];
  markError: Error | null = null;
  sessionRaws = new Map<string, LiveSessionRaw>();
  tokens = new Map<string, StaffIdentity>();
  staffError: Error | null = null;
  failed: Array<{ jobId: string; error: string }> = [];
  enqueued: Array<{ room: string; egress: string; raw: string }> = [];
  queue: MediaJob[] = [];
  failResult: FailOutcome = 'retry';
  completeError: Error | null = null;
  enqueueError: Error | null = null;
  naming: LectureNaming = { lectureId: 'lec-1', title: 'الدرس الأول', sectionTitle: 'كتاب التوحيد' };
  // ---- 0146 recording parts ----
  /** live_recording_parts per session (liveRecordingParts). */
  parts = new Map<string, LiveRecordingPart[]>();
  /** live_recording_watch() rows; register/enqueue update the matching part like the RPCs do. */
  watch: LiveRecordingWatch[] = [];
  watchError: Error | null = null;
  registered: Array<{ room: string; egress: string; raw: string | null; status: RegisterPartStatus; bytes: number | null }> = [];
  registerResult: string | null = null;
  registerError: Error | null = null;
  /** When set, registerError is thrown only for this status. */
  registerErrorStatus: RegisterPartStatus | null = null;
  settled: string[] = [];
  settleResult: string | null = 'job-failed-1';
  partBackups: Array<{ session: string; seq: number; key: string }> = [];
  partBackupError: Error | null = null;
  partRawsDeleted: Array<{ session: string; seq: number }> = [];
  partRawsDue: LivePartRawDue[] = [];
  partRawsDueError: Error | null = null;

  private watchPart(room: string, egress: string) {
    const row = this.watch.find((w) => w.roomName === room);
    return { row, part: row?.parts.find((p) => p.egressId === egress) };
  }

  async claimJob(kinds?: MediaJobKind[] | null) {
    this.calls.push('claim');
    this.claimKinds.push(kinds);
    const i = this.queue.findIndex((j) => !kinds || kinds.includes(j.kind));
    return i < 0 ? null : this.queue.splice(i, 1)[0]!;
  }
  async touchJob(_jobId: string, p: number) {
    this.calls.push('progress');
    this.progress.push(p);
    return this.touchResult;
  }
  async inputKeyJobStatuses(keys: string[]) {
    this.lookups.push(keys);
    if (this.lookupError) throw this.lookupError;
    const out = new Map<string, MediaJobStatus[]>();
    for (const r of this.jobRows) {
      if (!keys.includes(r.input_key)) continue;
      out.set(r.input_key, [...(out.get(r.input_key) ?? []), r.status]);
    }
    return out;
  }
  async getLectureNaming(lectureId: string) {
    this.calls.push('naming');
    return { ...this.naming, lectureId };
  }
  async completeLectureTranscode(jobId: string, key: string, durationSec: number | null, size: number) {
    this.calls.push('complete');
    if (this.completeError) throw this.completeError;
    this.completed.push({ jobId, key, durationSec, size });
  }
  async liveJobNaming(_jobId: string) {
    this.calls.push('live_naming');
    return { ...this.liveNaming };
  }
  async createLiveLecture(jobId: string, key: string, durationSec: number | null, size: number, backup: string) {
    this.calls.push('create_live_lecture');
    if (this.completeError) throw this.completeError;
    this.liveCreated.push({ jobId, key, durationSec, size, backup });
    return 'lec-live-1';
  }
  async liveRoomEvent(room: string, event: string, identity: string | null, num: number | null) {
    this.roomEvents.push({ room, event, identity, num });
    if (this.roomEventError) throw this.roomEventError;
    return this.roomEventResult;
  }
  async liveRawsDueForDeletion() {
    if (this.rawsDueError) throw this.rawsDueError;
    return this.rawsDue;
  }
  async markLiveRawDeleted(sessionId: string) {
    this.calls.push('mark_live_raw_deleted');
    if (this.markError) throw this.markError;
    this.markedRawDeleted.push(sessionId);
  }
  async liveSessionRaw(sessionId: string) {
    return this.sessionRaws.get(sessionId) ?? null;
  }
  async staffForToken(jwt: string) {
    if (this.staffError) throw this.staffError;
    return this.tokens.get(jwt) ?? null;
  }
  async failJob(jobId: string, error: string) {
    this.calls.push('fail');
    this.failed.push({ jobId, error });
    return this.failResult;
  }
  async enqueueLiveRecording(room: string, egress: string, raw: string) {
    this.calls.push('enqueue_live_recording');
    if (this.enqueueError) throw this.enqueueError;
    this.enqueued.push({ room, egress, raw });
    const { part } = this.watchPart(room, egress);
    if (part) Object.assign(part, { status: 'complete', rawPath: raw });
    return this.enqueueResult;
  }
  async liveRecordingParts(sessionId: string) {
    this.calls.push('live_recording_parts');
    return (this.parts.get(sessionId) ?? []).map((p) => ({ ...p }));
  }
  async liveRecordingWatch() {
    if (this.watchError) throw this.watchError;
    return this.watch.map((w) => ({ ...w, parts: w.parts.map((p) => ({ ...p })) }));
  }
  async registerLiveRecordingPart(
    room: string,
    egress: string,
    raw: string | null,
    status: RegisterPartStatus,
    bytes: number | null,
  ) {
    this.calls.push(`register_part:${status}`);
    if (this.registerError && (!this.registerErrorStatus || this.registerErrorStatus === status)) throw this.registerError;
    this.registered.push({ room, egress, raw, status, bytes });
    const { row, part } = this.watchPart(room, egress);
    if (part) Object.assign(part, { status, rawPath: raw });
    else row?.parts.push({ seq: row.parts.length + 1, egressId: egress, status, rawPath: raw, startedAt: null });
    return this.registerResult;
  }
  async settleLiveRecording(sessionId: string) {
    this.settled.push(sessionId);
    return this.settleResult;
  }
  async markLivePartBackedUp(session: string, seq: number, key: string) {
    this.calls.push('mark_part_backed_up');
    if (this.partBackupError) throw this.partBackupError;
    this.partBackups.push({ session, seq, key });
  }
  async markLivePartRawDeleted(session: string, seq: number) {
    this.calls.push('mark_part_raw_deleted');
    if (this.markError) throw this.markError;
    this.partRawsDeleted.push({ session, seq });
  }
  async livePartRawsDueForDeletion() {
    if (this.partRawsDueError) throw this.partRawsDueError;
    return this.partRawsDue;
  }
}
