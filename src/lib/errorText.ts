/**
 * Server-error → user copy (audit F-054). The Postgres RPCs raise their
 * refusal reasons in Arabic («انتهى وقت الاختبار», «استنفدت المحاولات المتاحة
 * لهذا الاختبار», …) — those are written for the user and should surface
 * verbatim. Everything else (network failures, PostgREST/constraint noise like
 * "duplicate key value violates unique constraint") is English plumbing that
 * must never reach an Arabic-first screen — the caller's calm fallback shows
 * instead. Auth screens keep their richer mapper (authErrors.ts); this is the
 * generic seam for feature RPCs.
 *
 * `supabase.rpc()` does NOT hand back an Error: postgrest-js builds its error
 * as a plain `{ message, code, details, hint }` object parsed from the response
 * body, and the api layer rethrows it as-is. Reading `.message` only off Error
 * instances therefore dropped every server reason on the floor — a student who
 * had just registered was told «تعذّر إرسال السؤال» when the server had said
 * «يلزم إنشاء حساب لطرح سؤال» (0125). Any object carrying a string `message`
 * counts; the Arabic-only filter below still keeps English plumbing out.
 */
export function arabicOr(err: unknown, fallback: string): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : typeof (err as { message?: unknown } | null)?.message === 'string'
          ? (err as { message: string }).message
          : '';
  return /[؀-ۿ]/.test(msg) ? msg : fallback;
}

/**
 * Staff screens (admin web / sheikh): like {@link arabicOr}, but when the
 * server's reason isn't Arabic, append it in parentheses after the Arabic
 * fallback instead of dropping it — «تعذّر الإرسال.» alone hid a statement
 * timeout for a month (0129). Students never see this; staff need the detail
 * to report or diagnose a failure.
 */
export function staffErrorText(err: unknown, fallback: string): string {
  const arabic = arabicOr(err, '');
  if (arabic) return arabic;
  const raw =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown } | null)?.message === 'string'
        ? (err as { message: string }).message
        : typeof err === 'string'
          ? err
          : '';
  return raw.trim() ? `${fallback} (${raw.trim()})` : fallback;
}
