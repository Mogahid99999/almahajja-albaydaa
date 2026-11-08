/**
 * Manual grading helpers for written quiz answers (migration 0166). The server
 * (grade_quiz_attempt) is the authority — these only keep the grader's form
 * honest before it is sent.
 */

/** Arabic-Indic / Persian digits typed on a phone keyboard → ASCII. */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/** A grade field's value → whole points within 0..max, or null if not valid. */
export function parseGrade(raw: string | undefined, max: number): number | null {
  const s = toLatinDigits(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= max ? n : null;
}
