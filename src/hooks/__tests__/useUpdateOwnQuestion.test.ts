/**
 * useUpdateOwnQuestion cache invalidation (F-057 client leg).
 *
 * Editing a question's body clears its answer thread server-side (migration
 * 0092). The client must therefore drop the cached `['questions','answers',id]`
 * thread too — not only the mine/public lists — or a stale answer would linger
 * in the UI until the next cold start. The fix widened the hook's onSuccess
 * invalidation from the two list keys to the whole `['questions']` root.
 *
 * These pin the mechanism the fix depends on: the answer-thread key nests under
 * `['questions']`, and invalidating that root marks the thread query stale.
 */
import { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';

test('the F-057 regression: the answer-thread cache key nests under the ["questions"] root', () => {
  const key = queryKeys.questionAnswers('q-1');
  expect(key.slice(0, 2)).toEqual(['questions', 'answers']);
});

test('the F-057 regression: invalidating the ["questions"] root marks a seeded answer thread stale', async () => {
  const qc = new QueryClient();
  const qid = 'q-1';
  // Seed the three caches an edit touches, all fresh (not stale).
  qc.setQueryData(queryKeys.publicQuestions('general'), [{ id: qid }]);
  qc.setQueryData(queryKeys.myQuestions('general'), [{ id: qid }]);
  qc.setQueryData(queryKeys.questionAnswers(qid), [{ id: 'a-old', body: 'قديم' }]);

  const answersKey = queryKeys.questionAnswers(qid);
  expect(qc.getQueryState(answersKey)?.isInvalidated).toBe(false);

  // The exact call the hook makes on a successful edit.
  await qc.invalidateQueries({ queryKey: ['questions'] });

  // The answer thread — the cache the narrower mine/public invalidation missed
  // (F-057) — is now stale and will refetch, so no stale answer survives.
  expect(qc.getQueryState(answersKey)?.isInvalidated).toBe(true);
  expect(qc.getQueryState(queryKeys.myQuestions('general'))?.isInvalidated).toBe(true);
});
