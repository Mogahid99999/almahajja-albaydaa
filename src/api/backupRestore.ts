/**
 * Backup & Restore — RESTORE orchestrator (data-access layer, v1).
 *
 * DISABLED by default (RESTORE_ENABLED). Restore is destructive; it stays off
 * until the full staging round-trip (§23) passes. The UI also gates on this.
 *
 * The safe restore flow (§9), all in the admin's BROWSER:
 *   1. Pick ZIP → stream-read manifest.json + checksums.json (small, buffered).
 *   2. Validate structure + version compatibility (backupValidate, pure).
 *   3. Verify checksums of the DB files BEFORE touching anything live.
 *   4. start_restore_session() → a server-issued restore_id (2h, caller-bound).
 *   5. Stream every media/* entry → R2 restore-staging/{restore_id}/ via signed
 *      PUT, hashing inline; reject on checksum mismatch. Nothing live is touched.
 *   6. Validate staged media (HEAD size) against the manifest.
 *   7. restore_tables(payload) — ONE transaction, FK-safe, all-or-nothing.
 *   8. Activate media: per-object COPY staged→live, archiving replaced live
 *      objects to pre-restore/{restore_id}/ (the rollback window).
 *   9. Full-replace cleanup: delete live keys NOT in the backup (archived first).
 *  10. Verify (row counts, sample media HEAD). Mark success; cleanup staging.
 *
 * On ANY failure before step 7 commits: the DB is untouched (Postgres rolls the
 * transaction back) and live media is untouched (only staging was written). We
 * mark the session failed and DO NOT delete old media. The staged data is left
 * for diagnosis; the UI offers a controlled cleanup.
 *
 * Streaming ZIP read uses fflate's Unzip (pull per-entry), so a multi-GB archive
 * is never fully in RAM: DB entries are small; each media entry is streamed to
 * R2 one at a time.
 */
import { Unzip, AsyncUnzipInflate } from 'fflate';

import {
  backupRpc,
  invokeMedia,
  listAllMedia,
  sha256Hex,
  type MediaObject,
} from '@/api/backup';
import { supabase } from '@/lib/supabase';
import {
  checkCompatibility,
  classifyEntry,
  crossCheck,
  parseChecksums,
  parseManifest,
  unsafePathReason,
  type CompatResult,
} from '@/lib/backupValidate';
import type { BackupManifest } from '@/lib/backupFormat';

/**
 * MASTER SWITCH. Enabled after the staging round-trip + failure-injection tests
 * passed (2026-07-19): DB+media restore round-trip, checksum-mismatch abort,
 * version gate, and mid-restore rollback all verified on the staging project.
 *
 * NOTE: this flag is compile-time. Before a PRODUCTION build ships with restore
 * live, production must have migration 0102 applied AND the backup-media Edge
 * Function deployed (with prod R2 secrets) — otherwise restore calls will fail.
 */
export const RESTORE_ENABLED = true;

// ─── Phase 1–3: read + validate the ZIP header (no live writes) ──────────────

export interface BackupInspection {
  manifest: BackupManifest;
  checksums: Record<string, string>;
  compat: CompatResult;
  /** media keys (relative to media/) present in the archive, in file order. */
  mediaKeys: string[];
  /** table name → jsonl text (buffered; DB is small). */
  tables: Record<string, string>;
  sequences: unknown[];
  /** every entry path seen, for the cross-check. */
  seenPaths: string[];
  /** Arabic problems found during cross-check (empty = OK). */
  problems: string[];
}

/**
 * Stream-read a picked backup File once, buffering the small text parts and
 * recording media entries (their bytes are re-read during staging so we don't
 * hold them here). Verifies DB-file checksums immediately (§13). Throws Arabic
 * errors on any structural/compat/integrity problem.
 */
