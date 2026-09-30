/**
 * Staff side of «البث المباشر» (V23 P6 — PLAN_LIVE_V23 §8). The admin screen
 * app/admin/live.tsx and the live items of «المحاضرات الواردة».
 *
 *  - admin_live_overview (0143)      live now · green/scheduled · recent with the
 *                                    recording job (content managers + sheikhs;
 *                                    a sheikh sees his own scheduled/recent ones)
 *  - admin_live_inbox (0143)         needs_title live drafts + recordings still
 *                                    being compressed (content managers)
 *  - get_live_interventions (0143)   who spoke and when (D2: real names, staff only)
 *  - admin_save_live_lecture (0143)  finalize_live_lecture (0138) + optional
 *                                    publish (with / without notification) in
 *                                    ONE transaction
 *  - retry_live_recording (0138)     after a failed recording job
 *  - the media worker's staff download `GET /recordings/:sessionId` (Bearer
 *    user JWT, admin | publisher). It streams the local raw, or 302s to a
 *    10-minute presigned R2 URL of the `live-raw/` backup once the local raw is
 *    gone. Base URL: EXPO_PUBLIC_MEDIA_WORKER_URL (its Cloudflare tunnel host).
 *
 * The 0143 RPCs are not in database.generated.ts yet → `as never` (same debt as
 * broadcasts/buddy). Creating / cancelling a session reuses src/api/live.ts.
 */
import { Platform } from 'react-native';

import { isLiveStatus, liveControl, type LiveStatus } from '@/api/live';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LiveJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface LiveAdminJob {
  id: string;
  status: LiveJobStatus;
  /** 0..1 (worker-reported). */
  progress: number;
  attempts: number;
  /** Content managers only (null for a sheikh). */
  error: string | null;
}

export interface LiveAdminSession {
  id: string;
  title: string;
  status: LiveStatus;
  sectionId: string;
  sectionTitle: string | null;
  sheikhId: string | null;
  sheikhName: string | null;
  hostUserId: string | null;
  hostName: string | null;
  /** The caller hosts it (→ may open its green room). */
  isMine: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  shareCode: string;
  peakListeners: number;
  /** In the room now (green/live only). */
  attendees: number;
  lectureId: string | null;
  lectureStatus: 'draft' | 'published' | null;
  /** The draft still waits for «العنوان النهائي والشيخ» in «الواردة». */
  lectureNeedsTitle: boolean;
  durationSec: number | null;
  /** The raw is still on the VPS disk. */
  rawLocal: boolean;
  /** The raw has an R2 backup (kept forever). */
  rawBackup: boolean;
  job: LiveAdminJob | null;
}

export interface LiveAdminOverview {
  active: LiveAdminSession[];
  scheduled: LiveAdminSession[];
  recent: LiveAdminSession[];
  isManager: boolean;
  /** app_config.live_enabled (0145); null from a server without the flag. */
  liveEnabled: 'off' | 'staff' | 'all' | null;
}

export interface LiveInboxDraft {
  lectureId: string;
  /** The preliminary title (= the session title until finalized). */
  title: string;
  sectionId: string | null;
  sectionTitle: string | null;
  order: number | null;
  sheikhId: string | null;
  suggestedSheikhId: string | null;
  suggestedSheikhName: string | null;
  durationSec: number | null;
  createdAt: string | null;
  notifyOnPublish: boolean;
  sessionId: string | null;
  sessionTitle: string | null;
  startedAt: string | null;
  endedAt: string | null;
  peakListeners: number;
}

export interface LiveInbox {
  drafts: LiveInboxDraft[];
  /** Sessions whose recording is still on its way (or failed). */
  pending: LiveAdminSession[];
}

export interface LiveInterventionStint {
  fromAt: string;
  toAt: string | null;
  /** Offset from the start of the broadcast (≈ the recording). */
  fromSec: number | null;
  toSec: number | null;
}

