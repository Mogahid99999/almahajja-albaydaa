-- =============================================================================
-- 0018_quiz_publish_notify.sql
-- المَحجّة البَيْضَاء — Feature 12 · Phase E: publish fan-out for quizzes
--
-- When a quiz flips to published, insert a `new_quiz` inbox row for every
-- follower of the quiz's section subtree — the exact 0006 lecture pattern:
-- fanout_to_followers already gates on each follower's per-type pref (missing
-- row = ON), and the 0009 webhook → notify-on-publish Edge Function handles
-- the actual device push + quiet hours. `new_quiz` has existed in the enum
-- since 0003 (shipped inert for exactly this moment) — NO enum migration.
--
-- Append-only migration — 0001–0017 are never edited. Idempotent.
-- =============================================================================

create or replace function public.notify_quiz_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform public.fanout_to_followers(
      new.section_id,
      'new_quiz',
      'اختبار جديد',
      new.title || ' — قِس ما تعلمت',
      -- No sectionId here on purpose: both tap handlers prefer sectionId over
      -- route, and the tap should land on the quiz intro, not the section page.
      jsonb_build_object(
        'quizId', new.id,
        'route',  '/quiz/' || new.id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists quizzes_notify_published on public.quizzes;
create trigger quizzes_notify_published
  after insert or update of status on public.quizzes
  for each row execute function public.notify_quiz_published();