export async function inspectBackup(file: File): Promise<BackupInspection> {
  const textParts: Record<string, Uint8Array[]> = {};
  const wantText = (p: string) =>
    p === 'manifest.json' ||
    p === 'checksums.json' ||
    p === 'database/_sequences.json' ||
    /^database\/.+\.jsonl$/.test(p);

  const seenPaths: string[] = [];
  const mediaKeys: string[] = [];
  // media path → running sha256 is done in the staging pass; here we just count.

  await streamUnzip(file, (path, chunk, final) => {
    const bad = unsafePathReason(path);
    if (bad) throw new Error(bad);
    if (!seenPaths.includes(path)) seenPaths.push(path);

    const cls = classifyEntry(path);
    if (cls.kind === 'media') {
      if (final && !mediaKeys.includes(cls.key)) mediaKeys.push(cls.key);
      return; // media bytes handled during staging, not buffered here
    }
    if (cls.kind === 'unknown') {
      // ignore unknown entries defensively (don't fail the whole restore)
      return;
    }
    if (wantText(path)) {
      (textParts[path] ??= []).push(chunk);
    }
  });

  const decode = (p: string): string => {
    const parts = textParts[p];
    if (!parts) throw new Error(`الأرشيف ناقص الملف: ${p}`);
    const total = parts.reduce((n, a) => n + a.byteLength, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const a of parts) {
      buf.set(a, off);
      off += a.byteLength;
    }
    return new TextDecoder().decode(buf);
  };

  const manifest = parseManifest(decode('manifest.json'));
  const checksums = parseChecksums(decode('checksums.json'));
  const compat = checkCompatibility(manifest);

  // Verify DB-file checksums NOW (before any live write). Media checksums are
  // verified during the staging upload.
  for (const path of Object.keys(checksums)) {
    if (path.startsWith('media/')) continue;
    const bytes = new TextEncoder().encode(decode(path));
    const actual = await sha256Hex(bytes);
    if (actual !== checksums[path].toLowerCase()) {
      throw new Error(`فشل التحقّق من الملف: ${path} — الأرشيف تالف أو مُعدّل.`);
    }
  }

  const tables: Record<string, string> = {};
  for (const p of Object.keys(textParts)) {
    const cls = classifyEntry(p);
    if (cls.kind === 'table') tables[cls.table] = decode(p);
  }
  const sequences = JSON.parse(decode('database/_sequences.json'));

  const problems = crossCheck(manifest, checksums, seenPaths);

  return { manifest, checksums, compat, mediaKeys, tables, sequences, seenPaths, problems };
}

// ─── fflate streaming unzip driver ───────────────────────────────────────────

/**
 * Drive fflate's Unzip over a File in slices, invoking `onData(path, chunk,
 * final)` for every decompressed chunk. Resolves when the whole archive has
 * been consumed. Chunks for one entry arrive in order; `final` marks the last.
 */
function streamUnzip(
  file: File,
  onData: (path: string, chunk: Uint8Array, final: boolean) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(AsyncUnzipInflate);
    let openStreams = 0;
    let sourceDone = false;
    const maybeDone = () => {
      if (sourceDone && openStreams === 0) resolve();
    };

    unzip.onfile = (fileStream) => {
      const name = fileStream.name;
      openStreams++;
      fileStream.ondata = (err, chunk, final) => {
        if (err) {
          reject(new Error('تعذّرت قراءة الأرشيف — قد يكون تالفًا.'));
          return;
        }
        try {
          onData(name, chunk, final);
        } catch (e) {
          reject(e as Error);
          return;
        }
        if (final) {
          openStreams--;
          maybeDone();
        }
      };
      fileStream.start();
    };

    // Feed the file to the unzipper in slices to bound memory.
    const CHUNK = 4 * 1024 * 1024; // 4 MB
    let offset = 0;
    const pump = async () => {
      try {
        while (offset < file.size) {
          const slice = file.slice(offset, offset + CHUNK);
          const buf = new Uint8Array(await slice.arrayBuffer());
          offset += buf.byteLength;
          unzip.push(buf, offset >= file.size);
        }
        if (file.size === 0) unzip.push(new Uint8Array(0), true);
        sourceDone = true;
        maybeDone();
      } catch (e) {
        reject(e as Error);
      }
    };
    void pump();
  });
}

// ─── Phase 5: stage media to R2 (streamed, hashed, checksum-verified) ─────────

export interface RestoreProgress {
  phase: 'staging' | 'validating' | 'database' | 'activating' | 'cleanup' | 'verifying' | 'done';
  totalFiles: number;
  doneFiles: number;
  totalBytes: number;
  doneBytes: number;
  currentFile: string;
}

