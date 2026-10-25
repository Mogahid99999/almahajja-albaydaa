-- =============================================================================
-- 0153_lecture_lists_visibility_server_side.sql
-- المَحجّة البَيْضَاء — PERF + correctness: gender visibility for the featured
-- and recent lecture lists is decided by the SERVER (audit phase 4 «Phase 2»).
--
-- Until now the app filtered «المختارات» (Home leg + full screen) and «أحدث
-- الدروس» CLIENT-side with one lecture_visible_to_viewer RPC PER LECTURE
-- (filterVisibleLectures) — 8–24 extra requests on every Home open, which is
-- exactly the burst a push wave multiplies (2026-10-02 incident).
--
--   * get_featured_lectures(): same columns/order, now scoped with the 0049
--     rule (section_visible_to_viewer with the caller's gender); content
--     managers see everything, as before. get_home_page's featured leg calls
--     it, so Home is scoped too — old app versions keep working (their extra
--     per-lecture checks simply all pass).
--   * get_recent_lectures(p_limit): new — the «أحدث الدروس» list, filtered
--     BEFORE the limit (the client used to over-fetch 3× and filter), with the
--     caller's progress folded in.
--
-- The app release that drops filterVisibleLectures needs THIS applied first.
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

create or replace function public.get_featured_lectures()
returns table(lecture_id uuid, title text, duration_sec integer, audio_size_bytes bigint,
              sheikh_name text, section_title text, "order" integer, position_sec integer,
              completed boolean)
language sql
stable
set search_path = public
as $$
  with me as (
    select (select p.gender from public.profiles p where p.id = (select auth.uid())) as gender,
           (select public.is_content_manager()) as staff
  )
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
  cross join me
  join public.lectures l
    on l.id = f.lecture_id and l.status = 'published'
  left join public.sheikhs sh on sh.id = l.sheikh_id
  left join public.sections s on s.id = l.section_id
  left join public.user_lecture_progress p
    on p.lecture_id = l.id and p.user_id = (select auth.uid())
  where me.staff
     or l.section_id is null
     or public.section_visible_to_viewer(l.section_id, me.gender)
  order by f."order" asc, f.created_at asc;
$$;

create or replace function public.get_recent_lectures(p_limit integer default 8)
returns table(id uuid, title text, duration_sec integer, audio_size_bytes bigint,
              "order" integer, sheikh_name text, position_sec integer, completed boolean)
language sql
stable
set search_path = public
as $$
  with me as (
    select (select p.gender from public.profiles p where p.id = (select auth.uid())) as gender,
           (select public.is_content_manager()) as staff
  )
  select
    l.id,
    l.title,
    l.duration_sec,
    l.audio_size_bytes,
    l."order",
    sh.name,
    coalesce(p.position_sec, 0),
    coalesce(p.completed, false)
  from public.lectures l
  cross join me
  left join public.sheikhs sh on sh.id = l.sheikh_id
  left join public.user_lecture_progress p
    on p.lecture_id = l.id and p.user_id = (select auth.uid())
  where l.status = 'published'
    and l.section_id is not null
    and (me.staff or public.section_visible_to_viewer(l.section_id, me.gender))
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 50);
$$;
revoke all on function public.get_recent_lectures(integer) from public, anon;
grant execute on function public.get_recent_lectures(integer) to authenticated;
