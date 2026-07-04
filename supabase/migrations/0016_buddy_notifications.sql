-- =============================================================================
-- 0016_buddy_notifications.sql
-- المَحجّة البَيْضَاء — Feature 26.2 Phase E: buddy completion notification
--
-- When a student completes a lesson (user_lecture_progress.completed flips to
-- true), their accepted buddy gets a calm nudge:
--   "رفيقك أتم درساً اليوم، فلعلك تدرك نصيبك من الأجر"
--
-- Delivery rides the existing pipeline: this trigger INSERTs a notifications
-- row of type 'buddy_activity' (enum value added in 0015) → the 0009 webhook
-- POSTs it to the notify-on-publish Edge Function → Expo Push → FCM.
--
-- Guards, in order:
--   * only the completed=false→true crossing (the ~5s progress upsert keeps
--     re-writing completed=true afterwards — those must not re-fire)
--   * recipient's 'buddy_activity' pref (per-type notification_prefs row, the
--     plan's `buddy_notifications bool` column reshaped to fit the existing
--     (user_id, type, enabled) prefs model — missing row = ON)
--   * quiet hours 23:00–05:00 local (UTC+3, same offset as the 0013 cron note
--     "16:00 UTC ≈ 19:00 local") — skipped entirely, not queued
--   * at most ONE buddy_activity per recipient per (local) day — a study
--     session completing five lessons must not ping the buddy five times
--
-- Never blocks the progress save: any error is swallowed.
-- Append-only migration — 0001–0015 are never edited. Idempotent.
-- =============================================================================

create or replace function public.notify_buddy_on_completion()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_buddy      uuid;
  v_pref       boolean;
  v_local_hour integer;
begin
  if tg_op = 'UPDATE' and old.completed then
    return new;  -- already completed before this write
  end if;
  if not new.completed then
    return new;
  end if;

  v_buddy := public.buddy_of(new.user_id);
  if v_buddy is null then return new; end if;

  select enabled into v_pref from public.notification_prefs
   where user_id = v_buddy and type = 'buddy_activity';
  if not coalesce(v_pref, true) then return new; end if;

  v_local_hour := extract(hour from now() + interval '3 hours')::int;
  if v_local_hour >= 23 or v_local_hour < 5 then return new; end if;

  if exists (
    select 1 from public.notifications
     where user_id = v_buddy and type = 'buddy_activity'
       and created_at >= date_trunc('day', now() + interval '3 hours') - interval '3 hours'
  ) then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_buddy,
    'buddy_activity',
    'رفيقك أتم درساً اليوم، فلعلك تدرك نصيبك من الأجر',
    '',
    jsonb_build_object('route', '/(student)/journey')
  );
  return new;
exception when others then
  return new;  -- a nudge must never break a playback save
end;
$$;

drop trigger if exists buddy_activity_on_completion on public.user_lecture_progress;
create trigger buddy_activity_on_completion
  after insert or update on public.user_lecture_progress
  for each row
  when (new.completed)
  execute function public.notify_buddy_on_completion();