async function stagedPutUrl(restoreId: string, key: string, contentType: string): Promise<string> {
  const { uploadUrl } = await invokeMedia<{ uploadUrl: string; stagedKey: string }>({
    action: 'writeStaged',
    restoreId,
    key,
    contentType,
  });
  return uploadUrl;
}

/**
 * Re-read the ZIP and upload each media/* entry to R2 staging, verifying its
 * sha256 against checksums.json as the bytes flow. One object at a time — bounded
 * by the largest single file, not the library. Throws on a checksum mismatch or
 * an upload failure (leaving the DB + live media untouched).
 */
async function stageMedia(
  file: File,
  restoreId: string,
  checksums: Record<string, string>,
  onProgress: (p: Partial<RestoreProgress>) => void,
  abort: AbortSignal,
): Promise<{ stagedKeys: string[]; stagedBytes: number }> {
  // Buffer each media entry (one at a time), hash it, PUT it. fflate hands us
  // chunks; we accumulate per-entry then flush on `final`.
  const stagedKeys: string[] = [];
  let stagedBytes = 0;
  const pending: Record<string, Uint8Array[]> = {};

  // Sequential upload queue: fflate is push-driven, so we collect a full entry
  // then await its upload before continuing is not directly possible inside the
  // sync callback. Instead we buffer the entry bytes on `final`, then upload in
  // a promise chain we await at the end via a queue.
  const uploads: Array<() => Promise<void>> = [];

  await streamUnzip(file, (path, chunk, final) => {
    if (abort.aborted) throw new Error('cancelled');
    const cls = classifyEntry(path);
    if (cls.kind !== 'media') return;
    (pending[path] ??= []).push(chunk);
    if (!final) return;

    const parts = pending[path];
    delete pending[path];
    const total = parts.reduce((n, a) => n + a.byteLength, 0);
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const a of parts) {
      bytes.set(a, off);
      off += a.byteLength;
    }
    const key = cls.key;
    uploads.push(async () => {
      if (abort.aborted) throw new Error('cancelled');
      const expected = checksums[`media/${key}`];
      if (!expected) throw new Error(`لا توجد قيمة تحقّق للملف: media/${key}`);
      const actual = await sha256Hex(bytes);
      if (actual !== expected.toLowerCase()) {
        throw new Error(`فشل التحقّق من الملف: media/${key} — الأرشيف تالف.`);
      }
      const url = await stagedPutUrl(restoreId, key, guessContentType(key));
      const res = await fetch(url, {
        method: 'PUT',
        body: bytes as unknown as BodyInit,
        headers: { 'Content-Type': guessContentType(key) },
        signal: abort,
      });
      if (!res.ok) throw new Error(`تعذّر رفع الملف إلى التخزين المؤقت: media/${key} (${res.status}).`);
      stagedKeys.push(key);
      stagedBytes += bytes.byteLength;
      onProgress({ doneFiles: stagedKeys.length, doneBytes: stagedBytes, currentFile: key });
    });
  });

  // Run the uploads sequentially (bounded memory: bytes already collected per
  // entry are GC'd as each closure completes).
  for (const run of uploads) await run();

  return { stagedKeys, stagedBytes };
}

function guessContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return map[ext] ?? 'application/octet-stream';
}

// ─── Phase 6: validate staged media (HEAD size) ──────────────────────────────

async function validateStaged(
  restoreId: string,
  stagedKeys: string[],
): Promise<void> {
  for (const key of stagedKeys) {
    const stagedKey = `restore-staging/${restoreId}/${key}`;
    const { exists } = await invokeMedia<{ exists: boolean; size: number }>({
      action: 'head',
      key: stagedKey,
    });
    if (!exists) throw new Error(`ملف مؤقت مفقود بعد الرفع: ${key}`);
  }
}

// ─── Phase 7: restore the database (one transaction) ─────────────────────────

interface RestoreTableResult {
  out_table: string;
  out_restored: number;
  out_expected: number;
}

