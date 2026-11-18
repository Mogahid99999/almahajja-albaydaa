-- =============================================================================
-- 0169_my_certificates.sql
-- المَحجّة البَيْضَاء — «شهاداتي»: the student's certificate sections.
--
-- Certificates phase 2 (student experience). One read RPC for the signed-in
-- user, used by «شهاداتي» (earned + «قيد الإنجاز») and to mark the sections
-- that grant a certificate («شهادة إتمام») on section cards / the section page.
--
-- It does NOT re-derive eligibility: every row is certificate_eligibility(…)
-- (0168) for that section and the caller — the single source of truth, with its
-- content_scope, gender filter, pending-grading rule and all.
--
-- Which sections appear (the student never sees what he cannot reach):
--   * the certificate is enabled (section_certificate_settings.enabled);
--   * the section is visible to the caller's gender (section_visible_to_viewer,
--     the same ancestor-chain rule the section pages use);
--   * the certificate's content has at least one lecture for this student
--     (lectures.total > 0) — a certificate that can never be earned (e.g.
--     «هذا القسم فقط» on a section with no lecture of its own) is not offered.
--
-- Row: { section_id, title, parent_title, ancestor_ids, eligibility: <certificate_eligibility> }
-- ancestor_ids: every section above this one (nearest first). A main section with
-- no certificate of its own still carries the «شهادة إتمام» mark on its card when
-- a section inside it grants one. No leak: section_visible_to_viewer walks the
-- whole ancestor chain, so a listed section's ancestors are all visible too.
-- Order: earned first, then the ones in progress by how far along they are,
-- then by title.
--
-- No issuing here (no certificate number / PDF / QR — next phase). No writes.
-- Append-only. Idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================

create or replace function public.get_my_certificates()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_gender text;
  r        record;
  e        jsonb;
  v_rows   jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select gender into v_gender from public.profiles where id = v_uid;

  for r in
    select s.id, s.title, p.title as parent_title
      from public.section_certificate_settings c
      join public.sections s on s.id = c.section_id
      left join public.sections p on p.id = s.parent_id
     where c.enabled
       and public.section_visible_to_viewer(s.id, v_gender)
  loop
    e := public.certificate_eligibility(r.id, v_uid);
    if coalesce((e -> 'lectures' ->> 'total')::int, 0) > 0 then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'section_id',   r.id,
        'title',        r.title,
        'parent_title', r.parent_title,
        'ancestor_ids', (
          with recursive anc as (
            select s.parent_id as id, 1 as depth from public.sections s where s.id = r.id
            union all
            select s.parent_id, a.depth + 1
              from anc a join public.sections s on s.id = a.id
             where a.id is not null
          )
          select coalesce(jsonb_agg(a.id order by a.depth), '[]'::jsonb)
            from anc a where a.id is not null
        ),
        'eligibility',  e));
    end if;
  end loop;

  return coalesce((
    select jsonb_agg(x order by
             (x -> 'eligibility' ->> 'eligible')::boolean desc,
             (x -> 'eligibility' -> 'lectures' ->> 'completed_pct')::numeric desc,
             x ->> 'title')
      from jsonb_array_elements(v_rows) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_my_certificates() from public, anon;
grant execute on function public.get_my_certificates() to authenticated;
