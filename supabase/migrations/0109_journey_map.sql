-- =============================================================================
-- 0109 · «خريطة رحلتي» journey map (V20 · §6)
--
-- Lists the SERIES (immediate lesson-bearing sections) the student has touched —
-- one row per section that has ≥1 of the student's progress rows — with its
-- completed/total counts, %, the last lesson touched, and the next unfinished
-- lesson. Ordered by most-recent activity so the page can show the top few and a
-- «عرض الرحلة كاملة» for the rest. No plans, no locking (§6). Server-side rollup
-- (CLAUDE.md); scoped to auth.uid() via security invoker + RLS.
--
-- Append-only, idempotent. Never edit an applied migration.
-- =============================================================================

create or replace function public.get_journey_map()
returns table (
  section_id         uuid,
  section_title      text,
  parent_title       text,
  total_lectures     bigint,
  completed_lectures bigint,
  last_activity       timestamptz,
  next_lecture_id    uuid,
  next_lecture_title text
)
language sql stable security invoker set search_path = public as $$
  with touched as (
    -- Sections where this user has any progress row, with the section's counts
    -- and this user's last activity time in that section.
    select l.section_id,
           count(*)                                    as total,
           count(*) filter (where p.completed)         as completed,
           max(p.updated_at)                           as last_activity
      from public.lectures l
      join public.user_lecture_progress p
        on p.lecture_id = l.id and p.user_id = auth.uid()
     where l.status = 'published'
     group by l.section_id
  ),
  ranked as (
    -- The next unfinished published lesson in each touched section (lowest order
    -- among lessons the user hasn't completed).
    select l.section_id, l.id as lec_id, l.title,
           row_number() over (
             partition by l.section_id order by l."order", l.created_at
           ) as rn
      from public.lectures l
      left join public.user_lecture_progress p
        on p.lecture_id = l.id and p.user_id = auth.uid()
     where l.status = 'published'
       and (p.lecture_id is null or p.completed = false)
       and l.section_id in (select section_id from touched)
  )
  select
    t.section_id,
    s.title,
    ps.title,
    t.total,
    t.completed,
    t.last_activity,
    n.lec_id,
    n.title
  from touched t
  join public.sections s  on s.id = t.section_id
  left join public.sections ps on ps.id = s.parent_id
  left join ranked n on n.section_id = t.section_id and n.rn = 1
  order by t.last_activity desc nulls last;
$$;

grant execute on function public.get_journey_map() to authenticated;
revoke execute on function public.get_journey_map() from public, anon;
