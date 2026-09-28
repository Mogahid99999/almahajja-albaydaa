// In-memory fakes for the injected job dependencies (no network, no ffmpeg).

import { readFile, writeFile } from 'node:fs/promises';
import type { FailOutcome, JobDb, LectureNaming, MediaJob, MediaJobKind, MediaJobStatus } from '../src/db.js';
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
  uploads: Array<{ key: string; contentType: string }> = [];
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
    const body = await readFile(path);
    this.objects.set(key, body);
    this.uploads.push({ key, contentType });
    o?.onFraction?.(1);
    return body.length;
  }

  async exists(key: string): Promise<boolean> {
    this.existsChecks.push(key);
    return this.objects.has(key);
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

  async probeDuration(): Promise<number | null> {
    return this.duration;
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
  liveCreated: Array<{ jobId: string; key: string }> = [];
  failed: Array<{ jobId: string; error: string }> = [];
  enqueued: Array<{ room: string; egress: string; raw: string }> = [];
  queue: MediaJob[] = [];
  failResult: FailOutcome = 'retry';
  completeError: Error | null = null;
  enqueueError: Error | null = null;
  naming: LectureNaming = { lectureId: 'lec-1', title: 'الدرس الأول', sectionTitle: 'كتاب التوحيد' };

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
  async createLiveLecture(jobId: string, key: string) {
    this.calls.push('create_live_lecture');
    this.liveCreated.push({ jobId, key });
    return 'lec-live-1';
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
  }
}
