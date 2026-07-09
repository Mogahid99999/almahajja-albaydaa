-- =============================================================================
-- 0067_admin_reorder_lectures.sql
--
-- Drag-and-drop reordering for lectures within a section, mirroring
-- admin_reorder_sections (0059). Takes sibling lecture ids in their new
-- display order and rewrites "order" = position. All ids must share ONE
-- non-null section_id, so a drag can never silently move a lecture into
-- another section or into the unclassified queue.
--
-- Append-only — 0001–0066 are never edited. Idempotent.
-- =============================================================================

create or replace function public.admin_reorder_lectures(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sections integer;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;
  -- All rows must exist, share ONE section, and that section must be set
  -- (an unclassified lecture has no order to reorder against).
  select count(distinct section_id) into v_sections
    from public.lectures where id = any (p_ids);
  if v_sections <> 1
     or (select count(*) from public.lectures where id = any (p_ids) and section_id is not null)
        <> array_length(p_ids, 1) then
    raise exception 'ترتيب غير صالح';
  end if;
  update public.lectures l
     set "order" = x.pos
    from unnest(p_ids) with ordinality as x(lid, pos)
   where l.id = x.lid;
end;
$$;

revoke all on function public.admin_reorder_lectures(uuid[]) from public, anon;
grant execute on function public.admin_reorder_lectures(uuid[]) to authenticated;
