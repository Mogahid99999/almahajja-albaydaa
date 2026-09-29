// Supabase (service role) access — the worker's only view of Postgres.
// Contract: media_jobs migrations (0133_media_jobs_refine: p_kinds claim filter,
// touch_media_job, fail → 'ignored') + P2 live RPCs (see below) + 0146 recording
// parts (live_recording_parts, register_live_recording_part, live_recording_watch,
// settle_live_recording, mark_live_part_backed_up / _raw_deleted,
// live_part_raws_due_for_deletion).

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

/** `live_job_naming(p_job)` — where a live recording's MP3 goes. */
export interface LiveNaming {
  sectionTitle: string | null;
  title: string;
  roomName: string;
}

/** `live_room_event(...)` jsonb result; null when the room has no session. */
export interface RoomEventResult {
  sessionId: string;
  status: string;
  isHost: boolean;
  hostPresent: boolean;
}

/** One row of `live_raws_due_for_deletion()`. */
export interface LiveRawDue {
  sessionId: string;
  rawPath: string;
  rawBackupKey: string | null;
}

/** The raw-recording columns of one live_sessions row. */
export interface LiveSessionRaw {
  /** Local raw on the VPS disk; null once deleted (raw_deleted_at) or never set. */
  rawPath: string | null;
  /** R2 copy (live-raw/<basename>), kept forever; null when not backed up yet. */
  rawBackupKey: string | null;
}

export interface StaffIdentity {
  userId: string;
  role: string | null;
}

/** live_recording_parts.status (0146). */
export type PartStatus = 'recording' | 'dead' | 'complete' | 'recovered' | 'lost';
/** What the worker may register (0146 register_live_recording_part). */
export type RegisterPartStatus = Exclude<PartStatus, 'recording'>;

/** One egress of a live session (0146 live_recording_parts), seq order = audio order. */
export interface LiveRecordingPart {
  seq: number;
  egressId: string;
  status: PartStatus;
  rawPath: string | null;
  rawBackupKey: string | null;
  rawDeletedAt: string | null;
  startedAt: string | null;
}

/** One row of `live_recording_watch()` (0146): a live session, or an ended one still without its job. */
export interface LiveRecordingWatch {
  sessionId: string;
  roomName: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  hasJob: boolean;
  parts: Array<Pick<LiveRecordingPart, 'seq' | 'egressId' | 'status' | 'rawPath' | 'startedAt'>>;
}

/** One row of `live_part_raws_due_for_deletion()` (0146). */
export interface LivePartRawDue {
  sessionId: string;
  seq: number;
  rawPath: string;
  rawBackupKey: string | null;
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
  failJob(jobId: string, error: string): Promise<FailOutcome>;

  // ---- P2 live (service-role RPCs, 0138) ----
  liveJobNaming(jobId: string): Promise<LiveNaming>;
  /** Returns the lecture id. */
  createLiveLecture(
    jobId: string,
    outputKey: string,
    durationSec: number | null,
    sizeBytes: number,
    rawBackupKey: string,
  ): Promise<string>;
  /** Job id, or null while the session is still live (the job starts at end). */
  enqueueLiveRecording(roomName: string, egressId: string, rawPath: string): Promise<string | null>;
  liveRoomEvent(
    roomName: string,
    event: string,
    identity: string | null,
    numParticipants: number | null,
  ): Promise<RoomEventResult | null>;
  liveRawsDueForDeletion(): Promise<LiveRawDue[]>;
  markLiveRawDeleted(sessionId: string): Promise<void>;
  /** live_sessions.raw_path (unless deleted) + raw_backup_key in one read; null when no such session. */
  liveSessionRaw(sessionId: string): Promise<LiveSessionRaw | null>;
  /** Verify a user JWT (auth.getUser) and read profiles.role; null when the token is invalid. */
  staffForToken(jwt: string): Promise<StaffIdentity | null>;
  /** Status of every job whose input_key is one of `keys` (keys with no job are absent). */
  inputKeyJobStatuses(keys: string[]): Promise<Map<string, MediaJobStatus[]>>;

