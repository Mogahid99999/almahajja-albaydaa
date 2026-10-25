-- =============================================================================
-- 0156_app_open.sql
-- المَحجّة البَيْضَاء — LOAD V24 (part B, server half of the app release).
--
-- Every app foreground (cold start, unlock, coming back from another app) fired
-- 8–12 requests: touch_last_opened, a GoTrue /user ban check, notification_prefs,
-- a resumable-lesson probe, the inbox list and EVERY cached buddy query
-- (refetchType 'all'), plus get_live_now and the UpdateGate config read.
-- pg_stat_statements since June: notification_prefs 149k, progress probe 111k,
-- inbox 94k, buddy RPCs ~170k, touch 97k — all of it once per open.
--
-- app_open() answers all of that in ONE round trip; the client (V24) then only
-- refetches what actually changed (new inbox item, a buddy count moved) and
-- seeds the live card + the version gate from this result. It also performs
-- the last-opened stamp (same at-most-hourly guard as 0151).
--
-- Cost: index lookups only (notifications_user_idx / _unread_idx,
-- buddy_requests_to_idx / _from_idx, buddy_goals_b_idx, notification_prefs_pkey,
-- user_progress_user_idx) + get_live_now() (~7 ms warm).
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

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
    -- Deleted account with a still-valid JWT → the client signs out (was GoTrue user_not_found).
    return jsonb_build_object('user_exists', false);
  end if;

  -- The last-opened stamp (0151 guard: at most hourly, always on a new UTC+3 day).
  update public.profiles
     set last_opened_at = now()
   where id = v_uid
     and (last_opened_at is null
          or last_opened_at < now() - interval '1 hour'
          or (last_opened_at + interval '3 hours')::date <> (now() + interval '3 hours')::date);

  -- buddy_goals is a prod table staging lacks (0113-era drift): read it only if present.
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
    -- Missing pref row = the type's default; daily_reminder defaults OFF.
    'daily_reminder', coalesce((select p.enabled from public.notification_prefs p
                                 where p.user_id = v_uid and p.type = 'daily_reminder'), false),
    'has_resumable', exists (select 1 from public.user_lecture_progress lp
                              where lp.user_id = v_uid and lp.completed = false and lp.position_sec > 0),
    'live', public.get_live_now(),
    'version', (select jsonb_object_agg(c.key, c.value) from public.app_config c
                 where c.key in ('min_app_version', 'app_download_url',
                                 'latest_app_version', 'latest_released_at'))
  );
end;
$$;
revoke all on function public.app_open() from public, anon;
grant execute on function public.app_open() to authenticated;
