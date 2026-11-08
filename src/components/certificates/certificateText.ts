/**
 * Wording for the student's certificate views (section card, «شهاداتي»).
 *
 * Presentation ONLY: every number comes straight from certificate_eligibility
 * (0168) — total / completed / required follow the certificate's content_scope,
 * `met` / `eligible` are the server's verdict. Nothing here decides
 * eligibility; it only says what the server returned, in calm Arabic.
 */
import type { CertificateContentScope, CertificateEligibility } from '@/api/certificates';
import { arLectureCount, arNum } from '@/lib/format';

/** "اختبار واحد" / "اختباران" / "٣ اختبارات" / "١١ اختبارًا". */
export function arQuizCount(n: number): string {
  if (n === 1) return 'اختبار واحد';
  if (n === 2) return 'اختباران';
  if (n >= 3 && n <= 10) return `${arNum(n)} اختبارات`;
  return `${arNum(n)} اختبارًا`;
}

/** The certificate's content, as the student reads it. */
export function scopeLabel(scope: CertificateContentScope): string {
  return scope === 'subtree' ? 'هذا القسم وأقسامه الفرعية' : 'هذا القسم';
}

/** 0…1 — how far along the lecture requirement (completed ⁄ required, capped). */
export function lectureProgress(e: CertificateEligibility): number {
  const { completed, required } = e.lectures;
  if (required <= 0) return 0;
  return Math.min(1, completed / required);
}

/** «المطلوب إكمال جميع محاضرات هذا القسم» / «المطلوب إكمال ٧٠٪ من محاضرات … (٧ من ١٠)». */
export function lectureRequirementLine(e: CertificateEligibility): string {
  const where = scopeLabel(e.lectures.scope);
  if (e.lectures.rule === 'percent' && e.lectures.pct !== null) {
    return `المطلوب إكمال ${arNum(e.lectures.pct)}٪ من محاضرات ${where} (${arNum(e.lectures.required)} من ${arNum(e.lectures.total)})`;
  }
  return `المطلوب إكمال جميع محاضرات ${where}`;
}

export type QuizState = 'passed' | 'pending' | 'todo';

export function quizState(item: CertificateEligibility['quizzes']['items'][number]): QuizState {
  if (item.passed) return 'passed';
  if (item.pendingGrading) return 'pending';
  return 'todo';
}

export const QUIZ_STATE_LABEL: Record<QuizState, string> = {
  passed: 'اجتزته',
  pending: 'بانتظار التصحيح',
  todo: 'لم تجتزه بعد',
};

/**
 * What is left, in one line: «المتبقي: محاضرتان واختبار واحد»,
 * «المتبقي: اختبار واحد بانتظار التصحيح», or «استوفيت شروط الشهادة».
 */
export function remainingSummary(e: CertificateEligibility): string {
  if (e.eligible) return 'استوفيت شروط الشهادة';
  const parts: string[] = [];
  const lecturesLeft = Math.max(0, e.lectures.required - e.lectures.completed);
  if (!e.lectures.met && lecturesLeft > 0) parts.push(arLectureCount(lecturesLeft));
  if (!e.quizzes.met) {
    const states = e.quizzes.items.map(quizState);
    const todo = states.filter((s) => s === 'todo').length;
    const pending = states.filter((s) => s === 'pending').length;
    if (todo > 0) parts.push(arQuizCount(todo));
    if (pending > 0) parts.push(`${arQuizCount(pending)} بانتظار التصحيح`);
  }
  if (parts.length === 0) return 'لم تكتمل الشروط بعد';
  return `المتبقي: ${parts.join(' و')}`;
}
