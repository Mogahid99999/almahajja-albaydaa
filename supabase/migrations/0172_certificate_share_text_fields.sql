-- =============================================================================
-- 0172_certificate_share_text_fields.sql
-- «مشاركة الشهادة»: the certificate-files Edge Function needs the title and the
-- verification link to word the share text. Both come from the immutable snapshot.
-- No table, column or file changes: the shared image is the existing preview.
-- Rollback: restore certificate_files_for from 0170.
-- Append-only. Idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================
create or replace function public.certificate_files_for(p_id text, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when x.status = 'valid' and x.pdf_key is not null
                and (x.user_id = p_user
                     or exists (select 1 from public.profiles p where p.id = p_user and p.role in ('admin', 'publisher')))
              then jsonb_build_object('pdf_key', x.pdf_key, 'preview_key', x.preview_key,
                                      'title', x.snapshot ->> 'title',
                                      'verification_url', x.snapshot ->> 'verification_url')
         end
    from public.certificates x where x.id = upper(btrim(p_id));
$$;
revoke all on function public.certificate_files_for(text, uuid) from public, anon, authenticated;
grant execute on function public.certificate_files_for(text, uuid) to service_role;
