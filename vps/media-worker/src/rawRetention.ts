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

import type { JobDb } from './db.js';
import { errorMessage, type Logger, silentLogger } from './log.js';
import { PeriodicTask } from './periodic.js';
import type { RecordingsDir } from './recordings.js';
import type { Storage } from './storage.js';

export const DEFAULT_RETENTION_EVERY_MS = 30 * 60 * 1000;
export const DEFAULT_RETENTION_FIRST_DELAY_MS = 15 * 1000;

export interface RetentionDeps {
  db: Pick<JobDb, 'liveRawsDueForDeletion' | 'markLiveRawDeleted'>;
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

export async function sweepLiveRaws(deps: RetentionDeps): Promise<RetentionStats> {
  const log = deps.log ?? silentLogger;
  const stats: RetentionStats = { due: 0, deleted: 0, stampedMissing: 0, kept: 0, refused: 0, errors: 0 };
  const rows = await deps.db.liveRawsDueForDeletion();
  stats.due = rows.length;

  for (const row of rows) {
    if (deps.signal?.aborted) break;
    const session = row.sessionId;
    try {
      const local = await deps.recordings.check(row.rawPath);
      if (local === 'invalid' || local === 'outside' || local === 'not_file') {
        stats.refused++;
        log('error', 'raw_retention.refused', { session, reason: local });
        continue;
      }
      if (!row.rawBackupKey) {
        stats.kept++;
        log('warn', 'raw_retention.kept', { session, reason: 'no_backup_key' });
        continue;
      }
      const remoteSize = await deps.storage.objectSize(row.rawBackupKey);

      if (local === 'missing') {
        if (remoteSize !== null && remoteSize > 0) {
          await deps.db.markLiveRawDeleted(session);
          stats.stampedMissing++;
          log('warn', 'raw_retention.local_missing_stamped', { session, backup_bytes: remoteSize });
        } else {
          stats.kept++;
          log('error', 'raw_retention.local_and_backup_missing', { session });
        }
        continue;
      }

      if (remoteSize === null || remoteSize !== local.size) {
        stats.kept++;
        log('warn', 'raw_retention.kept', {
          session,
          reason: remoteSize === null ? 'backup_missing' : 'size_mismatch',
          local_bytes: local.size,
          backup_bytes: remoteSize ?? undefined,
        });
        continue;
      }

      // Re-validated inside delete(); a refusal is an error, never a stamp.
      if (!(await deps.recordings.delete(local.path))) throw new Error('local raw vanished or failed re-validation');
      stats.deleted++;
      await deps.db.markLiveRawDeleted(session);
    } catch (err) {
      stats.errors++;
      log('error', 'raw_retention.error', { session, error: errorMessage(err, 200) });
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