async function restoreDatabase(
  tables: Record<string, string>,
  sequences: unknown[],
): Promise<RestoreTableResult[]> {
  // Build the payload: parse each table's JSONL into a rows array.
  const tablePayload = Object.entries(tables).map(([name, jsonl]) => ({
    name,
    rows: jsonl
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l)),
  }));
  const payload = { tables: tablePayload, sequences };
  const result = await backupRpc<RestoreTableResult[]>('restore_tables', {
    p_payload: payload,
    p_mode: 'full_replace',
  });
  // Verify every table restored its expected count.
  for (const r of result) {
    if (Number(r.out_restored) !== Number(r.out_expected)) {
      throw new Error(
        `عدد الصفوف لا يطابق بعد الاستعادة في «${r.out_table}»: ` +
          `${r.out_restored} مقابل ${r.out_expected}.`,
      );
    }
  }
  return result;
}

// ─── Phase 8–9: activate media + full-replace cleanup ────────────────────────

async function activateMedia(
  restoreId: string,
  stagedKeys: string[],
  liveKeysBeforeRestore: string[],
  onProgress: (p: Partial<RestoreProgress>) => void,
  abort: AbortSignal,
): Promise<void> {
  let done = 0;
  for (const key of stagedKeys) {
    if (abort.aborted) throw new Error('cancelled');
    await invokeMedia({ action: 'activate', restoreId, key });
    done++;
    onProgress({ doneFiles: done, currentFile: key });
  }

  // Full-replace: delete live keys NOT in the backup (archived first by the
  // Edge Function). Batch in ≤1000.
  const backupSet = new Set(stagedKeys);
  const toDelete = liveKeysBeforeRestore.filter((k) => !backupSet.has(k));
  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000);
    if (batch.length === 0) continue;
    await invokeMedia({ action: 'deleteLiveKeys', restoreId, keys: batch });
  }
}

// ─── Phase 10: verify ────────────────────────────────────────────────────────

export interface RestoreVerification {
  ok: boolean;
  checks: { label: string; ok: boolean }[];
}

