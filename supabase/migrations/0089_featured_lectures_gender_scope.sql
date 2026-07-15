-- =============================================================================
-- 0089_featured_lectures_gender_scope.sql
-- المَحجّة البَيْضَاء — Audit Phase 2 (F-202): gender-scope the مختارات (featured)
-- rail so it can't leak رجال/نساء-only lectures across gender.
--
-- 0049 taught every browse RPC (get_home_page / get_section_page /
-- get_sections_flat / search_content) to hide a gender-restricted section
-- subtree from the other gender via section_visible_to_viewer(). 0049's own
-- header flags get_featured_lectures as an UNREVIEWED gap, and it was never
-- closed: get_featured_lectures (0038, last rebuilt 0069) has NO visibility
-- filter, and get_home_page (0047/0049) pulls its `featured` array straight from
-- it. So a lecture curated from a نساء-only (or رجال-only) section:
--   * appears on the OTHER gender's Home «مختارات» rail and full-list screen, and
--   * its audio is then served — can_read_storage_object (0063) gates lecture
--     objects on published status only, never gender, so once the key is on
--     screen the R2 read-url function signs it.
-- The featured rail is the practical discovery path for that key (every other
-- read path is already gender-filtered), so closing it here removes the leak.
--
-- Fix: reproduce 0069's get_featured_lectures body verbatim (incl.
-- audio_size_bytes) and add the SAME visibility predicate the browse RPCs use:
--   * content managers (admin/publisher) keep seeing everything (0049 bypass);
--   * an unclassified featured lecture (section_id null — nothing to scope) stays
--     visible, mirroring get_home_page's `l.section_id is null` resume passthrough;
--   * otherwise the lecture's section (and its whole ancestor chain) must be
--     visible to the caller's gender.
-- INVOKER is preserved, so auth.uid()/gender always resolve to the caller — the
-- same per-caller filtering get_home_page relies on when it calls this.
--
-- Append-only — 0001–0088 are never edited. Idempotent.
-- =============================================================================
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
  where public.is_content_manager()
     or l.section_id is null
     or public.section_visible_to_viewer(
          l.section_id, (select gender from public.profiles where id = auth.uid())
        )
  order by f."order" asc, f.created_at asc;
$$;

-- Execute hygiene (0039): no PUBLIC/anon; authenticated (incl. native guests) only.
revoke all on function public.get_featured_lectures() from public, anon;
grant execute on function public.get_featured_lectures() to authenticated;
