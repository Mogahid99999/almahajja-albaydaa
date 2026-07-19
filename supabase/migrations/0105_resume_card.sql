-- =============================================================================
-- 0105 · «واصل رحلتك» resume card (V20 · §3)
--
-- One RPC that builds the whole resume card server-side (CLAUDE.md: rollups are
-- SQL, never client tree-walking). Picks the student's single most-recently-
-- active lecture and returns everything §3 shows:
--   * the section breadcrumb (up to 3 ancestor titles, outermost→innermost)
--   * the current lesson title + its 1-based order within its section
--   * the immediate section's completed/total counts (series %)
--   * pause position (seconds) and whether the current lesson is completed
--   * the NEXT lesson (title + id) in the same section, if any
--
-- "Most-recently-active" = the newest user_lecture_progress row (completed or
-- not). If that lesson is already completed, the card shows the next-lesson
-- variant; otherwise the resume variant. Everything is scoped to auth.uid() via
-- security invoker + the existing RLS on user_lecture_progress.
--
-- Append-only, idempotent. Never edit an applied migration.
-- =============================================================================

create or replace function public.get_resume_card()
returns table (
  lecture_id          uuid,
  lecture_title       text,
  section_id          uuid,
  position_sec        integer,
  duration_sec        integer,
  completed           boolean,
  updated_at          timestamptz,
  lesson_order        bigint,   -- 1-based position of this lesson in its section
  section_total       bigint,   -- published lessons in the immediate section
  section_completed   bigint,   -- of those, how many this user completed
  breadcrumb          text[],   -- ancestor section titles, outermost → innermost
  next_lecture_id     uuid,
  next_lecture_title  text
)
language sql stable security invoker set search_path = public as $$
  with recursive latest as (
    -- The single most-recently-touched lesson for this user.
    select p.lecture_id, p.position_sec, p.completed, p.updated_at
      from public.user_lecture_progress p
     where p.user_id = auth.uid()
     order by p.updated_at desc
     limit 1
  ),
  cur as (
    select l.id, l.title, l.section_id, l."order", l.duration_sec,
           la.position_sec, la.completed, la.updated_at
      from latest la
      join public.lectures l on l.id = la.lecture_id
  ),
  -- Ancestor chain of the current lesson's section (self → root), then reversed
  -- to outermost→innermost and capped to the last 3 for the breadcrumb.
  ancestors as (
    select s.id, s.title, s.parent_id, 0 as depth
      from public.sections s
      join cur on cur.section_id = s.id
    union all
    select p.id, p.title, p.parent_id, a.depth + 1
      from public.sections p
      join ancestors a on a.parent_id = p.id
  ),
  crumb as (
    select array_agg(title order by depth desc) as titles
      from (
        select title, depth from ancestors order by depth asc limit 3
      ) t
  ),
  -- Immediate-section rollup: published lessons + this user's completed count,
  -- and the current lesson's 1-based order among them.
  siblings as (
    select l.id, l."order",
           row_number() over (order by l."order", l.created_at) as ord,
           (p.lecture_id is not null and p.completed) as done
      from cur
      join public.lectures l
        on l.section_id = cur.section_id and l.status = 'published'
      left join public.user_lecture_progress p
        on p.lecture_id = l.id and p.user_id = auth.uid()
  ),
  agg as (
    select count(*) as total,
           count(*) filter (where done) as completed,
           max(ord) filter (where id = (select id from cur)) as cur_ord
      from siblings
  ),
  nxt as (
    -- The next published lesson in the section after the current one's order.
    select s.id
      from siblings s
     where s.ord = (select cur_ord from agg) + 1
     limit 1
  )
  select
    cur.id, cur.title, cur.section_id, cur.position_sec, cur.duration_sec,
    cur.completed, cur.updated_at,
    (select cur_ord from agg),
    (select total from agg),
    (select completed from agg),
    coalesce((select titles from crumb), '{}'::text[]),
    (select id from nxt),
    (select l.title from public.lectures l where l.id = (select id from nxt))
  from cur;
$$;

grant execute on function public.get_resume_card() to authenticated;