  // ---- 0146 recording parts (egress crash recovery) ----
  /** The session's parts in seq order; [] for a pre-0146 session (single raw = job.input_key). */
  liveRecordingParts(sessionId: string): Promise<LiveRecordingPart[]>;
  liveRecordingWatch(): Promise<LiveRecordingWatch[]>;
  /** register_live_recording_part → the session's job id, or null while it must wait. */
  registerLiveRecordingPart(
    roomName: string,
    egressId: string,
    rawPath: string | null,
    status: RegisterPartStatus,
    bytes: number | null,
  ): Promise<string | null>;
  /** settle_live_recording: queue the job or fail the session loudly (never stuck `ended`). */
  settleLiveRecording(sessionId: string): Promise<string | null>;
  markLivePartBackedUp(sessionId: string, seq: number, backupKey: string): Promise<void>;
  markLivePartRawDeleted(sessionId: string, seq: number): Promise<void>;
  livePartRawsDueForDeletion(): Promise<LivePartRawDue[]>;
}

const PART_STATUSES = new Set<PartStatus>(['recording', 'dead', 'complete', 'recovered', 'lost']);

function partStatus(v: unknown): PartStatus {
  if (typeof v === 'string' && PART_STATUSES.has(v as PartStatus)) return v as PartStatus;
  throw new Error(`unexpected recording part status ${JSON.stringify(v)}`);
}

