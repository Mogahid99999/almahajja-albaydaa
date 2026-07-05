-- =============================================================================
-- 0045_get_section_page.sql
-- المَحجّة البَيْضَاء — V10 Perf C: one RPC per section page.
--
-- getSectionPage() used to make ~6 sequential PostgREST round-trips (section +
-- rollup → parent title → children → children rollups → lectures+progress →
-- attachments → quizzes). Over mobile data that's the multi-second «العقيدة»
-- open the owner sees, even for empty sections. This function returns the whole
-- section page as ONE jsonb document so the client makes a single call.
--
-- SECURITY INVOKER — runs with the caller's identity, so RLS still applies
-- (published-only for students/guests falls out of existing policies) and the
-- joined progress is always the caller's (auth.uid()). It REUSES the existing
-- recursive rollup functions (get_section_rollup / get_children_rollups) and the
-- quiz-status function (get_section_quizzes) rather than duplicating their CTEs.
-- Attachments are returned raw (storage_path / external_url) — the client mints
-- signed URLs in the api layer (resolveAttachmentRows), exactly as before.
--
-- Append-only migration — 0001–0044 are never edited. Idempotent.
-- =============================================================================
create or replace function public.get_section_page(p_section_id uuid)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with sec as (
    select id, title, description, cover_image, cover_letter, show_header, parent_id
      from public.sections
     where id = p_section_id
  ),
  rollup as (
    select total_lectures, completed_lectures, sheikh_names
      from public.get_section_rollup(p_section_id)
  ),
  subs as (
    select id, title, cover_letter, "order"
      from public.sections
     where parent_id = p_section_id
  ),
  sub_rollups as (
    select section_id, total_lectures, completed_lectures
      from public.get_children_rollups(array(select id from subs))
  ),
  lecs as (
    select l.id, l.title, l.duration_sec, l."order" as ord,
           sh.name as sheikh_name,
           coalesce(p.position_sec, 0) as position_sec,
           coalesce(p.completed, false) as completed
      from public.lectures l
      left join public.sheikhs sh on sh.id = l.sheikh_id
      left join public.user_lecture_progress p
        on p.lecture_id = l.id and p.user_id = auth.uid()
     where l.section_id = p_section_id and l.status = 'published'
  ),
  atts as (
    select id, type, title, description, storage_path, external_url, body, "order" as ord
      from public.attachments
     where section_id = p_section_id
  ),
  qz as (
    select * from public.get_section_quizzes(p_section_id)
  )
  select case when not exists (select 1 from sec) then null else
    jsonb_build_object(
      'section', (
        select jsonb_build_object(
          'id', id, 'title', title, 'description', description,
          'cover_image', cover_image, 'cover_letter', cover_letter,
          'show_header', show_header, 'parent_id', parent_id
        ) from sec
      ),
      'parent_title', (
        select p.title from public.sections p
         where p.id = (select parent_id from sec)
      ),
      'rollup', jsonb_build_object(
        'total', coalesce((select total_lectures from rollup), 0),
        'completed', coalesce((select completed_lectures from rollup), 0),
        'sheikh_names', to_jsonb(coalesce((select sheikh_names from rollup), '{}'::text[]))
      ),
      'subsections', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id, 'title', s.title, 'cover_letter', s.cover_letter,
            'total', coalesce(r.total_lectures, 0),
            'completed', coalesce(r.completed_lectures, 0)
          ) order by s."order"
        )
        from subs s
        left join sub_rollups r on r.section_id = s.id
      ), '[]'::jsonb),
      'lectures', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id, 'title', title,
            'duration_sec', coalesce(duration_sec, 0),
            'order', ord, 'sheikh_name', sheikh_name,
            'position_sec', position_sec, 'completed', completed
          ) order by ord
        ) from lecs
      ), '[]'::jsonb),
      'attachments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id, 'type', type, 'title', title, 'description', description,
            'storage_path', storage_path, 'external_url', external_url,
            'body', body, 'order', ord
          ) order by ord
        ) from atts
      ), '[]'::jsonb),
      'quizzes', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id, 'title', title, 'description', description,
            'pass_score', pass_score, 'time_limit_sec', time_limit_sec,
            'max_attempts', max_attempts, 'sort_order', sort_order,
            'question_count', question_count, 'total_score', total_score,
            'attempts_used', attempts_used, 'attempts_left', attempts_left,
            'best_score', best_score, 'passed', passed,
            'in_progress_attempt_id', in_progress_attempt_id,
            'last_result_attempt_id', last_result_attempt_id
          ) order by sort_order
        ) from qz
      ), '[]'::jsonb)
    )
  end;
$$;

-- Execute hygiene (0039 convention): no PUBLIC/anon; authenticated (incl. native
-- guests, who hold an anonymous authenticated session) only.
revoke all on function public.get_section_page(uuid) from public;
grant execute on function public.get_section_page(uuid) to authenticated;
