/**
 * ملاحظاتي data access (V6 Feature B) — one strictly-private note per lesson.
 *
 * Direct table access under own-rows RLS (migration 0029): nobody but the
 * author can read a note, so no DEFINER RPC is needed. The client upserts on
 * the (user_id, lecture_id) PK — the editor debounces saves.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type LectureNote = {
  body: string;
  updatedAt: string;
};

/** The caller's note for one lecture, or null when none exists yet. */
export async function getMyNote(lectureId: string): Promise<LectureNote | null> {
  if (USE_MOCK) return null;
  const { data, error } = await supabase
    .from('lecture_notes')
    .select('body, updated_at')
    .eq('lecture_id', lectureId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { body: data.body, updatedAt: data.updated_at };
}

export async function saveMyNote(lectureId: string, body: string): Promise<void> {
  if (USE_MOCK) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('يلزم تسجيل الدخول');
  const { error } = await supabase
    .from('lecture_notes')
    .upsert(
      { user_id: user.id, lecture_id: lectureId, body },
      { onConflict: 'user_id,lecture_id' },
    );
  if (error) throw error;
}