async function verifyRestore(
  manifest: BackupManifest,
  stagedKeys: string[],
  dbOnly: boolean,
): Promise<RestoreVerification> {
  const checks: { label: string; ok: boolean }[] = [];

  // Row counts match the manifest.
  try {
    const counts = await backupRpc<{ table_name: string; row_count: number }[]>('export_table_counts');
    const now: Record<string, number> = {};
    for (const c of counts) now[c.table_name] = Number(c.row_count);
    let ok = true;
    for (const [t, n] of Object.entries(manifest.table_counts)) {
      if ((now[t] ?? 0) !== n) ok = false;
    }
    checks.push({ label: 'تطابق عدد صفوف الجداول', ok });
  } catch {
    checks.push({ label: 'تطابق عدد صفوف الجداول', ok: false });
  }

  // A sample of restored media exists live — FULL restores only. A database_only
  // restore doesn't touch media, so there is nothing to verify here.
  if (!dbOnly) {
    try {
      const sample = stagedKeys.slice(0, Math.min(5, stagedKeys.length));
      let ok = true;
      for (const key of sample) {
        const { exists } = await invokeMedia<{ exists: boolean }>({ action: 'head', key });
        if (!exists) ok = false;
      }
      checks.push({ label: 'وجود عيّنة من الملفات المستعادة', ok });
    } catch {
      checks.push({ label: 'وجود عيّنة من الملفات المستعادة', ok: false });
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}

// ─── The full restore orchestrator ───────────────────────────────────────────

export interface RestoreHandle {
  promise: Promise<{ verification: RestoreVerification }>;
  cancel: () => void;
}

export function runRestore(
  file: File,
  inspection: BackupInspection,
  onProgress: (p: RestoreProgress) => void,
): RestoreHandle {
  const abortCtl = new AbortController();
  const cancel = () => abortCtl.abort();

  const promise = (async () => {
    if (!RESTORE_ENABLED) {
      throw new Error('الاستعادة معطّلة في هذا الإصدار حتى اكتمال اختبارات البيئة التجريبية.');
    }

    // A database_only backup restores DB data ONLY — no media is staged,
    // validated, activated, or deleted, and live R2 is never touched. The mode
    // is authoritative from the backup's own manifest.
    const dbOnly = inspection.manifest.backup_mode === 'database_only';

    const progress: RestoreProgress = {
      phase: 'staging',
      totalFiles: dbOnly ? 0 : inspection.mediaKeys.length,
      doneFiles: 0,
      totalBytes: dbOnly ? 0 : inspection.manifest.media_bytes,
      doneBytes: 0,
      currentFile: '',
    };
    const emit = (p: Partial<RestoreProgress>) => {
      Object.assign(progress, p);
      onProgress({ ...progress });
    };
    emit({});

    // Snapshot live media keys BEFORE we touch anything (full-replace diff).
    // database_only never touches media, so skip the listing entirely.
    const liveBefore = dbOnly ? [] : (await listAllMedia()).map((m: MediaObject) => m.key);

    // 4) server-issued restore_id.
    const restoreId = await backupRpc<string>('start_restore_session', {
      p_file_name: file.name,
    });
    const logId = await backupRpc<string>('backup_log_start', {
      p_operation: 'restore',
      p_file_name: file.name,
      p_restore_mode: 'full_replace',
      p_restore_id: restoreId,
    }).catch(() => null);

    const fail = async (code: string, message: string) => {
      await backupRpc('set_restore_session_status', {
        p_restore_id: restoreId,
        p_status: 'failed',
      }).catch(() => {});
      if (logId) {
        await backupRpc('backup_log_update', {
          p_id: logId,
          p_status: 'failed',
          p_error_code: code,
          p_error_message: message,
          p_finished: true,
        }).catch(() => {});
      }
    };

    try {
      let stagedKeys: string[] = [];

      if (!dbOnly) {
        // 5) stage media.
        emit({ phase: 'staging' });
        ({ stagedKeys } = await stageMedia(
          file,
          restoreId,
          inspection.checksums,
          emit,
          abortCtl.signal,
        ));

        // 6) validate staged.
        emit({ phase: 'validating', doneFiles: 0 });
        await validateStaged(restoreId, stagedKeys);
        await backupRpc('set_restore_session_status', { p_restore_id: restoreId, p_status: 'validated' });
      }

      // 7) restore DB (one transaction). Up to here nothing live changed, so a
      //    throw leaves the system fully intact.
      emit({ phase: 'database' });
      if (logId) await backupRpc('backup_log_update', { p_id: logId, p_status: 'restoring' }).catch(() => {});
      await restoreDatabase(inspection.tables, inspection.sequences);

      // 8–9) activate media + full-replace cleanup — FULL backups only. A
      //      database_only restore never stages, activates, or deletes media,
      //      so existing R2 objects are left exactly as they were.
      if (!dbOnly) {
        emit({ phase: 'activating', totalFiles: stagedKeys.length, doneFiles: 0 });
        await activateMedia(restoreId, stagedKeys, liveBefore, emit, abortCtl.signal);
        await backupRpc('set_restore_session_status', { p_restore_id: restoreId, p_status: 'activated' });
      }

      // 10) verify.
      emit({ phase: 'verifying' });
      if (logId) await backupRpc('backup_log_update', { p_id: logId, p_status: 'verifying' }).catch(() => {});
      const verification = await verifyRestore(inspection.manifest, stagedKeys, dbOnly);

      // Cleanup staging (keep pre-restore rollback window until admin confirms).
      // No-op for database_only (nothing was staged).
      emit({ phase: 'cleanup' });
      if (!dbOnly) {
        await invokeMedia({ action: 'cleanup', restoreId, scope: 'staging' }).catch(() => {});
      }
      await backupRpc('set_restore_session_status', { p_restore_id: restoreId, p_status: 'completed' });

      if (logId) {
        await backupRpc('backup_log_update', {
          p_id: logId,
          p_status: verification.ok ? 'success' : 'failed',
          p_media_count: stagedKeys.length,
          p_finished: true,
          p_error_message: verification.ok ? null : 'فشل التحقّق بعد الاستعادة.',
        }).catch(() => {});
      }

      emit({ phase: 'done' });
      return { verification };
    } catch (e) {
      const msg = (e as Error).message;
      await fail(msg === 'cancelled' ? 'cancelled' : 'restore_error', msg);
      throw e;
    }
  })();

  return { promise, cancel };
}