export interface LiveIntervention {
  identity: string;
  /** The REAL name (D2), even for a sister who chose «بدون اسم». */
  displayName: string;
  hiddenName: boolean;
  gender: 'm' | 'f';
  role: string;
  spokeSeconds: number;
  stints: LiveInterventionStint[];
}

// ─── Mapping (exported for tests) ───────────────────────────────────────────

type Raw = Record<string, unknown>;

const str = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 ? x : null);

function num(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
}

const count = (x: unknown): number => {
  const n = num(x);
  return n !== null && n > 0 ? Math.floor(n) : 0;
};

const JOB_STATUSES: readonly LiveJobStatus[] = ['queued', 'running', 'done', 'failed'];

function mapJob(raw: unknown): LiveAdminJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = str(r.id);
  if (!id) return null;
  const status = JOB_STATUSES.includes(r.status as LiveJobStatus) ? (r.status as LiveJobStatus) : 'queued';
  const p = num(r.progress) ?? 0;
  return {
    id,
    status,
    progress: Math.min(1, Math.max(0, p)),
    attempts: count(r.attempts),
    error: str(r.error),
  };
}

export function mapLiveAdminSession(raw: unknown): LiveAdminSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = str(r.id);
  if (!id) return null;
  const lectureStatus = r.lecture_status === 'published' || r.lecture_status === 'draft' ? r.lecture_status : null;
  return {
    id,
    title: str(r.title) ?? '',
    status: isLiveStatus(r.status) ? r.status : 'ended',
    sectionId: str(r.section_id) ?? '',
    sectionTitle: str(r.section_title),
    sheikhId: str(r.sheikh_id),
    sheikhName: str(r.sheikh_name),
    hostUserId: str(r.host_user_id),
    hostName: str(r.host_name),
    isMine: r.is_mine === true,
    scheduledAt: str(r.scheduled_at),
    startedAt: str(r.started_at),
    endedAt: str(r.ended_at),
    createdAt: str(r.created_at),
    shareCode: str(r.share_code) ?? '',
    peakListeners: count(r.peak_listeners),
    attendees: count(r.attendees),
    lectureId: str(r.lecture_id),
    lectureStatus,
    lectureNeedsTitle: r.lecture_needs_title === true,
    durationSec: num(r.duration_sec),
    rawLocal: r.raw_local === true,
    rawBackup: r.raw_backup === true,
    job: mapJob(r.job),
  };
}

function list<T>(x: unknown, map: (r: unknown) => T | null): T[] {
  if (!Array.isArray(x)) return [];
  const out: T[] = [];
  for (const r of x) {
    const m = map(r);
    if (m) out.push(m);
  }
  return out;
}

export function mapLiveAdminOverview(data: unknown): LiveAdminOverview {
  const j = (data && typeof data === 'object' ? data : {}) as Raw;
  return {
    active: list(j.active, mapLiveAdminSession),
    scheduled: list(j.scheduled, mapLiveAdminSession),
    recent: list(j.recent, mapLiveAdminSession),
    isManager: j.is_manager === true,
    liveEnabled: j.live_enabled === 'off' || j.live_enabled === 'staff' || j.live_enabled === 'all' ? j.live_enabled : null,
  };
}

export function mapLiveInboxDraft(raw: unknown): LiveInboxDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const lectureId = str(r.lecture_id);
  if (!lectureId) return null;
  return {
    lectureId,
    title: str(r.title) ?? '',
    sectionId: str(r.section_id),
    sectionTitle: str(r.section_title),
    order: num(r.order),
    sheikhId: str(r.sheikh_id),
    suggestedSheikhId: str(r.suggested_sheikh_id),
    suggestedSheikhName: str(r.suggested_sheikh_name),
    durationSec: num(r.duration_sec),
    createdAt: str(r.created_at),
    notifyOnPublish: r.notify_on_publish !== false,
    sessionId: str(r.session_id),
    sessionTitle: str(r.session_title),
    startedAt: str(r.started_at),
    endedAt: str(r.ended_at),
    peakListeners: count(r.peak_listeners),
  };
}

