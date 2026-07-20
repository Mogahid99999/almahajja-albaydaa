-- =============================================================================
-- 0117 · «مراجعة الفوائد» — series-scoped shared benefits (V20 · Feature A)
--
-- The closing «ملخص إتمام السلسلة» page links to a review of the فوائد across the
-- whole series. This RPC returns every VISIBLE benefit written on any published
-- lesson in the section's recursive subtree, each tagged with its lecture title
-- (so the reader sees "in which lesson") and `is_mine` (to mark «فائدتك»). It
-- NEVER selects the author identity — same anonymity contract as
-- get_lecture_benefits (0030): security definer, body + is_mine + timestamps only.
--
-- Server-side subtree walk (CLAUDE.md: no client tree-walking). SECURITY DEFINER
-- so the recursive section read isn't gated by per-row section RLS; the benefit
-- rows are already public-anonymous by design. REVOKEd from anon (convention).
--
-- Append-only, idempotent. Never edit an applied migration.
-- =============================================================================

create or replace function public.get_series_benefits(p_section_id uuid)
returns table (
  id            uuid,
  lecture_id    uuid,
  lecture_title text,
  lecture_order integer,
  body          text,
  is_mine       boolean,
  created_at    timestamptz
)
language sql stable security definer set search_path = public as $$
  with recursive subtree as (
    select s.id from public.sections s where s.id = p_section_id
    union all
    select c.id from public.sections c join subtree t on c.parent_id = t.id
  ),
  lec as (
    select l.id, l.title, l."order"
      from public.lectures l
     where l.section_id in (select id from subtree)
       and l.status = 'published'
  )
  select b.id, b.lecture_id, lec.title, lec."order",
         b.body, b.user_id = auth.uid(), b.created_at
    from public.lecture_benefits b
    join lec on lec.id = b.lecture_id
   where b.status = 'visible'
   order by lec."order", lec.title, b.created_at desc
   limit 500;
$$;

grant execute on function public.get_series_benefits(uuid) to authenticated;
revoke execute on function public.get_series_benefits(uuid) from public, anon;
