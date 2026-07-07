-- =============================================================================
-- 0063_r2_storage_read_gate.sql
-- المَحجّة البَيْضَاء — Cloudflare R2 storage migration, read-gate function.
--
-- Storage is moving from Supabase Storage buckets (`lectures`, `attachments`)
-- to a single private Cloudflare R2 bucket. R2 has no per-object ACLs / RLS —
-- object reads are authorized by a Supabase Edge Function (`r2-read-url`)
-- before it mints a short-lived presigned GET, so the same draft/published
-- gating `0040_storage_draft_scope.sql` put on `storage.objects` needs a SQL
-- entry point that function can call.
--
-- `can_read_storage_object(p_key)` ports the exact predicate from 0040:
--   - key under `lectures/`    → is_content_manager() OR the owning lecture
--                                 (audio_path = p_key) is published.
--   - key under `attachments/` → is_content_manager() OR the owning attachment
--                                 (storage_path = p_key) has no publish gate
--                                 (section-level) or its lecture is published.
--   - anything else            → false (unknown prefix, deny).
--
-- Additive only — the old `storage.objects` policies (0001/0002/0023/0040) and
-- the Supabase Storage buckets themselves are left in place as a rollback
-- safety net until the R2 cutover is verified and the old buckets are emptied.
-- Append-only — 0001–0062 are never edited. Idempotent (create or replace).
-- =============================================================================

create or replace function public.can_read_storage_object(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_key like 'lectures/%' then
      public.is_content_manager()
      or exists (
        select 1 from public.lectures l
        where l.audio_path = p_key and l.status = 'published'
      )
    when p_key like 'attachments/%' then
      public.is_content_manager()
      or exists (
        select 1 from public.attachments a
        where a.storage_path = p_key
          and (
            a.section_id is not null
            or exists (
              select 1 from public.lectures l
              where l.id = a.lecture_id and l.status = 'published'
            )
          )
      )
    else false
  end;
$$;

grant execute on function public.can_read_storage_object(text) to authenticated;