export function mapLiveInbox(data: unknown): LiveInbox {
  const j = (data && typeof data === 'object' ? data : {}) as Raw;
  return {
    drafts: list(j.drafts, mapLiveInboxDraft),
    pending: list(j.pending, mapLiveAdminSession),
  };
}

function mapStint(raw: unknown): LiveInterventionStint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const fromAt = str(r.from_at);
  if (!fromAt) return null;
  return { fromAt, toAt: str(r.to_at), fromSec: num(r.from_sec), toSec: num(r.to_sec) };
}

export function mapLiveIntervention(raw: unknown): LiveIntervention | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const identity = str(r.identity);
  if (!identity) return null;
  return {
    identity,
    displayName: str(r.display_name) ?? '',
    hiddenName: r.hidden_name === true,
    gender: r.gender === 'f' ? 'f' : 'm',
    role: str(r.role) ?? 'listener',
    spokeSeconds: count(r.spoke_seconds),
    stints: list(r.stints, mapStint),
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** admin_live_overview (0143) — live now, green/scheduled, the latest ended ones. */
export async function getLiveAdminOverview(recent = 20): Promise<LiveAdminOverview> {
  const { data, error } = await supabase.rpc('admin_live_overview' as never, { p_recent: recent } as never);
  if (error) throw error;
  return mapLiveAdminOverview(data);
}

/** admin_live_inbox (0143) — the live items of «المحاضرات الواردة». */
export async function getLiveInbox(): Promise<LiveInbox> {
  const { data, error } = await supabase.rpc('admin_live_inbox' as never);
  if (error) throw error;
  return mapLiveInbox(data);
}

/** get_live_interventions (0143) — who spoke and when, real names (D2). */
export async function getLiveInterventions(sessionId: string): Promise<LiveIntervention[]> {
  const { data, error } = await supabase.rpc('get_live_interventions' as never, { p_session: sessionId } as never);
  if (error) throw error;
  return list(data, mapLiveIntervention);
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export interface SaveLiveLectureInput {
  lectureId: string;
  title: string;
  sheikhId: string;
  /** «تغيير» the section — null keeps the one the recording landed in. */
  sectionId?: string | null;
  /** false = «حفظ دون نشر». */
  publish: boolean;
  /** false = «نشر بدون إشعار» (0123). Ignored when not publishing. */
  notify: boolean;
}

/** admin_save_live_lecture (0143): finalize (+ publish) atomically. */
export async function saveLiveLecture(input: SaveLiveLectureInput): Promise<void> {
  const { error } = await supabase.rpc('admin_save_live_lecture' as never, {
    p_lecture: input.lectureId,
    p_title: input.title.trim(),
    p_sheikh: input.sheikhId,
    p_section: input.sectionId ?? null,
    p_publish: input.publish,
    p_notify: input.notify,
  } as never);
  if (error) throw error;
}

/** retry_live_recording (0138) — content managers, after the job failed for good. */
export async function retryLiveRecording(sessionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('retry_live_recording', { p_session: sessionId });
  if (error) throw error;
  return data as string;
}

/**
 * «إنهاء البث للجميع» from the staff screen — live-control `end` (the host or a
 * content manager; liveRules authorizeLiveAction). Works from the browser too:
 * an admin can end a forgotten live without joining the room. The server stops
 * the recording, closes the room for everyone and the recording goes on to the
 * section as usual. Reuses live.ts `liveControl` — the same functions.invoke
 * with a 20 s fetch timeout under a hard deadline (withDeadline), so a stuck
 * auth lock can never leave the button spinning. Throws LiveControlError
 * (`code`: forbidden | invalid_state | network …) — map with controlErrorText.
 */
export async function endLiveSession(sessionId: string): Promise<void> {
  await liveControl('end', { sessionId });
}

// ─── Raw recording download (media worker) ───────────────────────────────────

/** An Arabic, admin-facing download failure. */
export class RawDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawDownloadError';
    Object.setPrototypeOf(this, RawDownloadError.prototype);
  }
}

