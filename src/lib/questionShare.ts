/**
 * Share a question with the sheikh's answer (owner 2026-11-23) — the PURE text.
 *
 * - Only written answers travel: a voice-only answer has nothing to share, so
 *   no text at all → null (the button is not shown).
 * - The label is always «جواب الشيخ», even when another moderator answered.
 * - The asker's name never travels (anonymous or not).
 * - Several written answers go in thread order, one after another.
 */
export const QUESTION_SHARE_FOOTER = '— من تطبيق المَحجّة البَيْضاء\nhttps://almahajja.app';

export function questionShareText(question: string, answers: readonly (string | null | undefined)[]): string | null {
  const q = question.trim();
  const written = answers.map((a) => (a ?? '').trim()).filter((a) => a.length > 0);
  if (!q || written.length === 0) return null;
  return `❓ السؤال:\n${q}\n\n✅ جواب الشيخ:\n${written.join('\n\n')}\n\n${QUESTION_SHARE_FOOTER}`;
}
