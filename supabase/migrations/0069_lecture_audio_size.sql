-- =============================================================================
-- 0069_lecture_audio_size.sql
-- المَحجّة البَيْضَاء — lecture audio file size (shown next to the download icon).
--
-- Adds lectures.audio_size_bytes (set by the admin upload form from the picked/
-- transcoded file's real byte length — src/api/admin.ts createLecture) and
-- surfaces it through get_section_page so the section lecture list can render
-- "١٢٫٣ ميجابايت" next to the download button without a per-row HEAD request.
-- Nullable: older rows and any lecture uploaded before this migration simply
-- render no size label (client treats null as "unknown").
--
-- Touches (via create or replace, reproducing each function's exact existing
-- body plus the added field): get_section_page (0045/0049), get_featured_lectures
-- (0038) — the «مختارات» full-list screen renders through the same
-- LectureRowItem/DownloadButton as the section page.
--
-- Append-only migration — 0001–0068 are never edited. Idempotent.
-- =============================================================================

alter table public.lectures
  add column if not exists audio_size_bytes bigint;

create or replace function public.get_section_page(p_section_id uuid)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with sec as (
    select id, title, description, cover_image, cover_letter, show_header, parent_id
      from public.sections
     where id = p_section_id
       and (
         public.is_content_manager()
         or public.section_visible_to_viewer(
              id, (select gender from public.profiles where id = auth.uid())
            )
       )
  ),
  rollup as (
    select total_lectures, completed_lectures, sheikh_names
      from public.get_section_rollup(p_section_id)
  ),
  subs as (
    select id, title, cover_letter, "order"
      from public.sections
     where parent_id = p_section_id
       and (
         public.is_content_manager()
         or public.section_visible_to_viewer(
              id, (select gender from public.profiles where id = auth.uid())
            )
       )
  ),
  sub_rollups as (
    select section_id, total_lectures, completed_lectures
      from public.get_children_rollups(array(select id from subs))
  ),
  lecs as (
    select l.id, l.title, l.duration_sec, l.audio_size_bytes, l."order" as ord,
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
            'audio_size_bytes', audio_size_bytes,
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

revoke all on function public.get_section_page(uuid) from public;
grant execute on function public.get_section_page(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_featured_lectures — reproduced from 0038 verbatim, + audio_size_bytes.
-- ---------------------------------------------------------------------------
create or replace function public.get_featured_lectures()
returns table (
  lecture_id       uuid,
  title            text,
  duration_sec     integer,
  audio_size_bytes bigint,
  sheikh_name      text,
  section_title    text,
  "order"          integer,
  position_sec     integer,
  completed        boolean
)
language sql stable security invoker set search_path = public as $$
  select
    l.id,
    l.title,
    l.duration_sec,
    l.audio_size_bytes,
    sh.name,
    s.title,
    f."order",
    coalesce(p.position_sec, 0),
    coalesce(p.completed, false)
  from public.featured_lectures f
  join public.lectures l
    on l.id = f.lecture_id and l.status = 'published'
  left join public.sheikhs sh on sh.id = l.sheikh_id
  left join public.sections s on s.id = l.section_id
  left join public.user_lecture_progress p
    on p.lecture_id = l.id and p.user_id = auth.uid()
  order by f."order" asc, f.created_at asc;
$$;

grant execute on function public.get_featured_lectures() to authenticated;
