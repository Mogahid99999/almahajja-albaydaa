// Supabase (service role) access — the worker's only view of Postgres.
// Contract: media_jobs migrations (0133_media_jobs_refine: p_kinds claim filter,
// touch_media_job, fail → 'ignored') + P2 live RPCs (see below).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type MediaJobKind = 'lecture_transcode' | 'live_recording';
export type MediaJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface MediaJob {
  id: string;
  kind: MediaJobKind;
  status: MediaJobStatus;
  progress: number;
  input_key: string;
  output_key: string | null;
  lecture_id: string | null;
  live_session_id: string | null;
  attempts: number;
  error: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  not_before: string | null;
  /** 0133: complete_lecture_transcode publishes the lecture server-side when set. */
  publish_on_done?: boolean;
}

export interface LectureNaming {
  lectureId: string;
  title: string;
  /** Title of the lecture's own section (the R2 folder), null when unclassified. */
  sectionTitle: string | null;
}

/** 'ignored' = the job was no longer running (someone else finished/cancelled it). */
export type FailOutcome = 'retry' | 'failed' | 'ignored';

export interface JobDb {
  /** 0 or 1 job, already marked running by the RPC. `kinds` null/omitted = any kind. */
  claimJob(kinds?: MediaJobKind[] | null): Promise<MediaJob | null>;
  /**
   * `touch_media_job`: progress + heartbeat_at = now(), only while the job is
   * running. false → the job is no longer ours (abort cleanly, don't fail it).
   */
  touchJob(jobId: string, progress: number): Promise<boolean>;
  getLectureNaming(lectureId: string): Promise<LectureNaming>;
  completeLectureTranscode(jobId: string, outputKey: string, durationSec: number | null, sizeBytes: number): Promise<void>;
  /** P2 — RPC pending (`create_live_lecture`). Returns the new lecture id. */
  createLiveLecture(jobId: string, outputKey: string, durationSec: number | null, sizeBytes: number): Promise<string>;
  failJob(jobId: string, error: string): Promise<FailOutcome>;
  /** P2 — RPC pending (`enqueue_live_recording`). */
  enqueueLiveRecording(roomName: string, egressId: string, rawKey: string): Promise<void>;
  /** Status of every job whose input_key is one of `keys` (keys with no job are absent). */
  inputKeyJobStatuses(keys: string[]): Promise<Map<string, MediaJobStatus[]>>;
}

const REQUEST_TIMEOUT_MS = 30_000;

/** fetch with a hard timeout so a hung PostgREST call can't wedge the loop. */
const timedFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

function fail(op: string, error: { message?: string; code?: string } | null): never {
  const code = error?.code ? ` [${error.code}]` : '';
  throw new Error(`${op} failed${code}: ${error?.message ?? 'unknown error'}`);
}

const roundSec = (d: number | null) => (d === null ? null : Math.max(0, Math.round(d)));

export function createSupabaseDb(url: string, serviceRoleKey: string): JobDb {
  const sb: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  });

  return {
    async claimJob(kinds) {
      const { data, error } = await sb.rpc('claim_media_job', kinds && kinds.length ? { p_kinds: kinds } : {});
      if (error) fail('claim_media_job', error);
      const row = (Array.isArray(data) ? data[0] : data) as MediaJob | null | undefined;
      return row && row.id ? row : null;
    },

    async touchJob(jobId, progress) {
      const { data, error } = await sb.rpc('touch_media_job', { p_job: jobId, p_progress: progress });
      if (error) fail('touch_media_job', error);
      return data === true;
    },

    async getLectureNaming(lectureId) {
      const { data: lecture, error } = await sb
        .from('lectures')
        .select('id, title, section_id')
        .eq('id', lectureId)
        .maybeSingle();
      if (error) fail('lecture lookup', error);
      if (!lecture) throw new Error(`lecture ${lectureId} not found`);
      let sectionTitle: string | null = null;
      if (lecture.section_id) {
        const { data: section, error: sErr } = await sb
          .from('sections')
          .select('title')
          .eq('id', lecture.section_id)
          .maybeSingle();
        if (sErr) fail('section lookup', sErr);
        sectionTitle = (section?.title as string | undefined) ?? null;
      }
      return { lectureId, title: lecture.title as string, sectionTitle };
    },

    async completeLectureTranscode(jobId, outputKey, durationSec, sizeBytes) {
      const { error } = await sb.rpc('complete_lecture_transcode', {
        p_job: jobId,
        p_output_key: outputKey,
        p_duration_sec: roundSec(durationSec),
        p_size_bytes: sizeBytes,
      });
      if (error) fail('complete_lecture_transcode', error);
    },

    // P2 — RPC pending: create_live_lecture(p_job, p_output_key, p_duration_sec, p_size_bytes) returns uuid.
    async createLiveLecture(jobId, outputKey, durationSec, sizeBytes) {
      const { data, error } = await sb.rpc('create_live_lecture', {
        p_job: jobId,
        p_output_key: outputKey,
        p_duration_sec: roundSec(durationSec),
        p_size_bytes: sizeBytes,
      });
      if (error) fail('create_live_lecture', error);
      return String(data);
    },

    async failJob(jobId, message) {
      const { data, error } = await sb.rpc('fail_media_job', { p_job: jobId, p_error: message });
      if (error) fail('fail_media_job', error);
      if (data === 'retry' || data === 'failed' || data === 'ignored') return data;
      throw new Error(`fail_media_job returned unexpected ${JSON.stringify(data)}`);
    },

    // P2 — RPC pending: enqueue_live_recording(p_room_name, p_egress_id, p_raw_key).
    async enqueueLiveRecording(roomName, egressId, rawKey) {
      const { error } = await sb.rpc('enqueue_live_recording', {
        p_room_name: roomName,
        p_egress_id: egressId,
        p_raw_key: rawKey,
      });
      if (error) fail('enqueue_live_recording', error);
    },

    async inputKeyJobStatuses(keys) {
      const found = new Map<string, MediaJobStatus[]>();
      if (!keys.length) return found;
      // Page through the rows: PostgREST caps responses (max_rows), and a
      // truncated answer here would make a referenced original look orphaned.
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
          .from('media_jobs')
          .select('id, input_key, status')
          .in('input_key', keys)
          .order('id')
          .range(from, from + PAGE - 1);
        if (error) fail('media_jobs input_key lookup', error);
        const rows = (data ?? []) as Array<{ input_key: string; status: MediaJobStatus }>;
        for (const r of rows) {
          const list = found.get(r.input_key);
          if (list) list.push(r.status);
          else found.set(r.input_key, [r.status]);
        }
        if (rows.length < PAGE) return found;
      }
    },
  };
}
