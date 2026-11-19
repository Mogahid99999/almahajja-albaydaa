-- =============================================================================
-- 0182_live_comments_edit_close.sql
-- المَحجّة البَيْضَاء — live comments, owner requests 2026-11-19:
--   * longer comments: 300 → 1000 characters;
--   * the author edits his own comment while the majlis is live (edited_at, «معدّل»);
--   * the host / moderators / content managers close and reopen the comments of a
--     session (live_sessions.comments_closed): nobody but a moderator writes or edits
--     while closed; the list stays visible.
--
-- Public comment shape (0147) + `edited: boolean`. Old apps ignore the new key.
-- New service-role RPCs (live-control): live_edit_comment, live_set_comments_closed.
-- New client RPC: get_live_comments_state(session) → { closed } (same access as
-- get_live_comments). New refusal: 'live_comment:closed'.
--
-- Requires 0147, 0157. Append-only, idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Columns / limits ---------------------------------------------------------------
alter table public.live_comments drop constraint if exists live_comments_body_check;
alter table public.live_comments
  add constraint live_comments_body_check check (char_length(btrim(body)) between 1 and 1000);
alter table public.live_comments add column if not exists edited_at timestamptz;

alter table public.live_sessions
  add column if not exists comments_closed boolean not null default false;

alter table public.live_moderation_log drop constraint if exists live_moderation_log_action_check;
alter table public.live_moderation_log add constraint live_moderation_log_action_check
  check (action = any (array['open_green', 'start', 'end', 'cancel', 'approve', 'reject', 'mute',
                             'demote', 'step_down', 'set_allow_requests', 'host_leave', 'auto_end',
                             'resume_recording', 'comment_delete', 'comment_answered', 'comment_block',
                             'react_block', 'recording_delete', 'comments_close']));

-- 2. Public shape: + edited ----------------------------------------------------------
create or replace function public.live_comment_json(
  c              public.live_comments,
  p_viewer       uuid,
  p_with_mine    boolean default false,
  p_with_deleted boolean default false
)
returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
           'id',       c.id,
           'kind',     c.kind,
           'text',     c.body,
           'name',     case when c.show_name then c.display_name end,
           'gender',   c.gender,
           'answered', c.answered_at is not null,
           'edited',   c.edited_at is not null,
           'at',       to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      || case when p_with_mine
              then jsonb_build_object('mine', coalesce(p_viewer is not null and c.user_id = p_viewer, false))
              else '{}'::jsonb end
      || case when p_with_deleted
              then jsonb_build_object('deleted', c.deleted_at is not null)
              else '{}'::jsonb end;
$$;
revoke all on function public.live_comment_json(public.live_comments, uuid, boolean, boolean)
  from public, anon, authenticated;

