-- =============================================================================
-- 0139_live_raw_retention.sql
-- المَحجّة البَيْضَاء — V23 P2: raw live recordings leave the VPS disk as soon as
-- their R2 backup is confirmed.
--
-- Owner amendment (2026-09-28) to the raw-retention rule of 0134/0138:
--   * The local raw on the VPS (/recordings/<stg|prd>/…) is deleted
--     AUTOMATICALLY once the recording has been processed and its R2 backup
--     (live-raw/…) confirmed — no longer "lecture published ≥ 7 days". The worker
--     deletes it inline right after a successful job; live_raws_due_for_deletion
--     is the safety-net sweep.
--   * The R2 raw backup is KEPT — nothing deletes it automatically.
--
-- So live_raws_due_for_deletion() now lists every session whose lecture has
-- been created (lecture_id set, status 'ready' — the terminal state after
-- create_live_lecture) with raw_backup_key recorded and raw_deleted_at still
-- null. Same signature and return columns as 0138. mark_live_raw_deleted is
-- unchanged (it still refuses a session with no R2 backup), and
-- lecture_published_at stays (tracked by 0137, no longer used here).
--
-- Append-only (0138 is applied and never edited). Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

create or replace function public.live_raws_due_for_deletion()
returns table (session_id uuid, raw_path text, raw_backup_key text)
language sql stable security definer set search_path = public as $$
  select s.id, s.raw_path, s.raw_backup_key
    from public.live_sessions s
   where s.lecture_id is not null
     and s.status = 'ready'
     and s.raw_path is not null
     and s.raw_backup_key is not null
     and s.raw_deleted_at is null
   order by s.updated_at;
$$;
revoke all on function public.live_raws_due_for_deletion() from public, anon, authenticated;
grant execute on function public.live_raws_due_for_deletion() to service_role;

comment on column public.live_sessions.raw_path is
  'Egress file on the VPS disk (/recordings/<stg|prd>/<room>-<time>.ogg). Kept through every failure (staff can retry); deleted by the worker as soon as the lecture is created and raw_backup_key is confirmed (live_raws_due_for_deletion is the safety-net sweep).';
comment on column public.live_sessions.raw_deleted_at is
  'When the worker deleted the LOCAL raw (mark_live_raw_deleted, which requires raw_backup_key). The R2 backup (raw_backup_key) is kept — never deleted automatically.';
