-- =============================================================================
-- 0058_search_content.sql
-- المَحجّة البَيْضَاء — lecture/section search for the new bottom-nav search screen.
--
-- SECURITY INVOKER — runs with the caller's identity so RLS still applies
-- (published-only content). Mirrors the ilike search pattern already used by
-- search_buddy_candidates (0015) and admin_user_list (0025).
--
-- Returns one jsonb document: { lectures:[...], sections:[...] }, each capped
-- at 20 rows, ordered by title. Empty/blank search returns empty arrays (the
-- client only calls this once the user has typed something).
-- =============================================================================
create or replace function public.search_content(p_search text)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with q as (
    select trim(coalesce(p_search, '')) as term
  ),
  matched_lectures as (
    select l.id, l.title, coalesce(l.duration_sec, 0) as duration_sec,
           sh.name as sheikh_name, s.title as section_title
      from public.lectures l
      cross join q
      left join public.sheikhs sh on sh.id = l.sheikh_id
      left join public.sections s on s.id = l.section_id
     where q.term <> ''
       and l.status = 'published'
       and l.title ilike '%' || q.term || '%'
     order by l.title
     limit 20
  ),
  matched_sections as (
    select s.id, s.title, s.cover_letter
      from public.sections s, q
     where q.term <> ''
       and s.title ilike '%' || q.term || '%'
     order by s.title
     limit 20
  )
  select jsonb_build_object(
    'lectures', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ml.id, 'title', ml.title, 'duration_sec', ml.duration_sec,
          'sheikh_name', ml.sheikh_name, 'section_title', ml.section_title
        )
      ) from matched_lectures ml
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', ms.id, 'title', ms.title, 'cover_letter', ms.cover_letter)
      ) from matched_sections ms
    ), '[]'::jsonb)
  );
$$;

-- Execute hygiene (0039): no PUBLIC/anon; authenticated (incl. native guests) only.
revoke all on function public.search_content(text) from public, anon;
grant execute on function public.search_content(text) to authenticated;
