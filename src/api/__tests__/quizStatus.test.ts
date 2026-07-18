/**
 * src/api/quizzes.ts › mapCard — quiz status derivation (Phase 8 surface).
 * The status pill, the intro CTA, and the journey line all key off this.
 */
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { mapCard, type RawStatusRow } from '../quizzes';

const row = (over: Partial<RawStatusRow> = {}): RawStatusRow => ({
  id: 'q1',
  title: 'اختبار',
  description: null,
  pass_score: 5,
  time_limit_sec: 600,
  max_attempts: 3,
  sort_order: 2,
  question_count: 10,
  total_score: 10,
  attempts_used: 0,
  attempts_left: 3,
  best_score: null,
  passed: false,
  in_progress_attempt_id: null,
  last_result_attempt_id: null,
  ...over,
});

describe('status derivation precedence', () => {
  test('an in-progress attempt wins over everything (resume path)', () => {
    expect(
      mapCard(row({ in_progress_attempt_id: 'a1', passed: true, attempts_left: 0 })).status,
    ).toBe('in_progress');
  });

  test('passed beats failed/exhausted (a pass is never demoted by later failures)', () => {
    expect(mapCard(row({ passed: true, attempts_used: 3, attempts_left: 0 })).status).toBe(
      'passed',
    );
  });

  test('untouched quiz → not_started', () => {
    expect(mapCard(row()).status).toBe('not_started');
  });

  test('attempts exhausted without a pass → exhausted', () => {
    expect(mapCard(row({ attempts_used: 3, attempts_left: 0 })).status).toBe('exhausted');
  });

  test('failed with attempts remaining → failed', () => {
    expect(mapCard(row({ attempts_used: 1, attempts_left: 2, best_score: 3 })).status).toBe(
      'failed',
    );
  });

  test('unlimited attempts (attempts_left null) never reads exhausted', () => {
    expect(
      mapCard(row({ max_attempts: null, attempts_used: 9, attempts_left: null })).status,
    ).toBe('failed');
  });

  test('null attempts_used is treated as zero (defensive against RPC nulls)', () => {
    expect(
      mapCard(row({ attempts_used: null as unknown as number })).status,
    ).toBe('not_started');
  });
});

describe('field mapping', () => {
  test('snake_case → camelCase with null-guards', () => {
    const card = mapCard(
      row({ question_count: null as unknown as number, sort_order: null as unknown as number }),
    );
    expect(card.questionCount).toBe(0);
    expect(card.order).toBe(0);
    expect(card.timeLimitSec).toBe(600);
    expect(card.passScore).toBe(5);
  });
});
