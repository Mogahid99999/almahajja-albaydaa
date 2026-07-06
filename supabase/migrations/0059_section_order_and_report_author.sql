-- =============================================================================
-- 0059_section_order_and_report_author.sql
--
-- Two admin-panel fixes:
--
-- 1) get_sections_flat sorted the tree by TITLE path (`order by path`), so the
--    admin «الأقسام والشجرة» screen ignored the رقم الترتيب the admin typed —
--    while the student app (get_home_page/get_section_page, 0045/0049) sorts
--    by "order". Rebuilt to sort siblings by ("order", title) at every level
--    and to RETURN the order number (`ord`) so the screen can display it and
--    drive drag-and-drop. Return type changes → drop first. The 0049
--    visibility filter is preserved verbatim.
--
--    + admin_reorder_sections: persists a drag-and-drop result in one call —
--    takes the sibling ids in their new order and rewrites "order" = position.
--    Gated on is_content_manager() (same audience as the sections screen);
--    all ids must share one parent so a drag can never silently re-parent.
--
-- 2) admin_list_reports now resolves the AUTHOR of the reported content
--    (question asker / benefit writer) — id, display name, email — mirroring
--    admin_list_benefits (0030), so «البلاغات» can show who wrote the reported
--    content and offer a direct ban. Return type changes → drop first.
--
-- Append-only — 0001–0058 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a) get_sections_flat — order-number sort + ord column.
-- ---------------------------------------------------------------------------
drop function if exists public.get_sections_flat();

create function public.get_sections_flat()
returns table (
  id        uuid,
  title     text,
  parent_id uuid,
  depth     integer,
  path      text[],
  ord       integer
)
language sql stable security invoker set search_path = public as $$
  with recursive tree as (
    select s.id, s.title, s.parent_id, 0 as depth, array[s.title] as path,
           s."order" as ord,
           -- Sort key: zero-padded order + title at each level, so siblings
           -- follow their رقم الترتيب and ties fall back to the title.
           array[lpad(s."order"::text, 8, '0') || s.title] as sort_path
      from public.sections s
     where s.parent_id is null
    union all
    select s.id, s.title, s.parent_id, t.depth + 1, t.path || s.title,
           s."order",
           t.sort_path || (lpad(s."order"::text, 8, '0') || s.title)
      from public.sections s
      join tree t on s.parent_id = t.id
  )
  select id, title, parent_id, depth, path, ord
    from tree
   where public.is_content_manager()
      or public.section_visible_to_viewer(
           id, (select gender from public.profiles where id = auth.uid())
         )
   order by sort_path;
$$;

revoke all on function public.get_sections_flat() from public, anon;
grant execute on function public.get_sections_flat() to authenticated;

-- ---------------------------------------------------------------------------
-- 1b) admin_reorder_sections — persist a drag-and-drop order in one call.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reorder_sections(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_parents integer;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;
  -- All rows must exist and share ONE parent (drag-and-drop reorders siblings;
  -- it must never move a section under a different parent).
  select count(distinct coalesce(parent_id::text, 'root')) into v_parents
    from public.sections where id = any (p_ids);
  if v_parents <> 1
     or (select count(*) from public.sections where id = any (p_ids))
        <> array_length(p_ids, 1) then
    raise exception 'ترتيب غير صالح';
  end if;
  update public.sections s
     set "order" = x.pos
    from unnest(p_ids) with ordinality as x(sid, pos)
   where s.id = x.sid;
end;
$$;

revoke all on function public.admin_reorder_sections(uuid[]) from public, anon;
grant execute on function public.admin_reorder_sections(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) admin_list_reports — + author of the reported content.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_reports(text);

create function public.admin_list_reports(p_status text default null)
returns table (
  id            uuid,
  content_type  text,
  content_id    uuid,
  content_body  text,
  reason        text,
  status        text,
  reporter_id   uuid,
  reporter_name text,
  author_id     uuid,
  author_name   text,
  author_email  text,
  created_at    timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    r.id, r.content_type, r.content_id,
    case r.content_type
      when 'question' then (select q.body from public.questions q where q.id = r.content_id)
      when 'benefit'  then (select b.body from public.lecture_benefits b where b.id = r.content_id)
    end,
    r.reason, r.status, r.reporter_id,
    case when r.reporter_id is null then null
         else coalesce(p.display_name, 'طالب علم') end,
    a.author_id,
    case when a.author_id is null then null
         else coalesce(ap.display_name, 'طالب علم') end,
    au.email::text,
    r.created_at
  from public.content_reports r
  left join public.profiles p on p.id = r.reporter_id
  left join lateral (
    select case r.content_type
      when 'question' then (select q.asker_id from public.questions q where q.id = r.content_id)
      when 'benefit'  then (select b.user_id  from public.lecture_benefits b where b.id = r.content_id)
    end as author_id
  ) a on true
  left join public.profiles ap on ap.id = a.author_id
  left join auth.users au on au.id = a.author_id
  where (p_status is null or r.status = p_status)
  order by r.created_at desc
  limit 500;
end;
$$;

grant execute on function public.admin_list_reports(text) to authenticated;
