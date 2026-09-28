-- =============================================================================
-- 0137_lectures_live_source.sql
-- المَحجّة البَيْضَاء — V23 P2: lectures that come from a live recording.
--
-- (PLAN_LIVE_V23 §4 "0136_lectures_live_source" — renumbered.)
--
--   lectures.source          'upload' (default, every existing row) | 'live'
--   lectures.live_session_id the session it was recorded in
--   lectures.review_state    'needs_title' | null — a live recording lands
--                            already placed (section = session section, next
--                            order, sheikh pre-filled) as a DRAFT and only needs
--                            the final title + sheikh (finalize_live_lecture,
--                            0138) before it may be published.
--
-- «المحاضرات الواردة» becomes `section_id is null OR review_state = 'needs_title'`.
-- There is no RPC behind that list today — getUnclassifiedLectures
-- (src/api/admin.ts) queries the table directly — so the change is client-side
-- (P6): `.or('section_id.is.null,review_state.eq.needs_title')`.
--
-- Publish guard: a lecture with review_state = 'needs_title' cannot be flipped to
-- 'published' («أكمِل العنوان النهائي والشيخ قبل النشر»). Existing rows all have
-- review_state null, so nothing about today's publish paths changes.
--
-- Raw-recording retention (owner rule, 0134): live_sessions.lecture_published_at
-- follows the live lecture's publish state — set to now() when it becomes
-- published, cleared when it is unpublished — so "published for ≥ 7 days" means
-- continuously published (live_raws_due_for_deletion, 0138).
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

alter table public.lectures
  add column if not exists source          text not null default 'upload',
  add column if not exists live_session_id uuid,
  add column if not exists review_state    text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lectures_source_check') then
    alter table public.lectures
      add constraint lectures_source_check check (source in ('upload', 'live'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lectures_review_state_check') then
    alter table public.lectures
      add constraint lectures_review_state_check
      check (review_state is null or review_state = 'needs_title');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lectures_live_session_id_fkey') then
    alter table public.lectures
      add constraint lectures_live_session_id_fkey
      foreign key (live_session_id) references public.live_sessions (id) on delete set null;
  end if;
end $$;

create index if not exists lectures_live_session_idx
  on public.lectures (live_session_id)
  where live_session_id is not null;
-- The «واردة» list reads needs_title rows next to section_id-is-null rows.
create index if not exists lectures_needs_title_idx
  on public.lectures (created_at)
  where review_state = 'needs_title';

comment on column public.lectures.source is
  '''upload'' (admin upload form) or ''live'' (created from a live recording by create_live_lecture).';
comment on column public.lectures.review_state is
  '''needs_title'' = live recording awaiting its final title + sheikh (finalize_live_lecture); cannot be published until cleared.';

-- 1. Publish guard ---------------------------------------------------------------------
create or replace function public.guard_publish_needs_title()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and new.review_state = 'needs_title' then
    raise exception 'أكمِل العنوان النهائي والشيخ قبل النشر';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_publish_needs_title() from public, anon, authenticated;

drop trigger if exists lectures_guard_needs_title on public.lectures;
create trigger lectures_guard_needs_title
  before insert or update of status on public.lectures
  for each row execute function public.guard_publish_needs_title();

-- 2. Track the live lecture's publish time on its session ----------------------------
create or replace function public.track_live_lecture_publish()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.live_session_id is null then
    return null;
  end if;
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    update public.live_sessions
       set lecture_published_at = now()
     where id = new.live_session_id and lecture_id = new.id;
  elsif tg_op = 'UPDATE'
        and old.status = 'published'
        and new.status is distinct from 'published' then
    update public.live_sessions
       set lecture_published_at = null
     where id = new.live_session_id and lecture_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function public.track_live_lecture_publish() from public, anon, authenticated;

drop trigger if exists lectures_track_live_publish on public.lectures;
create trigger lectures_track_live_publish
  after insert or update of status on public.lectures
  for each row execute function public.track_live_lecture_publish();
