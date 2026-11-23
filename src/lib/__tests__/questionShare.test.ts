/**
 * Owner 2026-11-23: share a question with the sheikh's answer — the question and
 * the answer clearly apart, always «جواب الشيخ», written answers only.
 */
import { QUESTION_SHARE_FOOTER, questionShareText } from '@/lib/questionShare';

test('the question and the answer are clearly apart, under «جواب الشيخ», with the app line', () => {
  expect(questionShareText('  ما حكم المسألة؟ ', ['يجوز، والله أعلم.'])).toBe(
    `❓ السؤال:\nما حكم المسألة؟\n\n✅ جواب الشيخ:\nيجوز، والله أعلم.\n\n${QUESTION_SHARE_FOOTER}`,
  );
});

test('several written answers in thread order; voice-only answers are left out', () => {
  const t = questionShareText('سؤال', ['الأول', null, '  ', 'الثاني'])!;
  expect(t).toContain('✅ جواب الشيخ:\nالأول\n\nالثاني\n\n');
  expect(t.match(/جواب الشيخ/g)).toHaveLength(1);
});

test('nothing written (voice only, or no answer) → nothing to share', () => {
  expect(questionShareText('سؤال', [null])).toBeNull();
  expect(questionShareText('سؤال', [])).toBeNull();
  expect(questionShareText('  ', ['جواب'])).toBeNull();
});
