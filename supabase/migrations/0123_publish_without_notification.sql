-- =============================================================================
-- 0123_publish_without_notification.sql
-- المَحجّة البَيْضَاء — «نشر بدون إشعار»: publish a lecture straight into its
-- section without notifying anyone.
--
-- Owner's ask: some lessons are back-fill (an old series being completed, a
-- re-upload, a fix) and should land quietly — no push, no inbox row, nothing in
-- «التذكيرات». Until now every publish notified all ~10 k students.
--
-- Deliberately server-side: the decision lives in a lectures column that the
-- publish trigger reads, NOT in the app. The ~10 k installed apps never take
-- part in the fan-out — they only read notifications the server created — so
-- this needs no app release. Only the admin web panel gains the switch.
--
-- Semantics:
--   * `notify_on_publish` defaults to TRUE, so every existing row and every
--     client that doesn't know about the column behaves exactly as before.
--   * FALSE silences the lecture for good — including a later draft→published
--     flip from the lectures list, which is the same trigger. To notify after
--     all, set it back to true before publishing.
--   * Only the new-lecture fan-out is affected. Attachments, quizzes,
--     broadcasts and the cron reminders are untouched.
--
-- Append-only, idempotent. Never edit 0001–0122.
-- =============================================================================

alter table public.lectures
  add column if not exists notify_on_publish boolean not null default true;

comment on column public.lectures.notify_on_publish is
  'False = publish silently: notify_lecture_published skips the fan-out, so no push and no inbox row. Set from the admin upload form («إشعار الطلاب»).';

-- ---------------------------------------------------------------------------
-- Same function as 0072 (broadcast to all students, section title in the
-- headline), plus the one guard. Reproduced in full because migrations are
-- append-only: 0072 is never edited.
-- ---------------------------------------------------------------------------
create or replace function public.notify_lecture_published()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_section_title text;
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    -- «نشر بدون إشعار» (0123): the admin asked for this lecture to land quietly.
    if not coalesce(new.notify_on_publish, true) then
      return new;
    end if;
    if new.section_id is null then
      return new;
    end if;
    select s.title into v_section_title
      from public.sections s where s.id = new.section_id;
    perform public.fanout_to_all(
      'new_lecture',
      'أُضيف درس جديد في ' || coalesce(v_section_title, ''),
      new.title,
      jsonb_build_object('lectureId', new.id, 'sectionId', new.section_id)
    );
  end if;
  return new;
end;
$$;

-- The trigger itself is unchanged (0072); re-created so this migration is
-- self-contained and safe to apply to a project that drifted.
drop trigger if exists lectures_notify_published on public.lectures;
create trigger lectures_notify_published
  after insert or update of status on public.lectures
  for each row execute function public.notify_lecture_published();