-- 3. live_post_comment: 1000 characters, closed comments (0147 otherwise unchanged) ----
create or replace function public.live_post_comment(
  p_session   uuid,
  p_user      uuid,
  p_kind      text,
  p_body      text,
  p_anonymous boolean
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_body   text := btrim(coalesce(p_body, ''));
  v_status public.live_status;
  v_closed boolean;
  p        public.live_participants%rowtype;
  v_show   boolean;
  v_name   text;
  c        public.live_comments%rowtype;
begin
  if p_user is null then
    raise exception 'live_comment:forbidden';
  end if;
  if p_kind is null or p_kind not in ('comment', 'question') then
    raise exception 'live_comment:bad_request';
  end if;

  select s.status, s.comments_closed into v_status, v_closed from public.live_sessions s where s.id = p_session;
  if not found then
    raise exception 'live_comment:not_found';
  end if;
  if v_status <> 'live' then
    raise exception 'live_comment:not_live';
  end if;

  if coalesce((select u.is_anonymous from auth.users u where u.id = p_user), true) then
    raise exception 'live_comment:guest_cannot_comment';
  end if;

  if v_closed and not public.live_comment_is_moderator(p_session, p_user) then
    raise exception 'live_comment:closed';
  end if;

  select * into p
    from public.live_participants lp
   where lp.session_id = p_session and lp.user_id = p_user
     for update;
  if not found or not (p.present or p.left_at is null) then
    raise exception 'live_comment:not_present';
  end if;

  if exists (select 1 from public.live_comment_blocks b
              where b.session_id = p_session and b.user_id = p_user) then
    raise exception 'live_comment:blocked';
  end if;

  if char_length(v_body) = 0 then
    raise exception 'live_comment:empty';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'live_comment:too_long';
  end if;
  if public.contains_blocked_word(v_body) then
    raise exception 'live_comment:blocked_words';
  end if;

  if exists (select 1 from public.live_comments x
              where x.session_id = p_session and x.user_id = p_user
                and x.created_at > now() - interval '10 seconds') then
    raise exception 'live_comment:rate_limited';
  end if;

  v_show := not coalesce(p_anonymous, true)
            and not (p.gender = 'f' and p.hidden_name);
  if v_show then
    v_name := left(nullif(btrim(regexp_replace(coalesce(p.display_name, ''), '\s+', ' ', 'g')), ''), 60);
    if v_name is null then
      v_name := case
                  when p.role in ('host', 'moderator') then
                    case p.gender when 'f' then 'مشرفة' else 'مشرف' end
                  else
                    case p.gender when 'f' then 'طالبة' else 'طالب' end
                end;
    end if;
  end if;

  insert into public.live_comments (session_id, user_id, kind, body, show_name, display_name, gender)
  values (p_session, p_user, p_kind, v_body, v_show, case when v_show then v_name end, p.gender)
  returning * into c;

  return public.live_comment_json(c, null, false, false);
end;
$$;
revoke all on function public.live_post_comment(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.live_post_comment(uuid, uuid, text, text, boolean)
  to service_role;

-- 4. live_edit_comment — the author only, while live, not deleted, not blocked, comments
-- open (a moderator may edit his own while closed), same text rules as a post.
-- Keeps kind, name and created_at; sets edited_at. Returns the public comment.
create or replace function public.live_edit_comment(
  p_session uuid,
  p_comment uuid,
  p_user    uuid,
  p_body    text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_body   text := btrim(coalesce(p_body, ''));
  v_status public.live_status;
  v_closed boolean;
  c        public.live_comments%rowtype;
begin
  if p_user is null then
    raise exception 'live_comment:forbidden';
  end if;
  select s.status, s.comments_closed into v_status, v_closed from public.live_sessions s where s.id = p_session;
  if not found then
    raise exception 'live_comment:not_found';
  end if;
  if v_status <> 'live' then
    raise exception 'live_comment:not_live';
  end if;

  select * into c from public.live_comments x
   where x.id = p_comment and x.session_id = p_session
     for update;
  if not found or c.deleted_at is not null then
    raise exception 'live_comment:not_found';
  end if;
  if c.user_id <> p_user then
    raise exception 'live_comment:forbidden';
  end if;
  if v_closed and not public.live_comment_is_moderator(p_session, p_user) then
    raise exception 'live_comment:closed';
  end if;
  if exists (select 1 from public.live_comment_blocks b
              where b.session_id = p_session and b.user_id = p_user) then
    raise exception 'live_comment:blocked';
  end if;

  if char_length(v_body) = 0 then
    raise exception 'live_comment:empty';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'live_comment:too_long';
  end if;
  if public.contains_blocked_word(v_body) then
    raise exception 'live_comment:blocked_words';
  end if;

  if v_body is distinct from c.body then
    update public.live_comments set body = v_body, edited_at = now()
     where id = c.id
     returning * into c;
  end if;
  return public.live_comment_json(c, null, false, false);
end;
$$;
revoke all on function public.live_edit_comment(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.live_edit_comment(uuid, uuid, uuid, text) to service_role;

-- 5. live_set_comments_closed — moderators only (host, the session's moderators, content
-- managers), green or live. Returns { closed, changed }.
create or replace function public.live_set_comments_closed(
  p_session uuid,
  p_actor   uuid,
  p_closed  boolean
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.live_sessions%rowtype;
begin
  if p_closed is null then
    raise exception 'live_comment:bad_request';
  end if;
  select * into s from public.live_sessions x where x.id = p_session for update;
  if not found then
    raise exception 'live_comment:not_found';
  end if;
  if not public.live_comment_is_moderator(p_session, p_actor) then
    raise exception 'live_comment:forbidden';
  end if;
  if s.status not in ('green', 'live') then
    raise exception 'live_comment:not_live';
  end if;
  if s.comments_closed is distinct from p_closed then
    update public.live_sessions set comments_closed = p_closed where id = p_session;
    return jsonb_build_object('closed', p_closed, 'changed', true);
  end if;
  return jsonb_build_object('closed', p_closed, 'changed', false);
end;
$$;
revoke all on function public.live_set_comments_closed(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.live_set_comments_closed(uuid, uuid, boolean) to service_role;

-- 6. get_live_comments_state — what a joining client needs beside the list. Same access
-- as get_live_comments (0147): staff any session; otherwise a participant while green|live.
create or replace function public.get_live_comments_state(p_session uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s     public.live_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select * into s from public.live_sessions x where x.id = p_session;
  if not found then
    return jsonb_build_object('closed', false);
  end if;
  if not (public.is_content_manager() or public.is_sheikh()
          or (s.status in ('green', 'live')
              and exists (select 1 from public.live_participants lp
                           where lp.session_id = p_session and lp.user_id = v_uid))) then
    return jsonb_build_object('closed', false);
  end if;
  return jsonb_build_object('closed', s.comments_closed);
end;
$$;
revoke all on function public.get_live_comments_state(uuid) from public, anon;
grant execute on function public.get_live_comments_state(uuid) to authenticated;
