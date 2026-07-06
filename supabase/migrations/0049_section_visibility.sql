-- =============================================================================
-- 0049_section_visibility.sql
-- المَحجّة البَيْضَاء — section gender scope (الكل / رجال / نساء).
--
-- Admins can scope a section — and everything nested under it — to رجال أو
-- نساء أو الكل (default). "Most restrictive wins": a section is visible to a
-- viewer only if IT and EVERY ONE of its ancestors resolve to 'all' or match
-- the viewer's own gender; a guest (gender is null) only ever sees subtrees
-- where the whole chain is 'all' — same safe-default posture as 0015's
-- null-gender exclusion in search_buddy_candidates.
--
-- Admin/publisher reads are unaffected (public.is_content_manager(), the same
-- bypass 0023 already uses to let publishers see draft lectures/quizzes).
--
-- Touches (via create or replace, reproducing each function's exact existing
-- body from 0001/0045/0047 plus the added filter):
--   * get_section_page  (0045) — the requested section AND its subsections list
--   * get_home_page     (0047) — the root sections grid, the أُضيف حديثاً rail,
--                                 and the تابع الاستماع (resume) card
--   * get_sections_flat (0001) — the plain flat-tree RPC behind
--                                 src/api/sections.ts's getSectionsFlat()
--
-- NOT touched (see report for why): get_section_rollup / get_children_rollups
-- (rollup COUNTS may still include descendants hidden from the viewer — those
-- functions aggregate lecture counts over a raw subtree walk with no gender
-- awareness, and were out of the reviewed scope for this migration), and
-- get_featured_lectures (0038, a separate curated-picks function, unreviewed).
--
-- Append-only migration — 0001–0048 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- sections.visibility
-- ---------------------------------------------------------------------------
alter table public.sections
  add column if not exists visibility text not null default 'all'
    check (visibility in ('all', 'male', 'female'));

-- ---------------------------------------------------------------------------
-- Recursive ancestor-chain visibility check ("most restrictive wins").
-- SECURITY INVOKER — sections is world-readable (authenticated) already, and
-- reading one's own profiles.gender is allowed under the existing
-- profiles_select RLS policy (id = auth.uid()), so no elevation is needed.
-- ---------------------------------------------------------------------------
create or replace function public.section_visible_to_viewer(
  p_section_id uuid,
  p_gender     text
)
returns boolean
language sql stable security invoker set search_path = public as $$
  with recursive anc as (
    select id, parent_id, visibility
      from public.sections
     where id = p_section_id
    union all
    select s.id, s.parent_id, s.visibility
      from public.sections s
      join anc a on s.id = a.parent_id
  )
  select not exists (
    select 1 from anc
     where not (
       visibility = 'all'
       or (p_gender is not null and visibility = p_gender)
     )
  );
$$;

revoke all on function public.section_visible_to_viewer(uuid, text) from public;
grant execute on function public.section_visible_to_viewer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_section_page — reproduced from 0045 verbatim, + visibility filter on
-- `sec` (the requested section itself — hidden ⇒ whole function returns null,
-- same "not found" path the client already handles) and `subs` (children).
-- Note: because the check walks the WHOLE ancestor chain, if `sec` passes,
-- every ancestor (incl. the immediate parent used for parent_title) already
-- passed too — no separate masking needed for parent_title.
-- ---------------------------------------------------------------------------
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

revoke all on function public.get_section_page(uuid) from public;
grant execute on function public.get_section_page(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_home_page — reproduced from 0047 verbatim, + visibility filter on:
--   * roots   (the sections grid)
--   * newest  (أُضيف حديثاً rail) — filtered by the lecture's OWN section, so a
--     lecture belonging to a hidden section can't leak via this rail either
--     (judgment call — see report item (b): the task's literal wording is
--     about "a section... returned", this extends the same intent to "and
--     everything nested under it" from the task's own opening framing).
--   * resume  (تابع الاستماع card) — same reasoning; `l.section_id is null`
--     kept as a defensive no-op passthrough (shouldn't occur for published
--     lectures in practice, but avoids a behavior change for that edge case).
-- `featured` (get_featured_lectures()) is NOT filtered — separate, unreviewed
-- function, flagged as a known gap in the report.
-- ---------------------------------------------------------------------------
create or replace function public.get_home_page()
returns jsonb
language sql stable security invoker set search_path = public as $$
  with roots as (
    select id, title, cover_letter, "order"
      from public.sections
     where parent_id is null
       and (
         public.is_content_manager()
         or public.section_visible_to_viewer(
              id, (select gender from public.profiles where id = auth.uid())
            )
       )
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
       and (
         public.is_content_manager()
         or public.section_visible_to_viewer(
              l.section_id, (select gender from public.profiles where id = auth.uid())
            )
       )
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
       and (
         l.section_id is null
         or public.is_content_manager()
         or public.section_visible_to_viewer(
              l.section_id, (select gender from public.profiles where id = auth.uid())
            )
       )
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

revoke all on function public.get_home_page() from public, anon;
grant execute on function public.get_home_page() to authenticated;

-- ---------------------------------------------------------------------------
-- get_sections_flat — reproduced from 0001 verbatim, + the SAME filter logic
-- ("Also update whatever RPC/query backs the plain sections list in
-- src/api/sections.ts"). Today the client only ever calls this from the admin
-- screen (getSectionsFlat → useSectionsFlat → app/admin/sections.tsx +
-- TreePicker), so is_content_manager() means admins/publishers keep seeing the
-- full tree unchanged. The gender filter is added anyway as defense-in-depth,
-- consistent with CLAUDE.md's "enforced by RLS/server-side, not just query
-- filters" — this RPC is `grant execute to authenticated`, so a non-admin
-- session could otherwise call it directly and enumerate every section title.
-- ---------------------------------------------------------------------------
create or replace function public.get_sections_flat()
returns table (
  id        uuid,
  title     text,
  parent_id uuid,
  depth     integer,
  path      text[]
)
language sql stable security invoker set search_path = public as $$
  with recursive tree as (
    select s.id, s.title, s.parent_id, 0 as depth, array[s.title] as path
      from public.sections s
     where s.parent_id is null
    union all
    select s.id, s.title, s.parent_id, t.depth + 1, t.path || s.title
      from public.sections s
      join tree t on s.parent_id = t.id
  )
  select id, title, parent_id, depth, path
    from tree
   where public.is_content_manager()
      or public.section_visible_to_viewer(
           id, (select gender from public.profiles where id = auth.uid())
         )
   order by path;
$$;

revoke all on function public.get_sections_flat() from public;
grant execute on function public.get_sections_flat() to authenticated;
