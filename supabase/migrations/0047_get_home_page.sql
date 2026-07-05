-- =============================================================================
-- 0047_get_home_page.sql
-- المَحجّة البَيْضَاء — V11 (D): one RPC per Home open.
--
-- getHomeData() made 5 SEQUENTIAL PostgREST round-trips (roots → children rollups
-- → أُضيف حديثاً → مختارات → continue-listening) — the same disease 0045 cured for
-- section pages. This returns the whole Home payload as ONE jsonb document.
--
-- SECURITY INVOKER — runs with the caller's identity so RLS still applies
-- (published-only content, own progress via auth.uid()). It REUSES the recursive
-- rollup function (get_children_rollups) and the curated-picks function
-- (get_featured_lectures) rather than duplicating their CTEs, exactly like 0045.
--
-- Shape (mirrors the client HomeData mapper — cover-letter fallback stays client-side):
--   { sections:[{id,title,cover_letter,total,completed}],
--     newly_added:[{id,title,duration_sec,sheikh_name,section_title}],
--     featured:[{lecture_id,title,duration_sec,sheikh_name,section_title,order,
--                position_sec,completed}],
--     continue_listening:{lecture_id,title,sheikh_name,section_title,
--                         position_sec,duration_sec} | null }
--
-- Append-only — 0001–0046 are never edited. Idempotent.
-- =============================================================================
create or replace function public.get_home_page()
returns jsonb
language sql stable security invoker set search_path = public as $$
  with roots as (
    select id, title, cover_letter, "order"
      from public.sections
     where parent_id is null
  ),
  root_rollups as (
    select section_id, total_lectures, completed_lectures
      from public.get_children_rollups(array(select id from roots))
  ),
  newest as (
    select l.id, l.title, coalesce(l.duration_sec, 0) as duration_sec,
           sh.name as sheikh_name, s.title as section_title, l.created_at
      from public.lectures l
      left join public.sheikhs sh on sh.id = l.sheikh_id
      left join public.sections s on s.id = l.section_id
     where l.status = 'published' and l.section_id is not null
     order by l.created_at desc
     limit 8
  ),
  resume as (
    select p.lecture_id, l.title, sh.name as sheikh_name, s.title as section_title,
           p.position_sec, coalesce(l.duration_sec, 0) as duration_sec, p.updated_at
      from public.user_lecture_progress p
      join public.lectures l on l.id = p.lecture_id
      left join public.sheikhs sh on sh.id = l.sheikh_id
      left join public.sections s on s.id = l.section_id
     where p.user_id = auth.uid() and p.completed = false and p.position_sec > 0
     order by p.updated_at desc
     limit 1
  )
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id, 'title', r.title, 'cover_letter', r.cover_letter,
          'total', coalesce(ru.total_lectures, 0),
          'completed', coalesce(ru.completed_lectures, 0)
        ) order by r."order"
      )
      from roots r
      left join root_rollups ru on ru.section_id = r.id
    ), '[]'::jsonb),
    'newly_added', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id, 'title', n.title, 'duration_sec', n.duration_sec,
          'sheikh_name', n.sheikh_name, 'section_title', n.section_title
        ) order by n.created_at desc
      ) from newest n
    ), '[]'::jsonb),
    'featured', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lecture_id', f.lecture_id, 'title', f.title, 'duration_sec', f.duration_sec,
          'sheikh_name', f.sheikh_name, 'section_title', f.section_title,
          'order', f."order", 'position_sec', f.position_sec, 'completed', f.completed
        ) order by f."order"
      ) from public.get_featured_lectures() f
    ), '[]'::jsonb),
    'continue_listening', (
      select jsonb_build_object(
        'lecture_id', rz.lecture_id, 'title', rz.title, 'sheikh_name', rz.sheikh_name,
        'section_title', rz.section_title, 'position_sec', rz.position_sec,
        'duration_sec', rz.duration_sec
      ) from resume rz
    )
  );
$$;

-- Execute hygiene (0039): no PUBLIC/anon; authenticated (incl. native guests) only.
revoke all on function public.get_home_page() from public, anon;
grant execute on function public.get_home_page() to authenticated;