export const RAW_DOWNLOAD_COPY = {
  notConfigured: 'لم يُضبط عنوان خادم التسجيلات بعد',
  unauthorized: 'انتهت الجلسة. سجّل الدخول من جديد ثم حاول',
  forbidden: 'لا تملك صلاحية تنزيل التسجيل الأصلي',
  notFound: 'لم يُعثر على التسجيل الأصلي لهذا المجلس',
  unavailable: 'خادم التسجيلات غير متاح الآن، حاول بعد قليل',
  network: 'تعذّر التنزيل. تحقّق من الاتصال ثم حاول مرة أخرى',
} as const;

/** The worker's public base URL (no trailing slash), or null when not configured. */
export function mediaWorkerBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_MEDIA_WORKER_URL;
  if (!raw || !/^https?:\/\//i.test(raw.trim())) return null;
  return raw.trim().replace(/\/+$/, '');
}

/** `GET /recordings/:sessionId` on the worker, or null when not configured. */
export function rawRecordingUrl(sessionId: string): string | null {
  const base = mediaWorkerBaseUrl();
  return base ? `${base}/recordings/${encodeURIComponent(sessionId)}` : null;
}

export function rawDownloadErrorText(status: number): string {
  if (status === 401) return RAW_DOWNLOAD_COPY.unauthorized;
  if (status === 403) return RAW_DOWNLOAD_COPY.forbidden;
  if (status === 404) return RAW_DOWNLOAD_COPY.notFound;
  return RAW_DOWNLOAD_COPY.unavailable;
}

/** A file name the OS accepts: «التسجيل الأصلي - {title}.ogg». */
export function rawFileName(title: string): string {
  const safe = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `التسجيل الأصلي - ${safe || 'مجلس'}.ogg`;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RawDownloadError(RAW_DOWNLOAD_COPY.unauthorized);
  return token;
}

/**
 * Download a session's ORIGINAL recording (staff: admin | publisher).
 *  - web: fetch with the user JWT (the worker streams it, or 302s to the R2
 *    backup — fetch follows it) → Blob → a save-as via a temporary <a download>.
 *  - native: downloaded into the cache, then the system share sheet («حفظ في…»).
 */
export async function downloadRawRecording(sessionId: string, title: string): Promise<void> {
  const url = rawRecordingUrl(sessionId);
  if (!url) throw new RawDownloadError(RAW_DOWNLOAD_COPY.notConfigured);
  const token = await accessToken();
  const name = rawFileName(title);

  if (Platform.OS === 'web') {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' });
    } catch {
      throw new RawDownloadError(RAW_DOWNLOAD_COPY.network);
    }
    if (!res.ok) throw new RawDownloadError(rawDownloadErrorText(res.status));
    let blob: Blob;
    try {
      blob = await res.blob();
    } catch {
      throw new RawDownloadError(RAW_DOWNLOAD_COPY.network);
    }
    const href = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    }
    return;
  }

  // Native: lazy-required so the web bundle / jest never load the native modules.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const dest = new File(Paths.cache, name);
  try {
    if (dest.exists) dest.delete();
    await File.downloadFileAsync(url, dest, {
      headers: { Authorization: `Bearer ${token}` },
      idempotent: true,
    });
  } catch (e) {
    const m = /status(?:\s*code)?[:\s]+(\d{3})/i.exec(String((e as Error)?.message ?? ''));
    throw new RawDownloadError(m ? rawDownloadErrorText(Number(m[1])) : RAW_DOWNLOAD_COPY.network);
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dest.uri, { mimeType: 'audio/ogg', dialogTitle: name });
  }
}
