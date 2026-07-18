/**
 * Server-error → user copy (audit F-054). The Postgres RPCs raise their
 * refusal reasons in Arabic («انتهى وقت الاختبار», «استنفدت المحاولات المتاحة
 * لهذا الاختبار», …) — those are written for the user and should surface
 * verbatim. Everything else (network failures, PostgREST/constraint noise like
 * "duplicate key value violates unique constraint") is English plumbing that
 * must never reach an Arabic-first screen — the caller's calm fallback shows
 * instead. Auth screens keep their richer mapper (authErrors.ts); this is the
 * generic seam for feature RPCs.
 */
export function arabicOr(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /[؀-ۿ]/.test(msg) ? msg : fallback;
}