/** PostgREST "relation does not exist" — 0146 not applied yet (→ the pre-0146 single-raw path). */
function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01';
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
    async liveJobNaming(jobId) {
      const { data, error } = await sb.rpc('live_job_naming', { p_job: jobId });
      if (error) fail('live_job_naming', error);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { section_title?: string | null; title?: string | null; room_name?: string | null }
        | null
        | undefined;
      if (!row) throw new Error(`live_job_naming returned nothing for job ${jobId}`);
      return { sectionTitle: row.section_title ?? null, title: row.title ?? '', roomName: row.room_name ?? '' };
    },

    async createLiveLecture(jobId, outputKey, durationSec, sizeBytes, rawBackupKey) {
      const { data, error } = await sb.rpc('create_live_lecture', {
        p_job: jobId,
        p_output_key: outputKey,
        p_duration_sec: roundSec(durationSec),
        p_size_bytes: sizeBytes,
        p_raw_backup_key: rawBackupKey,
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

    // enqueue_live_recording(p_room_name, p_egress_id, p_raw_path) — 0138.
    async enqueueLiveRecording(roomName, egressId, rawPath) {
      const { data, error } = await sb.rpc('enqueue_live_recording', {
        p_room_name: roomName,
        p_egress_id: egressId,
        p_raw_path: rawPath,
      });
      if (error) fail('enqueue_live_recording', error);
      return data ? String(data) : null;
    },

    async liveRoomEvent(roomName, event, identity, numParticipants) {
      const { data, error } = await sb.rpc('live_room_event', {
        p_room_name: roomName,
        p_event: event,
        p_identity: identity,
        p_num_participants: numParticipants,
      });
      if (error) fail('live_room_event', error);
      const r = data as { session_id?: string | null; status?: string; is_host?: boolean; host_present?: boolean } | null;
      if (!r || !r.session_id) return null;
      return {
        sessionId: r.session_id,
        status: String(r.status ?? ''),
        isHost: r.is_host === true,
        hostPresent: r.host_present === true,
      };
    },

    async liveRawsDueForDeletion() {
      const { data, error } = await sb.rpc('live_raws_due_for_deletion');
      if (error) fail('live_raws_due_for_deletion', error);
      const rows = (data ?? []) as Array<{ session_id: string; raw_path: string; raw_backup_key: string | null }>;
      return rows.map((r) => ({ sessionId: r.session_id, rawPath: r.raw_path, rawBackupKey: r.raw_backup_key ?? null }));
    },

    async markLiveRawDeleted(sessionId) {
      const { error } = await sb.rpc('mark_live_raw_deleted', { p_session: sessionId });
      if (error) fail('mark_live_raw_deleted', error);
    },

    async liveSessionRaw(sessionId) {
      const { data, error } = await sb
        .from('live_sessions')
        .select('raw_path, raw_backup_key, raw_deleted_at')
        .eq('id', sessionId)
        .maybeSingle();
      if (error) fail('live_sessions lookup', error);
      const row = data as { raw_path: string | null; raw_backup_key: string | null; raw_deleted_at: string | null } | null;
      if (!row) return null;
      return {
        rawPath: row.raw_deleted_at ? null : (row.raw_path ?? null),
        rawBackupKey: row.raw_backup_key ?? null,
      };
    },

    async staffForToken(jwt) {
      const { data, error } = await sb.auth.getUser(jwt);
      if (error) {
        // 4xx = the token is bad (→ 401); anything else (network, 5xx) is ours (→ 503).
        const status = (error as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) return null;
        throw new Error(`auth.getUser failed: ${error.message}`);
      }
      if (!data.user) return null;
      const { data: profile, error: pErr } = await sb
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();
      if (pErr) fail('profiles lookup', pErr);
      return { userId: data.user.id, role: (profile?.role as string | undefined) ?? null };
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

    async liveRecordingParts(sessionId) {
      const { data, error } = await sb
        .from('live_recording_parts')
        .select('seq, egress_id, status, raw_path, raw_backup_key, raw_deleted_at, started_at')
        .eq('session_id', sessionId)
        .order('seq');
      if (error) {
        if (isMissingRelation(error)) return [];
        fail('live_recording_parts lookup', error);
      }
      const rows = (data ?? []) as Array<{
        seq: number;
        egress_id: string;
        status: string;
        raw_path: string | null;
        raw_backup_key: string | null;
        raw_deleted_at: string | null;
        started_at: string | null;
      }>;
      return rows.map((r) => ({
        seq: Number(r.seq),
        egressId: r.egress_id,
        status: partStatus(r.status),
        rawPath: r.raw_path ?? null,
        rawBackupKey: r.raw_backup_key ?? null,
        rawDeletedAt: r.raw_deleted_at ?? null,
        startedAt: r.started_at ?? null,
      }));
    },

    async liveRecordingWatch() {
      const { data, error } = await sb.rpc('live_recording_watch');
      if (error) fail('live_recording_watch', error);
      const rows = (data ?? []) as Array<{
        session_id: string;
        room_name: string;
        status: string;
        started_at: string | null;
        ended_at: string | null;
        has_job: boolean;
        parts: Array<{ seq: number; egress_id: string; status: string; raw_path: string | null; started_at: string | null }> | null;
      }>;
      return rows.map((r) => ({
        sessionId: r.session_id,
        roomName: r.room_name,
        status: String(r.status),
        startedAt: r.started_at ?? null,
        endedAt: r.ended_at ?? null,
        hasJob: r.has_job === true,
        parts: (r.parts ?? []).map((p) => ({
          seq: Number(p.seq),
          egressId: p.egress_id,
          status: partStatus(p.status),
          rawPath: p.raw_path ?? null,
          startedAt: p.started_at ?? null,
        })),
      }));
    },

    async registerLiveRecordingPart(roomName, egressId, rawPath, status, bytes) {
      const { data, error } = await sb.rpc('register_live_recording_part', {
        p_room_name: roomName,
        p_egress_id: egressId,
        p_raw_path: rawPath,
        p_status: status,
        p_bytes: bytes,
      });
      if (error) fail('register_live_recording_part', error);
      return data ? String(data) : null;
    },

    async settleLiveRecording(sessionId) {
      const { data, error } = await sb.rpc('settle_live_recording', { p_session: sessionId });
      if (error) fail('settle_live_recording', error);
      return data ? String(data) : null;
    },

    async markLivePartBackedUp(sessionId, seq, backupKey) {
      const { error } = await sb.rpc('mark_live_part_backed_up', {
        p_session: sessionId,
        p_seq: seq,
        p_backup_key: backupKey,
      });
      if (error) fail('mark_live_part_backed_up', error);
    },

    async markLivePartRawDeleted(sessionId, seq) {
      const { error } = await sb.rpc('mark_live_part_raw_deleted', { p_session: sessionId, p_seq: seq });
      if (error) fail('mark_live_part_raw_deleted', error);
    },

    async livePartRawsDueForDeletion() {
      const { data, error } = await sb.rpc('live_part_raws_due_for_deletion');
      if (error) fail('live_part_raws_due_for_deletion', error);
      const rows = (data ?? []) as Array<{ session_id: string; seq: number; raw_path: string; raw_backup_key: string | null }>;
      return rows.map((r) => ({
        sessionId: r.session_id,
        seq: Number(r.seq),
        rawPath: r.raw_path,
        rawBackupKey: r.raw_backup_key ?? null,
      }));
    },
  };
}
