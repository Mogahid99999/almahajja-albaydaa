/**
 * أسئلة وأجوبة data access (V6 Feature A).
 *
 * Everything crosses the wire through the migration-0028 SECURITY DEFINER RPCs
 * — anonymity is enforced in SQL (an anonymous asker is NEVER identified to the
 * public or the sheikh; only admin RPC paths resolve authors). Reading is open
 * to guests; asking requires a registered account (server-gated in
 * ask_question, mirrored by the client register nudge). While `USE_MOCK` is
 * true everything returns inert empty shapes (quiz pattern).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type QuestionScope = 'general' | 'lecture';
export type QuestionAudience = 'public' | 'sheikh';
export type QuestionStatus = 'pending' | 'answered' | 'hidden';

/** A row in the public answered list. `askerDisplay` is null when anonymous. */
export type PublicQuestion = {
  id: string;
  body: string;
  answerBody: string | null;
  askerDisplay: string | null;
  isMine: boolean;
  createdAt: string;
  answeredAt: string | null;
};

/** The caller's own question, any status («سؤالك قيد المراجعة»). */
export type MyQuestion = {
  id: string;
  body: string;
  answerBody: string | null;
  isAnonymous: boolean;
  audience: QuestionAudience;
  status: QuestionStatus;
  createdAt: string;
  answeredAt: string | null;
};

/** Moderator inbox row. `askerId` ships only to admins (for حظر الكاتب). */
export type InboxQuestion = {
  id: string;
  scope: QuestionScope;
  lectureId: string | null;
  lectureTitle: string | null;
  body: string;
  answerBody: string | null;
  isAnonymous: boolean;
  audience: QuestionAudience;
  status: QuestionStatus;
  askerDisplay: string;
  askerId: string | null;
  createdAt: string;
  answeredAt: string | null;
};

export async function getPublicQuestions(
  scope: QuestionScope,
  lectureId?: string,
): Promise<PublicQuestion[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_public_questions', {
    p_scope: scope,
    ...(lectureId ? { p_lecture_id: lectureId } : {}),
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    body: r.body,
    answerBody: r.answer_body ?? null,
    askerDisplay: r.asker_display ?? null,
    isMine: !!r.is_mine,
    createdAt: r.created_at,
    answeredAt: r.answered_at ?? null,
  }));
}

export async function getMyQuestions(
  scope: QuestionScope,
  lectureId?: string,
): Promise<MyQuestion[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_my_questions', {
    p_scope: scope,
    ...(lectureId ? { p_lecture_id: lectureId } : {}),
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    body: r.body,
    answerBody: r.answer_body ?? null,
    isAnonymous: !!r.is_anonymous,
    audience: r.audience as QuestionAudience,
    status: r.status as QuestionStatus,
    createdAt: r.created_at,
    answeredAt: r.answered_at ?? null,
  }));
}

export async function askQuestion(input: {
  scope: QuestionScope;
  lectureId?: string;
  isAnonymous: boolean;
  audience: QuestionAudience;
  body: string;
}): Promise<string> {
  if (USE_MOCK) return '';
  // p_lecture_id has no SQL default — general questions must pass an explicit null.
  const { data, error } = await supabase.rpc('ask_question', {
    p_scope: input.scope,
    p_lecture_id: (input.lectureId ?? null) as unknown as string,
    p_is_anonymous: input.isAnonymous,
    p_audience: input.audience,
    p_body: input.body,
  });
  if (error) throw error;
  return data as string;
}

/** The asker removes their OWN question (any status) — 0031, own-rows in SQL. */
export async function deleteOwnQuestion(questionId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('delete_own_question', {
    p_question_id: questionId,
  });
  if (error) throw error;
}

// ─── Moderator (sheikh + admin) ───────────────────────────────────────────────

export async function getQuestionInbox(filter: {
  scope?: QuestionScope;
  status?: QuestionStatus;
}): Promise<InboxQuestion[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_question_inbox', {
    ...(filter.scope ? { p_scope: filter.scope } : {}),
    ...(filter.status ? { p_status: filter.status } : {}),
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    scope: r.scope as QuestionScope,
    lectureId: r.lecture_id ?? null,
    lectureTitle: r.lecture_title ?? null,
    body: r.body,
    answerBody: r.answer_body ?? null,
    isAnonymous: !!r.is_anonymous,
    audience: r.audience as QuestionAudience,
    status: r.status as QuestionStatus,
    askerDisplay: r.asker_display ?? 'طالب علم',
    askerId: r.asker_id ?? null,
    createdAt: r.created_at,
    answeredAt: r.answered_at ?? null,
  }));
}

export async function answerQuestion(questionId: string, answerBody: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('answer_question', {
    p_question_id: questionId,
    p_answer_body: answerBody,
  });
  if (error) throw error;
}

export async function deleteQuestion(questionId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('delete_question', {
    p_question_id: questionId,
  });
  if (error) throw error;
}

/** Reversibly hide (or unhide) a question — moderator only (0032). */
export async function setQuestionHidden(questionId: string, hidden: boolean): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('set_question_hidden', {
    p_question_id: questionId,
    p_hidden: hidden,
  });
  if (error) throw error;
}
