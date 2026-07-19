/**
 * Backup & Restore — data-access layer (create side, v1).
 *
 * The ONLY place that talks to the backup RPCs (migration 0102) and the
 * backup-media Edge Function. The admin-web screen (app/admin/backup.tsx) and
 * its hook (src/hooks/useBackup.ts) call through here so the screen stays thin.
 *
 * Everything runs in the admin's BROWSER: media flows R2 → browser → ZIP →
 * disk, streamed, never fully buffered in RAM. Edge Functions only mint signed
 * URLs / run the small DB export; the R2 secret never reaches the client.
 *
 * Web-only: the create flow needs WebCrypto + the File System Access API +
 * client-zip's stream. isBackupSupported() gates the UI on native/unsupported
 * browsers.
 */
import { makeZip } from 'client-zip';

import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import {
  APP_VERSION,
  AUTH_USERS_NOTE,
  BACKUP_FORMAT_VERSION,
  CHECKSUM_ALGO,
  SCHEMA_VERSION,
  backupFileName,
  projectRefFromUrl,
  type BackupManifest,
  type BackupMode,
  type SchemaTable,
} from '@/lib/backupFormat';

const EXPORT_PAGE = 2000; // rows per export_table call

// ─── Environment capability check ────────────────────────────────────────────

/** True only where the streaming create flow can actually run (Chrome/Edge). */
export function isBackupSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).showSaveFilePicker === 'function' &&
    typeof crypto !== 'undefined' &&
    !!crypto.subtle &&
    typeof ReadableStream !== 'undefined'
  );
}

// ─── RPC wrappers ────────────────────────────────────────────────────────────

type TableOrderRow = { ord: number; table_name: string };
type CountRow = { table_name: string; row_count: number };
type SeqRow = { seq_name: string; last_value: number };
type ExportRow = { pk: string; row_json: unknown };

export async function backupRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  // Generic runtime-string RPC wrapper (called with many backup RPC names). The
  // backup RPCs ARE in database.generated.ts now (0102/0103 regenerated), but a
  // generic `fn: string` still can't satisfy supabase.rpc's literal-union arg,
  // so the cast stays by design — it's the wrapper shape, not missing types.
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}
const rpc = backupRpc;

export async function getTableOrder(): Promise<string[]> {
  const rows = await rpc<TableOrderRow[]>('backup_table_order');
  return [...rows].sort((a, b) => a.ord - b.ord).map((r) => r.table_name);
}

export async function getTableCounts(): Promise<Record<string, number>> {
  const rows = await rpc<CountRow[]>('export_table_counts');
  const out: Record<string, number> = {};
  for (const r of rows) out[r.table_name] = Number(r.row_count);
  return out;
}

export async function getSequences(): Promise<SeqRow[]> {
  return rpc<SeqRow[]>('export_sequences');
}

/** The table+column shape this backup is taken against (migration 0103). */
export async function getSchemaFingerprint(): Promise<SchemaTable[]> {
  return rpc<SchemaTable[]>('backup_schema_fingerprint');
}

/** One page of a table, keyset-paginated by the opaque `pk` cursor. */
async function exportTablePage(
  table: string,
  after: string | null,
): Promise<ExportRow[]> {
  return rpc<ExportRow[]>('export_table', {
    p_table: table,
    p_after: after,
    p_limit: EXPORT_PAGE,
  });
}

// ─── Media (Edge Function) wrappers ──────────────────────────────────────────

export type MediaObject = { key: string; size: number; etag: string | null };

