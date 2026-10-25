-- =============================================================================
-- 0157_live_reactions_and_recording_delete.sql
-- المَحجّة البَيْضَاء — live room batch (owner request 2026-10-05).
--
-- 1. Reactions «👍 ❤️ 🤲 …» fly over the halaqa. They travel ONLY on the
--    LiveKit data channel (topic "reactions") — never through the database, so
--    a thousand listeners reacting cost the DB nothing. A moderator can stop
--    one participant from sending them: live_participants.reactions_blocked,
--    enforced by LiveKit itself (the participant's canPublishData permission,
--    set by live-control `react_block` and by live-token on every (re)join).
-- 2. «حذف التسجيل» — ADMIN only, once the recording is ready (never while it
--    is still being processed, never a lecture already published):
--    admin_delete_live_recording() deletes the draft lecture, forgets the raw
--    R2 backups and stamps live_sessions.recording_deleted_at; it returns the
--    R2 keys and the app removes those objects through r2-delete (the same
--    best-effort cleanup as deleting any lecture).
--
-- Bodies of live_join_context / live_admin_session_json are the live prod
-- definitions (pg_get_functiondef, 2026-10-05) + the marked additions.
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Columns -------------------------------------------------------------------------
alter table public.live_participants
  add column if not exists reactions_blocked boolean not null default false;
comment on column public.live_participants.reactions_blocked is
  '0157: a moderator stopped this participant''s reactions (LiveKit canPublishData off; live-token keeps it on re-join).';

alter table public.live_sessions
  add column if not exists recording_deleted_at timestamptz;
comment on column public.live_sessions.recording_deleted_at is
  '0157: an admin deleted this session''s recording (draft lecture + R2 audio + raw backups).';

-- The moderation log accepts the new action (live-control `react_block`).
alter table public.live_moderation_log drop constraint if exists live_moderation_log_action_check;
alter table public.live_moderation_log add constraint live_moderation_log_action_check
  check (action = any (array['open_green', 'start', 'end', 'cancel', 'approve', 'reject', 'mute',
                             'demote', 'step_down', 'set_allow_requests', 'host_leave', 'auto_end',
                             'resume_recording', 'comment_delete', 'comment_answered', 'comment_block',
                             'react_block', 'recording_delete']));

-- 2. live_join_context: + stored.reactions_blocked -------------------------------------
create or replace function public.live_join_context(p_session uuid, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user', (select jsonb_build_object('banned_until', u.banned_until,
                                       'is_anonymous', coalesce(u.is_anonymous, false))
               from auth.users u where u.id = p_user),
    'flag', (select c.value from public.app_config c where c.key = 'live_enabled'),
    'profile', (select jsonb_build_object('role', p.role, 'gender', p.gender,
                                          'display_name', p.display_name)
                  from public.profiles p where p.id = p_user),
    'session', (select jsonb_build_object('id', s.id, 'status', s.status, 'room_name', s.room_name,
                                          'host_user_id', s.host_user_id, 'section_id', s.section_id,
                                          'allow_requests', s.allow_requests)
                  from public.live_sessions s where s.id = p_session),
    'stored', (select jsonb_build_object('role', lp.role, 'hidden_name', lp.hidden_name,
                                         'reactions_blocked', lp.reactions_blocked)  -- 0157
                 from public.live_participants lp
                where lp.session_id = p_session and lp.user_id = p_user),
    'visible', (select public.section_visible_to_viewer(
                         s.section_id,
                         (select p.gender from public.profiles p where p.id = p_user))
                  from public.live_sessions s where s.id = p_session),
    'identity', public.live_identity(p_session, p_user)
  );
$$;
revoke all on function public.live_join_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.live_join_context(uuid, uuid) to service_role;

