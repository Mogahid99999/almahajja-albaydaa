// Retention of LOCAL live raws (owner rule amended 2026-09-28: delete the local
// raw as soon as its R2 upload is confirmed; the R2 backup is kept forever).
// The live_recording job deletes it itself right after create_live_lecture;
// this sweep is the safety net (every 30 min + once at startup): for each row of
// `live_raws_due_for_deletion()` delete the local raw ONLY after proving the R2
// backup exists AND has exactly the local file's size (ranged GetObject, never
// HEAD), then stamp `mark_live_raw_deleted`. Anything unproven is kept and logged.
//
// Edge: the local file is already gone (e.g. unlink succeeded but the stamp
// failed last run) → stamp it only if the backup object exists; otherwise keep
// the row (it will be logged every run until someone looks).
//
// 0146: a session recorded in PARTS (one per egress) is listed part by part by
// `live_part_raws_due_for_deletion()` — only once EVERY part of that session
// has its backup recorded — and stamped with `mark_live_part_raw_deleted`
// (which stamps the session when its last part is gone). Same checks per part.

import type { JobDb } from './db.js';
import { errorMessage, type Logger, silentLogger } from './log.js';
import { PeriodicTask } from './periodic.js';
import type { RecordingsDir } from './recordings.js';
import type { Storage } from './storage.js';

export const DEFAULT_RETENTION_EVERY_MS = 30 * 60 * 1000;
export const DEFAULT_RETENTION_FIRST_DELAY_MS = 15 * 1000;

export interface RetentionDeps {
  db: Pick<
    JobDb,
    'liveRawsDueForDeletion' | 'markLiveRawDeleted' | 'livePartRawsDueForDeletion' | 'markLivePartRawDeleted'
  >;
  storage: Pick<Storage, 'objectSize'>;
  recordings: Pick<RecordingsDir, 'check' | 'delete'>;
  log?: Logger;
  signal?: AbortSignal;
}

export interface RetentionStats {
  due: number;
  deleted: number;
  /** Local file already gone, backup present → only stamped. */
  stampedMissing: number;
  /** Kept: backup missing / size mismatch / no backup key. */
  kept: number;
  /** Kept: path invalid or outside RECORDINGS_DIR (never touched). */
  refused: number;
  errors: number;
}

interface DueRaw {
  sessionId: string;
  /** null = the pre-0146 session-level raw. */
  seq: number | null;
  rawPath: string;
  rawBackupKey: string | null;
}

export async function sweepLiveRaws(deps: RetentionDeps): Promise<RetentionStats> {
  const log = deps.log ?? silentLogger;
  const stats: RetentionStats = { due: 0, deleted: 0, stampedMissing: 0, kept: 0, refused: 0, errors: 0 };
  const rows: DueRaw[] = (await deps.db.liveRawsDueForDeletion()).map((r) => ({ ...r, seq: null }));
  try {
    rows.push(...(await deps.db.livePartRawsDueForDeletion()));
  } catch (err) {
    // 0146 not applied yet, or a transient error: the session-level rows still run.
    stats.errors++;
    log('error', 'raw_retention.parts_error', { error: errorMessage(err, 200) });
  }
  stats.due = rows.length;

  for (const row of rows) {
    if (deps.signal?.aborted) break;
    const session = row.sessionId;
    const seq = row.seq ?? undefined;
    const mark = () =>
      row.seq === null ? deps.db.markLiveRawDeleted(session) : deps.db.markLivePartRawDeleted(session, row.seq);
    try {
      const local = await deps.recordings.check(row.rawPath);
      if (local === 'invalid' || local === 'outside' || local === 'not_file') {
        stats.refused++;
        log('error', 'raw_retention.refused', { session, seq, reason: local });
        continue;
      }
      if (!row.rawBackupKey) {
        stats.kept++;
        log('warn', 'raw_retention.kept', { session, seq, reason: 'no_backup_key' });
        continue;
      }
      const remoteSize = await deps.storage.objectSize(row.rawBackupKey);

      if (local === 'missing') {
        if (remoteSize !== null && remoteSize > 0) {
          await mark();
          stats.stampedMissing++;
          log('warn', 'raw_retention.local_missing_stamped', { session, seq, backup_bytes: remoteSize });
        } else {
          stats.kept++;
          log('error', 'raw_retention.local_and_backup_missing', { session, seq });
        }
        continue;
      }

      if (remoteSize === null || remoteSize !== local.size) {
        stats.kept++;
        log('warn', 'raw_retention.kept', {
          session,
          seq,
          reason: remoteSize === null ? 'backup_missing' : 'size_mismatch',
          local_bytes: local.size,
          backup_bytes: remoteSize ?? undefined,
        });
        continue;
      }

      // Re-validated inside delete(); a refusal is an error, never a stamp.
      if (!(await deps.recordings.delete(local.path))) throw new Error('local raw vanished or failed re-validation');
      stats.deleted++;
      await mark();
    } catch (err) {
      stats.errors++;
      log('error', 'raw_retention.error', { session, seq, error: errorMessage(err, 200) });
    }
  }
  return stats;
}

export class RawRetention extends PeriodicTask<RetentionStats> {
  constructor(
    run: (signal: AbortSignal) => Promise<RetentionStats>,
    opts: { firstDelayMs?: number; everyMs?: number; log?: Logger } = {},
  ) {
    super(run, {
      name: 'raw_retention',
      firstDelayMs: opts.firstDelayMs ?? DEFAULT_RETENTION_FIRST_DELAY_MS,
      everyMs: opts.everyMs ?? DEFAULT_RETENTION_EVERY_MS,
      ...(opts.log ? { log: opts.log } : {}),
      fields: (s) => ({
        due: s.due,
        deleted: s.deleted,
        stamped_missing: s.stampedMissing,
        kept: s.kept,
        refused: s.refused,
        errors: s.errors,
      }),
    });
  }
}
