// Orphan sweep of `incoming/`. Every 6 h (+ once shortly after start): list
// `incoming/` objects older than 48 h, look each batch up in media_jobs.input_key,
// and delete an object only when
//   - NO job references it (abandoned upload: tab closed after the PUT, enqueue
//     failed, …), or
//   - EVERY job referencing it is `done` (the MP3 already exists; the worker's
//     post-commit delete must have failed).
// If any referencing job is queued, running or failed (a failed job keeps its
// original for a retry) the object is kept. Any lookup error aborts the sweep
// before deleting that batch. Logs counts only.

import type { JobDb, MediaJobStatus } from './db.js';
import type { Logger } from './log.js';
import { PeriodicTask } from './periodic.js';
import type { Storage } from './storage.js';

export const SWEEP_PREFIX = 'incoming/';
export const DEFAULT_MIN_AGE_MS = 48 * 60 * 60 * 1000;
export const DEFAULT_SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
/** Keys per media_jobs lookup (keeps the PostgREST `in.(…)` URL short). */
export const DEFAULT_LOOKUP_CHUNK = 100;
const MAX_PAGES = 10_000;

export interface SweepDeps {
  storage: Pick<Storage, 'listPage' | 'delete'>;
  db: Pick<JobDb, 'inputKeyJobStatuses'>;
  now?: () => number;
  minAgeMs?: number;
  lookupChunk?: number;
  signal?: AbortSignal;
}

export interface SweepStats {
  pages: number;
  scanned: number;
  /** Older than minAge (candidates). */
  old: number;
  /** Kept: referenced by at least one queued / running / failed job. */
  referenced: number;
  /** Total deleted (orphans + done-only). */
  deleted: number;
  /** Of `deleted`: objects whose referencing jobs were all `done`. */
  doneOnly: number;
  deleteFailed: number;
}

/** A key we may even consider: a real object directly under incoming/. */
function isCandidateKey(key: string): boolean {
  return key.startsWith(SWEEP_PREFIX) && key.length > SWEEP_PREFIX.length && !key.endsWith('/');
}

/** No job at all, or only `done` jobs → the original is no longer needed. */
export function isDeletable(jobStatuses: readonly MediaJobStatus[]): boolean {
  return jobStatuses.every((s) => s === 'done');
}

export async function sweepIncomingOrphans(deps: SweepDeps): Promise<SweepStats> {
  const now = deps.now ?? Date.now;
  const cutoff = now() - (deps.minAgeMs ?? DEFAULT_MIN_AGE_MS);
  const chunkSize = Math.max(1, deps.lookupChunk ?? DEFAULT_LOOKUP_CHUNK);
  const stats: SweepStats = { pages: 0, scanned: 0, old: 0, referenced: 0, deleted: 0, doneOnly: 0, deleteFailed: 0 };

  let token: string | null = null;
  do {
    if (deps.signal?.aborted) break;
    const page = await deps.storage.listPage(SWEEP_PREFIX, token);
    stats.pages++;
    stats.scanned += page.objects.length;

    const old = page.objects
      .filter((o) => isCandidateKey(o.key) && o.lastModified !== null && o.lastModified.getTime() <= cutoff)
      .map((o) => o.key);
    stats.old += old.length;

    for (let i = 0; i < old.length; i += chunkSize) {
      if (deps.signal?.aborted) break;
      const chunk = old.slice(i, i + chunkSize);
      // Throws on any DB error → the sweep stops before deleting this chunk.
      const statuses = await deps.db.inputKeyJobStatuses(chunk);
      for (const key of chunk) {
        const jobs = statuses.get(key) ?? [];
        if (!isDeletable(jobs)) {
          stats.referenced++;
          continue;
        }
        try {
          await deps.storage.delete(key);
          stats.deleted++;
          if (jobs.length) stats.doneOnly++;
        } catch {
          stats.deleteFailed++;
        }
      }
    }

    token = page.next;
  } while (token && stats.pages < MAX_PAGES);

  return stats;
}

export interface OrphanSweeperOptions {
  firstDelayMs?: number;
  everyMs?: number;
  log?: Logger;
}

/** Schedules the sweep (never overlapping itself); errors are logged, never thrown. */
export class OrphanSweeper extends PeriodicTask<SweepStats> {
  constructor(sweep: (signal: AbortSignal) => Promise<SweepStats>, opts: OrphanSweeperOptions = {}) {
    super(sweep, {
      name: 'sweep',
      firstDelayMs: opts.firstDelayMs ?? DEFAULT_FIRST_SWEEP_DELAY_MS,
      everyMs: opts.everyMs ?? DEFAULT_SWEEP_EVERY_MS,
      ...(opts.log ? { log: opts.log } : {}),
      fields: (s) => ({
        prefix: SWEEP_PREFIX,
        pages: s.pages,
        scanned: s.scanned,
        old: s.old,
        referenced: s.referenced,
        deleted: s.deleted,
        done_only: s.doneOnly,
        delete_failed: s.deleteFailed,
      }),
    });
  }
}