export async function invokeMedia<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('backup-media', { body });
  if (error) {
    let msg = error.message;
    try {
      const j = await (error as any).context?.json?.();
      if (j?.error) msg = j.error;
    } catch {
      /* keep generic */
    }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

/** Full bucket inventory (live objects only — staging/rollback prefixes excluded). */
export async function listAllMedia(): Promise<MediaObject[]> {
  type ListPage = { objects: MediaObject[]; nextToken: string | null };
  const out: MediaObject[] = [];
  let token: string | null = null;
  do {
    const page: ListPage = await invokeMedia<ListPage>(
      token ? { action: 'list', continuationToken: token } : { action: 'list' },
    );
    out.push(...page.objects);
    token = page.nextToken;
  } while (token);
  return out;
}

async function mediaReadUrl(key: string): Promise<string> {
  const { url } = await invokeMedia<{ url: string }>({ action: 'read', key });
  return url;
}

// ─── backup_log wrappers ─────────────────────────────────────────────────────

export async function backupLogStart(fileName: string): Promise<string> {
  return rpc<string>('backup_log_start', {
    p_operation: 'backup',
    p_file_name: fileName,
  });
}

export async function backupLogUpdate(
  id: string,
  fields: {
    status?: string;
    size_bytes?: number;
    table_counts?: Record<string, number>;
    media_count?: number;
    media_bytes?: number;
    error_code?: string;
    error_message?: string;
    finished?: boolean;
  },
): Promise<void> {
  await rpc('backup_log_update', {
    p_id: id,
    p_status: fields.status ?? null,
    p_size_bytes: fields.size_bytes ?? null,
    p_table_counts: fields.table_counts ?? null,
    p_media_count: fields.media_count ?? null,
    p_media_bytes: fields.media_bytes ?? null,
    p_backup_format_version: BACKUP_FORMAT_VERSION,
    p_schema_version: SCHEMA_VERSION,
    p_app_version: APP_VERSION,
    p_error_code: fields.error_code ?? null,
    p_error_message: fields.error_message ?? null,
    p_finished: fields.finished ?? false,
  });
}

export type BackupLogRow = {
  id: string;
  operation_type: 'backup' | 'restore';
  actor_name: string | null;
  status: string;
  file_name: string | null;
  size_bytes: number | null;
  media_count: number | null;
  restore_mode: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

export async function listBackupLog(limit = 20): Promise<BackupLogRow[]> {
  // backup_log is not in database.generated.ts yet — cast the builder.
  const { data, error } = await (supabase.from('backup_log' as never) as any)
    .select(
      'id, operation_type, actor_name, status, file_name, size_bytes, media_count, restore_mode, error_message, started_at, finished_at',
    )
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as BackupLogRow[];
}

// ─── SHA-256 streaming helper ────────────────────────────────────────────────

export function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(digest);
}

// ─── Progress model ──────────────────────────────────────────────────────────

export interface BackupProgress {
  phase: 'database' | 'media' | 'finalizing' | 'done';
  totalFiles: number;
  doneFiles: number;
  totalBytes: number;
  doneBytes: number;
  currentFile: string;
  startedAt: number;
}

export interface CreateBackupHandle {
  /** Resolves when the ZIP has fully streamed to disk. */
  promise: Promise<{ fileName: string; sizeBytes: number }>;
  /** Cancels the in-flight backup (aborts the disk write + fetches). */
  cancel: () => void;
}

// ─── The create-backup orchestrator ──────────────────────────────────────────

/**
 * Stream a backup ZIP to a file the admin picks. Returns a handle so the UI can
 * show progress (via onProgress) and cancel. Never buffers the whole archive:
 * client-zip pulls each file lazily, and media is fetched → hashed → yielded one
 * object at a time.
 *
 * `mode`:
 *   'full'          — DB tables/data AND every R2 media object.
 *   'database_only' — DB tables/data only; media is NOT listed, fetched, hashed,
 *                     or included. media_count/media_bytes = 0.
 *
 * Order inside the ZIP: manifest.json first is NOT guaranteed by streaming, so
 * we yield database + media, compute checksums as we go, and write
 * checksums.json + manifest.json LAST. That's fine — restore reads the whole
 * archive before acting.
 */
export function createBackup(
  onProgress: (p: BackupProgress) => void,
  mode: BackupMode = 'full',
): CreateBackupHandle {
  const abort = new AbortController();
  const cancel = () => abort.abort();

  const promise = (async () => {
    if (!isBackupSupported()) {
      throw new Error('المتصفح الحالي لا يدعم إنشاء النسخ الاحتياطية. استخدم Chrome أو Edge على جهاز كمبيوتر.');
    }

    const startedAt = Date.now();
    const fileName = backupFileName(new Date(startedAt), mode);

    // 0) Ask the user where to save FIRST (must be inside a user gesture; the
    //    hook calls this synchronously from the button press).
    const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
    });
    const writable = await handle.createWritable();

    // 1) Plan: table order + counts + schema fingerprint. Media inventory ONLY
    //    for a full backup — database_only never lists/touches R2.
    const [tableOrder, tableCounts, sequences, fingerprint, media] = await Promise.all([
      getTableOrder(),
      getTableCounts(),
      getSequences(),
      getSchemaFingerprint(),
      mode === 'full' ? listAllMedia() : Promise.resolve([] as MediaObject[]),
    ]);

    const logId = await backupLogStart(fileName).catch(() => null);

    const mediaBytes = media.reduce((a, m) => a + m.size, 0);
    // total "files": each table jsonl + _sequences + each media + manifest + checksums
    const totalFiles = tableOrder.length + 1 + media.length + 2;
    const totalBytes = mediaBytes; // db bytes unknown ahead of time; media dominates

    const progress: BackupProgress = {
      phase: 'database',
      totalFiles,
      doneFiles: 0,
      totalBytes,
      doneBytes: 0,
      currentFile: '',
      startedAt,
    };
    const emit = () => onProgress({ ...progress });
    emit();

    // checksums collected across the whole archive
    const checksums: Record<string, string> = {};
    const enc = new TextEncoder();

    // Build the async iterable of files for client-zip. Each yielded entry is
    // { name, input } where input is a Uint8Array (db files, small) or a
    // ReadableStream (media, streamed). We compute checksums inline.
    async function* files(): AsyncGenerator<{ name: string; input: Uint8Array | ReadableStream }> {
      // ---- database/<table>.jsonl ----
      progress.phase = 'database';
      emit();
      for (const table of tableOrder) {
        if (abort.signal.aborted) throw new Error('cancelled');
        progress.currentFile = `database/${table}.jsonl`;
        emit();

        // Accumulate JSONL for this table (DB is small relative to media).
        let jsonl = '';
        let after: string | null = null;
        for (;;) {
          const page: ExportRow[] = await exportTablePage(table, after);
          if (page.length === 0) break;
          for (const row of page) jsonl += JSON.stringify(row.row_json) + '\n';
          after = page[page.length - 1].pk;
          if (page.length < EXPORT_PAGE) break;
        }
        const bytes = enc.encode(jsonl);
        checksums[`database/${table}.jsonl`] = await sha256Hex(bytes);
        progress.doneFiles += 1;
        emit();
        yield { name: `database/${table}.jsonl`, input: bytes };
      }

      // ---- database/_sequences.json ----
      {
        const bytes = enc.encode(JSON.stringify(sequences, null, 2));
        checksums['database/_sequences.json'] = await sha256Hex(bytes);
        progress.doneFiles += 1;
        emit();
        yield { name: 'database/_sequences.json', input: bytes };
      }

      // ---- media/<key> ----
      progress.phase = 'media';
      emit();
      for (const obj of media) {
        if (abort.signal.aborted) throw new Error('cancelled');
        progress.currentFile = obj.key;
        emit();

        const url = await mediaReadUrl(obj.key);
        const res = await fetch(url, { signal: abort.signal });
        if (!res.ok) throw new Error(`تعذّر تنزيل الملف ${obj.key} (${res.status}).`);
        // Buffer THIS ONE object to hash it (needed for checksums.json). One
        // media file at a time — bounded by the largest single audio file, not
        // the whole library. Then yield its bytes to the ZIP.
        const buf = new Uint8Array(await res.arrayBuffer());
        checksums[`media/${obj.key}`] = await sha256Hex(buf);
        progress.doneBytes += buf.byteLength;
        progress.doneFiles += 1;
        emit();
        yield { name: `media/${obj.key}`, input: buf };
      }

      // ---- checksums.json + manifest.json (last: depend on media hashes) ----
      progress.phase = 'finalizing';
      progress.currentFile = 'manifest.json';
      emit();

      const checksumsBytes = enc.encode(JSON.stringify(checksums, null, 2));
      yield { name: 'checksums.json', input: checksumsBytes };

      const { data: userData } = await supabase.auth.getUser();
      let actorName: string | null = null;
      if (userData?.user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', userData.user.id)
          .single();
        actorName = prof?.display_name ?? null;
      }

      // Stable hash of the fingerprint (canonical JSON — the RPC already returns
      // tables in FK order and columns in ordinal order, so JSON.stringify is
      // deterministic here).
      const fingerprintHash = await sha256Hex(enc.encode(JSON.stringify(fingerprint)));

      const manifest: BackupManifest = {
        backup_format_version: BACKUP_FORMAT_VERSION,
        schema_version: SCHEMA_VERSION,
        app_version: APP_VERSION,
        created_at: new Date().toISOString(),
        backup_started_at: new Date(startedAt).toISOString(),
        backup_finished_at: new Date().toISOString(),
        source_project_id: projectRefFromUrl(env.supabaseUrl),
        actor: { id: userData?.user?.id ?? null, name: actorName },
        table_counts: tableCounts,
        media_count: media.length,
        media_bytes: mediaBytes,
        checksum_algorithm: CHECKSUM_ALGO,
        encryption: 'none',
        backup_mode: mode,
        schema_fingerprint: fingerprint,
        schema_fingerprint_sha256: fingerprintHash,
        consistency_model: 'per-table',
        auth_users_note: AUTH_USERS_NOTE,
      };
      const manifestBytes = enc.encode(JSON.stringify(manifest, null, 2));
      progress.doneFiles += 2;
      emit();
      yield { name: 'manifest.json', input: manifestBytes };
    }

    // Stream the ZIP to disk, counting bytes written.
    let sizeBytes = 0;
    const zipStream = makeZip(files());
    const reader = zipStream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abort.signal.aborted) throw new Error('cancelled');
        await writable.write(value as unknown as FileSystemWriteChunkType);
        sizeBytes += value.byteLength;
      }
      await writable.close();
    } catch (e) {
      try {
        await writable.abort();
      } catch {
        /* ignore */
      }
      if (logId) {
        await backupLogUpdate(logId, {
          status: (e as Error).message === 'cancelled' ? 'cancelled' : 'failed',
          error_message: (e as Error).message,
          finished: true,
        }).catch(() => {});
      }
      throw e;
    }

    progress.phase = 'done';
    progress.doneBytes = totalBytes;
    emit();

    if (logId) {
      await backupLogUpdate(logId, {
        status: 'success',
        size_bytes: sizeBytes,
        table_counts: tableCounts,
        media_count: media.length,
        media_bytes: mediaBytes,
        finished: true,
      }).catch(() => {});
    }

    return { fileName, sizeBytes };
  })();

  return { promise, cancel };
}
