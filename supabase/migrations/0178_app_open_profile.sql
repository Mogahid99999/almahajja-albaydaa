-- 0178 — app_open carries the account's own profile fields.
--
-- Bug (2026-11-12): an admin renames a student (admin-users updateProfile writes
-- profiles.display_name + user_metadata) but the student's app keeps the old name.
-- The app's currentUser comes from the LOCALLY STORED session user
-- (supabase.auth.getSession, no network) and is cached with staleTime Infinity.
-- Before LOAD V24 every foreground also called GoTrue /user, which refreshed it;
-- 0156 folded that call into app_open, which did not return the profile — so the
-- name (and admin gender/role/email/phone edits) only caught up after a token
-- refresh AND a cold restart.
--
-- Fix: app_open now returns `profile` (no extra request); the app patches its
-- cached user when anything differs. Additive: older app builds ignore the key.

create or replace function public.app_open()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_banned timestamptz;
  v_exists boolean;
  v_goals  bigint := 0;
begin
  if v_uid is null then
    return jsonb_build_object('user_exists', false);
  end if;

  select true, u.banned_until into v_exists, v_banned from auth.users u where u.id = v_uid;
  if not coalesce(v_exists, false) then
    return jsonb_build_object('user_exists', false);
  end if;

  update public.profiles
     set last_opened_at = now()
   where id = v_uid
     and (last_opened_at is null
          or last_opened_at < now() - interval '1 hour'
          or (last_opened_at + interval '3 hours')::date <> (now() + interval '3 hours')::date);

  if to_regclass('public.buddy_goals') is not null then
    execute 'select count(*) from public.buddy_goals where b_user_id = $1 and status = ''pending'''
      into v_goals using v_uid;
  end if;

  return jsonb_build_object(
    'user_exists', true,
    'banned', coalesce(v_banned > now(), false),
    'unread', (select count(*) from public.notifications n
                where n.user_id = v_uid and n.read_at is null),
    'latest_notification_at', (select max(n.created_at) from public.notifications n
                                where n.user_id = v_uid),
    'buddy', jsonb_build_object(
      'incoming', (select count(*) from public.buddy_requests r
                    where r.to_user_id = v_uid and r.status = 'pending'),
      'outgoing', (select count(*) from public.buddy_requests r
                    where r.from_user_id = v_uid and r.status = 'pending'),
      'goal_invites', v_goals),
    'daily_reminder', coalesce((select p.enabled from public.notification_prefs p
                                 where p.user_id = v_uid and p.type = 'daily_reminder'), false),
    'has_resumable', exists (select 1 from public.user_lecture_progress lp
                              where lp.user_id = v_uid and lp.completed = false and lp.position_sec > 0),
    'live', public.get_live_now(),
    'version', (select jsonb_object_agg(c.key, c.value) from public.app_config c
                 where c.key in ('min_app_version', 'app_download_url',
                                 'latest_app_version', 'latest_released_at')),
    -- 0158: «الجدول الأسبوعي» — the app refetches get_schedule only when this changes.
    'schedule_version', (select c.value from public.app_config c where c.key = 'schedule_version'),
    -- 0178: the caller's own profile, so admin edits reach the app's cached user.
    'profile', (select jsonb_build_object(
                  'display_name', p.display_name,
                  'gender', p.gender,
                  'role', p.role,
                  'email', u.email,
                  'phone', u.phone)
                  from auth.users u
                  left join public.profiles p on p.id = u.id
                 where u.id = v_uid)
  );
end;
$$;
revoke all on function public.app_open() from public, anon;
grant execute on function public.app_open() to authenticated;