-- 3. The staff overview card knows the recording was deleted ------------------------
create or replace function public.live_admin_session_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id',              s.id,
           'title',           s.title,
           'status',          s.status,
           'section_id',      s.section_id,
           'section_title',   sec.title,
           'sheikh_id',       s.sheikh_id,
           'sheikh_name',     sh.name,
           'host_user_id',    s.host_user_id,
           'host_name',       nullif(btrim(hp.display_name), ''),
           'is_mine',         coalesce(s.host_user_id = auth.uid(), false),
           'scheduled_at',    s.scheduled_at,
           'started_at',      s.started_at,
           'ended_at',        s.ended_at,
           'created_at',      s.created_at,
           'share_code',      s.share_code,
           'allow_requests',  s.allow_requests,
           'peak_listeners',  s.peak_listeners,
           'attendees',       case when s.status in ('green', 'live') then (
                                select count(*)::int from public.live_participants lp
                                 where lp.session_id = s.id and lp.present)
                              else 0 end,
           'lecture_id',      s.lecture_id,
           'lecture_status',  l.status,
           'lecture_needs_title', coalesce(l.review_state = 'needs_title', false),
           'duration_sec',    l.duration_sec,
           'raw_local',       (s.raw_path is not null and s.raw_deleted_at is null),
           'raw_backup',      (s.raw_backup_key is not null),
           'recording_deleted', (s.recording_deleted_at is not null),  -- 0157
           'job',             case when j.id is null then null else jsonb_build_object(
                                'id',       j.id,
                                'status',   j.status,
                                'progress', j.progress,
                                'attempts', j.attempts,
                                'error',    case when public.is_content_manager() then j.error end,
                                'finished_at', j.finished_at) end)
    from public.live_sessions s
    join public.sections sec on sec.id = s.section_id
    left join public.sheikhs sh on sh.id = s.sheikh_id
    left join public.profiles hp on hp.id = s.host_user_id
    left join public.lectures l on l.id = s.lecture_id
    left join lateral (
      select mj.id, mj.status, mj.progress, mj.attempts, mj.error, mj.finished_at
        from public.media_jobs mj
       where mj.live_session_id = s.id and mj.kind = 'live_recording'
       order by mj.created_at desc
       limit 1
    ) j on true
   where s.id = p_id;
$$;

-- 4. «حذف التسجيل» — admin only ---------------------------------------------------------
create or replace function public.admin_delete_live_recording(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s      public.live_sessions%rowtype;
  v_lect public.lectures%rowtype;
  v_keys text[];
begin
  if not public.is_admin() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  select * into s from public.live_sessions where id = p_session for update;
  if not found then
    raise exception 'المجلس غير موجود';
  end if;
  if s.recording_deleted_at is not null then
    return jsonb_build_object('deleted', true, 'keys', '[]'::jsonb);  -- idempotent
  end if;
  if s.status in ('scheduled', 'green', 'live') then
    raise exception 'لا يُحذف التسجيل قبل انتهاء البث';
  end if;
  if exists (select 1 from public.media_jobs j
              where j.live_session_id = s.id and j.kind = 'live_recording'
                and j.status in ('queued', 'running')) then
    raise exception 'تجري معالجة التسجيل الآن، احذفه بعد اكتمالها';
  end if;
  if s.status <> 'ready' then
    raise exception 'لا يوجد تسجيل جاهز لهذا المجلس';
  end if;

  if s.lecture_id is not null then
    select * into v_lect from public.lectures where id = s.lecture_id;
    if found and v_lect.status = 'published' then
      raise exception 'نُشر هذا التسجيل درساً؛ احذفه من شاشة المحاضرات';
    end if;
  end if;

  -- Every R2 object of this recording: the compressed audio and the raw backups.
  select coalesce(array_agg(distinct k), '{}') into v_keys
    from (
      select v_lect.audio_path as k
      union all
      select j.output_key from public.media_jobs j
       where j.live_session_id = s.id and j.kind = 'live_recording'
      union all
      select s.raw_backup_key
      union all
      select p.raw_backup_key from public.live_recording_parts p where p.session_id = s.id
    ) x
   where k is not null and btrim(k) <> '' and position('..' in k) = 0;

  update public.live_sessions
     set recording_deleted_at = now(),
         lecture_id           = null,
         raw_backup_key       = null
   where id = s.id;
  update public.live_recording_parts set raw_backup_key = null where session_id = s.id;
  if s.lecture_id is not null then
    delete from public.lectures where id = s.lecture_id;  -- a draft: progress/notes cascade
  end if;

  insert into public.live_moderation_log (session_id, actor_user_id, target_identity, action, detail)
  values (s.id, auth.uid(), null, 'recording_delete',
          jsonb_build_object('lecture_id', s.lecture_id, 'objects', coalesce(array_length(v_keys, 1), 0)));

  return jsonb_build_object('deleted', true, 'keys', to_jsonb(v_keys));
end;
$$;
revoke all on function public.admin_delete_live_recording(uuid) from public, anon;
grant execute on function public.admin_delete_live_recording(uuid) to authenticated;
