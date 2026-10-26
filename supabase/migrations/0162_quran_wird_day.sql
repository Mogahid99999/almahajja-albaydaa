-- =============================================================================
-- 0162_quran_wird_day.sql
-- المَحجّة البَيْضَاء — «ورد القرآن اليومي» as one activity of the daily journey.
--
-- The wird itself (goal, pages read today) lives on the device only. The server
-- learns ONE fact: «the wird was completed on day D» — and records it the way
-- the journey already records an active day: daily_listening.meaningful for
-- (user, D). So completing the wird keeps المداومة alive exactly like a
-- meaningful listening day does (0014/0046/0090 rules unchanged), and missing it
-- never breaks anything another activity already counted.
--
-- Nothing else is stored: no page, sura, ayah, duration or count. The row adds
-- 0 seconds and no lecture id, so the admin dashboard (listening hours, top
-- sections) and every seconds-based rollup are unchanged. Idempotent — a
-- replayed or double-sent completion is a no-op.
--
-- Day: the device-local day (as save_activity), bounded to current_date + 1 and
-- to the last 30 days (an offline completion replayed later still lands on its
-- own day; older replays are dropped).
--
-- Additive, append-only, idempotent. Security INVOKER: the caller's own
-- daily_listening rows only (RLS daily_listening_own). After applying: run
-- `node scripts/security-check.mjs`.
-- =============================================================================

create or replace function public.record_quran_wird_day(p_day date default current_date)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date := coalesce(p_day, current_date);
begin
  if v_uid is null then
    return;
  end if;
  if v_day > current_date + 1 or v_day < current_date - 30 then
    return;
  end if;

  insert into public.daily_listening (user_id, day, seconds_listened, lecture_ids, meaningful)
  values (v_uid, v_day, 0, '{}'::uuid[], true)
  on conflict (user_id, day) do update set meaningful = true
   where public.daily_listening.meaningful is distinct from true;
end;
$$;
revoke all on function public.record_quran_wird_day(date) from public, anon;
grant execute on function public.record_quran_wird_day(date) to authenticated;
